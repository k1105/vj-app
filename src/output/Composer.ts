import * as THREE from "three";
import type { LayerState, PluginMeta, VJState } from "../shared/types";
import { PluginHost, type GlobalUniforms } from "./PluginHost";

const MAX_LAYERS = 4;
const BLEND_MODE: Record<LayerState["blend"], number> = {
  normal: 0,
  add: 1,
  multiply: 2,
  screen: 3,
};

const POSTFX_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Vertex shader for final-output quads that need flash-zoom.
// uZoomScale > 1 → UV shrinks toward centre → image appears larger (zoom in).
const ZOOM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  uniform float uZoomScale;
  void main() {
    vUv = (uv - 0.5) / uZoomScale + 0.5;
    gl_Position = vec4(position, 1.0);
  }
`;

/** Materialized postfx — a ShaderMaterial plus the uniform keys it accepts. */
interface PostFXEntry {
  pluginId: string;
  material: THREE.ShaderMaterial;
  paramKeys: string[];
}

/**
 * Composer — owns the single WebGLRenderer and drives the render loop.
 *
 * 現在の実装:
 *   1. renderer 所有 + プラグインホスティング
 *   2. 4 レイヤーの合成（opacity + blend mode + mute/solo）
 *   3. LIVE/NEXT トランジション (Cut は即時 / CrossFade は 2 パス合成 + mix)
 *
 * この先 (未着手):
 *   - Transition プラグインのロード (Dissolve / Wipe 固有のシェーダ)
 *   - PostFX チェーン
 */
export class Composer {
  private renderer: THREE.WebGLRenderer;
  private displayScene: THREE.Scene;
  private displayCamera: THREE.OrthographicCamera;
  private displayQuad: THREE.Mesh;
  private displayMaterial: THREE.ShaderMaterial;

  // During a timed transition we compose twice: "from" and "to".
  private rtFrom: THREE.WebGLRenderTarget | null = null;
  private rtTo: THREE.WebGLRenderTarget | null = null;
  private mixScene: THREE.Scene;
  private mixQuad: THREE.Mesh;
  private mixMaterial: THREE.ShaderMaterial;

  // Ping-pong render targets used by the postfx chain.
  private rtPingA: THREE.WebGLRenderTarget | null = null;
  private rtPingB: THREE.WebGLRenderTarget | null = null;
  // A simple pass-through used as the final blit from a render target to
  // the screen when postfx has produced its output in an RT.
  private presentScene: THREE.Scene;
  private presentQuad: THREE.Mesh;
  private presentMaterial: THREE.ShaderMaterial;

  // Full-screen white overlay for the flash effect. Rendered additively on top
  // of every frame so it works regardless of which render path is active.
  private flashScene: THREE.Scene;
  private flashMaterial: THREE.ShaderMaterial;
  private static readonly FLASH_DURATION_MS = 350;

  // PostFX state: built materials keyed by pluginId, plus a lazy-load guard.
  private postfxMaterials = new Map<string, PostFXEntry>();
  private postfxPending = new Set<string>();
  // Metas kept locally so postfx loading can read manifest params.
  private allPlugins: PluginMeta[] = [];

  private blackTexture: THREE.DataTexture;
  private host: PluginHost;

  private raf = 0;
  private state: VJState | null = null;
  private clock = new THREE.Clock();
  private lastTime = 0;
  private zoomScale = 1.0; // flash-zoom scale factor; 1.0 = no zoom

  private reconcilePending = false;
  private reconcileDirty = false;
  private lastReconcileKey = "";

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;

    this.host = new PluginHost(this.renderer);
    this.host.setSize(window.innerWidth, window.innerHeight);

    this.blackTexture = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    this.blackTexture.needsUpdate = true;

    // ── 4-layer composite shader ────────────────────────────────────────
    this.displayScene = new THREE.Scene();
    this.displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geom = new THREE.PlaneGeometry(2, 2);
    this.displayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uLayer0:    { value: this.blackTexture as THREE.Texture },
        uLayer1:    { value: this.blackTexture as THREE.Texture },
        uLayer2:    { value: this.blackTexture as THREE.Texture },
        uLayer3:    { value: this.blackTexture as THREE.Texture },
        uOpacity:   { value: [0, 0, 0, 0] },
        uBlend:     { value: [0, 0, 0, 0] },
        uActive:    { value: [0, 0, 0, 0] },
        uTime:      { value: 0 },
        uZoomScale: { value: 1.0 },
      },
      vertexShader: ZOOM_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uLayer0;
        uniform sampler2D uLayer1;
        uniform sampler2D uLayer2;
        uniform sampler2D uLayer3;
        uniform float uOpacity[4];
        uniform int uBlend[4];
        uniform int uActive[4];
        uniform float uTime;

        vec4 applyBlend(vec4 acc, vec4 src, float opacity, int mode) {
          float a = clamp(src.a * opacity, 0.0, 1.0);
          if (mode == 0) {
            vec3 rgb = mix(acc.rgb, src.rgb, a);
            return vec4(rgb, acc.a + a * (1.0 - acc.a));
          } else if (mode == 1) {
            return vec4(acc.rgb + src.rgb * a, max(acc.a, a));
          } else if (mode == 2) {
            vec3 rgb = mix(acc.rgb, acc.rgb * src.rgb, a);
            return vec4(rgb, max(acc.a, a));
          } else {
            vec3 rgb = mix(acc.rgb, vec3(1.0) - (vec3(1.0) - acc.rgb) * (vec3(1.0) - src.rgb), a);
            return vec4(rgb, max(acc.a, a));
          }
        }

        vec4 sampleLayer(int idx) {
          if (idx == 0) return texture2D(uLayer0, vUv);
          if (idx == 1) return texture2D(uLayer1, vUv);
          if (idx == 2) return texture2D(uLayer2, vUv);
          return texture2D(uLayer3, vUv);
        }

        void main() {
          // Draw bottom-up so L1 (layers[0]) ends up on top — matches the
          // Controller's layer-list convention and Resolume-style apps.
          vec4 acc = vec4(0.0, 0.0, 0.0, 0.0);
          for (int i = 3; i >= 0; i--) {
            if (uActive[i] == 0) continue;
            vec4 src = sampleLayer(i);
            acc = applyBlend(acc, src, uOpacity[i], uBlend[i]);
          }
          if (acc.a < 0.001) {
            float v = 0.5 + 0.5 * sin(uTime + vUv.x * 6.2831);
            gl_FragColor = vec4(v * 0.02, v * 0.05, v * 0.03, 1.0);
            return;
          }
          gl_FragColor = vec4(acc.rgb, 1.0);
        }
      `,
    });
    this.displayQuad = new THREE.Mesh(geom, this.displayMaterial);
    this.displayScene.add(this.displayQuad);

    // ── Mix shader for timed transitions ────────────────────────────────
    this.mixScene = new THREE.Scene();
    this.mixMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFrom:      { value: this.blackTexture as THREE.Texture },
        uTo:        { value: this.blackTexture as THREE.Texture },
        uProgress:  { value: 0 },
        uZoomScale: { value: 1.0 },
      },
      vertexShader: ZOOM_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uFrom;
        uniform sampler2D uTo;
        uniform float uProgress;
        void main() {
          vec4 a = texture2D(uFrom, vUv);
          vec4 b = texture2D(uTo, vUv);
          gl_FragColor = mix(a, b, clamp(uProgress, 0.0, 1.0));
        }
      `,
    });
    this.mixQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mixMaterial);
    this.mixScene.add(this.mixQuad);

    // ── Present pass: plain texture-to-screen blit ──────────────────────
    this.presentScene = new THREE.Scene();
    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTex:       { value: this.blackTexture as THREE.Texture },
        uZoomScale: { value: 1.0 },
      },
      vertexShader: ZOOM_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        void main() {
          gl_FragColor = texture2D(uTex, vUv);
        }
      `,
    });
    this.presentQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.presentMaterial,
    );
    this.presentScene.add(this.presentQuad);

    // ── Flash overlay: additive white over everything ────────────────────
    this.flashScene = new THREE.Scene();
    this.flashMaterial = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 } },
      vertexShader: POSTFX_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uFlash;
        void main() {
          gl_FragColor = vec4(uFlash, uFlash, uFlash, uFlash);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const flashQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMaterial);
    this.flashScene.add(flashQuad);
  }

  /** Called once after construction (main.ts). Loads plugin metadata. */
  async loadPlugins(): Promise<void> {
    const metas: PluginMeta[] = await window.vj.listPlugins();
    console.log(`[Composer] loadPlugins: ${metas.length} plugins`);
    this.allPlugins = metas;
    this.host.setMetas(metas);
    window.vj.onPluginsChanged((plugins) => {
      this.allPlugins = plugins;
      this.host.setMetas(plugins);
      this.reconcileDirty = true;
      this.scheduleReconcile();
    });
    this.reconcileDirty = true;
    this.scheduleReconcile();
  }

  updateState(state: VJState): void {
    this.state = state;
    // Reconcile on any change to which plugin ids are referenced anywhere
    // (active or next) — ensures GO transitions are snappy.
    const key = state.layers
      .map((l) => {
        const active = l.clips[l.activeClipIdx]?.pluginId ?? "";
        const next = l.clips[l.nextClipIdx]?.pluginId ?? "";
        return `${active}/${next}:${l.mute ? 1 : 0}`;
      })
      .join("|");
    if (key !== this.lastReconcileKey) {
      this.lastReconcileKey = key;
      this.reconcileDirty = true;
      this.scheduleReconcile();
    }
  }

  private scheduleReconcile(): void {
    if (this.reconcilePending || !this.reconcileDirty) return;
    if (!this.state) return;
    this.reconcilePending = true;
    this.reconcileDirty = false;

    const wanted = new Set<string>();
    for (const layer of this.state.layers) {
      if (layer.mute) continue;
      const active = layer.clips[layer.activeClipIdx];
      if (active) wanted.add(active.pluginId);
      const next = layer.clips[layer.nextClipIdx];
      if (next) wanted.add(next.pluginId);
    }

    this.host
      .reconcileWanted(wanted)
      .catch((err) => console.error("[Composer] reconcile failed:", err))
      .finally(() => {
        this.reconcilePending = false;
        if (this.reconcileDirty) this.scheduleReconcile();
      });
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.host.setSize(window.innerWidth, window.innerHeight);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.rtFrom) this.rtFrom.setSize(w, h);
    if (this.rtTo) this.rtTo.setSize(w, h);
    if (this.rtPingA) this.rtPingA.setSize(w, h);
    if (this.rtPingB) this.rtPingB.setSize(w, h);
    // Resolution uniforms on postfx materials need to follow the window.
    for (const entry of this.postfxMaterials.values()) {
      const u = entry.material.uniforms.uResolution;
      if (u) (u.value as THREE.Vector2).set(w, h);
    }
  }

  private makeRT(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private ensureTransitionTargets(): void {
    if (this.rtFrom && this.rtTo) return;
    this.rtFrom = this.makeRT();
    this.rtTo = this.makeRT();
  }

  private ensurePingPongTargets(): void {
    if (this.rtPingA && this.rtPingB) return;
    this.rtPingA = this.makeRT();
    this.rtPingB = this.makeRT();
  }

  /**
   * Lazy-load a postfx shader the first time it shows up in state.postfx.
   * Source is fetched via IPC (main reads the plugin's `entry` file) and
   * wrapped in a ShaderMaterial with one `u_<key>` uniform per manifest
   * param plus shared `uTex` / `uResolution` / `uTime`.
   */
  private async loadPostFX(pluginId: string): Promise<void> {
    if (this.postfxMaterials.has(pluginId) || this.postfxPending.has(pluginId)) return;
    this.postfxPending.add(pluginId);
    try {
      const meta = this.allPlugins.find(
        (p) => p.id === pluginId && p.kind === "postfx",
      );
      if (!meta) throw new Error(`postfx plugin not found: ${pluginId}`);
      const source = await window.vj.readPluginSource("postfx", pluginId);
      if (!source) throw new Error(`postfx source not found: ${pluginId}`);

      const paramKeys = meta.params.map((p) => p.key);
      const uniforms: Record<string, THREE.IUniform> = {
        uTex: { value: this.blackTexture as THREE.Texture },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBar: { value: 0 },
        uBpm: { value: 128 },
      };
      for (const key of paramKeys) {
        uniforms[`u_${key}`] = { value: 0 };
      }

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: POSTFX_VERTEX_SHADER,
        fragmentShader: source,
      });

      this.postfxMaterials.set(pluginId, { pluginId, material, paramKeys });
      console.log(`[Composer] loaded postfx ${pluginId}`);
    } catch (err) {
      console.error(`[Composer] loadPostFX failed for ${pluginId}:`, err);
    } finally {
      this.postfxPending.delete(pluginId);
    }
  }

  private unloadPostFX(pluginId: string): void {
    const entry = this.postfxMaterials.get(pluginId);
    if (!entry) return;
    entry.material.dispose();
    this.postfxMaterials.delete(pluginId);
  }

  /**
   * Reconcile the postfx material cache with state.postfx: kick off lazy
   * loads for new effects, drop materials that have been removed entirely,
   * and push current param values into uniforms.
   */
  private syncPostFX(timeMs: number, beat: number, bar: number, bpm: number): void {
    if (!this.state) return;
    const wanted = new Set<string>();
    for (const slot of this.state.postfx) {
      wanted.add(slot.pluginId);
      const entry = this.postfxMaterials.get(slot.pluginId);
      if (!entry) {
        void this.loadPostFX(slot.pluginId);
        continue;
      }
      entry.material.uniforms.uTime.value = timeMs * 0.001;
      entry.material.uniforms.uBeat.value = beat;
      entry.material.uniforms.uBar.value = bar;
      entry.material.uniforms.uBpm.value = bpm;
      for (const key of entry.paramKeys) {
        const val = slot.params[key];
        const uniform = entry.material.uniforms[`u_${key}`];
        if (!uniform) continue;
        if (typeof val === "number") uniform.value = val;
        else if (typeof val === "boolean") uniform.value = val ? 1 : 0;
      }
    }
    // Drop materials that have been removed from state entirely.
    for (const id of [...this.postfxMaterials.keys()]) {
      if (!wanted.has(id)) this.unloadPostFX(id);
    }
  }

  start(): void {
    const tick = () => {
      const elapsed = this.clock.getElapsedTime();
      const timeMs = elapsed * 1000;
      const delta = timeMs - this.lastTime;
      this.lastTime = timeMs;

      // Derive beat/bar live from the anchor rather than reading the cached
      // state fields. This keeps the phase continuous between broadcasts.
      let beat = 0;
      let bar = 0;
      if (this.state && this.state.bpm > 0) {
        const beatsFromAnchor =
          ((Date.now() - this.state.beatAnchor) * this.state.bpm) / 60000;
        const frac = (x: number) => x - Math.floor(x);
        beat = frac(beatsFromAnchor);
        bar = frac(beatsFromAnchor / 4);
      }

      const global: GlobalUniforms = this.state
        ? {
            bpm: this.state.bpm,
            beat,
            bar,
            time: timeMs,
            delta,
            audio: this.state.audio,
          }
        : {
            bpm: 128,
            beat: 0,
            bar: 0,
            time: timeMs,
            delta,
            audio: { volume: 0, bass: 0, mid: 0, high: 0 },
          };

      if (this.state) {
        this.host.renderAll(global, this.state.layers);
      }

      this.displayMaterial.uniforms.uTime.value = elapsed;
      this.syncPostFX(elapsed * 1000, beat, bar, this.state?.bpm ?? 128);

      // ── Flash-zoom: compute scale before rendering so all paths use it ──
      if (this.state?.flashAt != null) {
        const flashElapsed = Date.now() - this.state.flashAt;
        if (flashElapsed < Composer.FLASH_DURATION_MS) {
          const ft = flashElapsed / Composer.FLASH_DURATION_MS;
          this.zoomScale = 1 + 0.06 * Math.pow(1 - ft, 2); // 6% punch, quadratic decay
        } else {
          this.zoomScale = 1;
        }
      } else {
        this.zoomScale = 1;
      }
      this.displayMaterial.uniforms.uZoomScale.value = this.zoomScale;
      this.presentMaterial.uniforms.uZoomScale.value = this.zoomScale;
      this.mixMaterial.uniforms.uZoomScale.value     = this.zoomScale;

      const transition = this.state?.transition;
      const now = Date.now();
      const inTransition =
        transition && transition.startedAt != null && transition.type !== "cut";

      // Does the user currently want any postfx applied? Transitions bypass
      // postfx in v1 for simplicity.
      const activePostFX =
        !inTransition && this.state
          ? this.state.postfx
              .filter((p) => p.enabled)
              .map((p) => this.postfxMaterials.get(p.pluginId))
              .filter((e): e is PostFXEntry => !!e)
          : [];

      if (inTransition && this.state) {
        this.ensureTransitionTargets();
        const progress = Math.min(
          (now - (transition!.startedAt as number)) / transition!.duration,
          1,
        );
        this.setCompositeSlots(this.state.layers, transition!.fromActive);
        this.renderer.setRenderTarget(this.rtFrom);
        this.renderer.render(this.displayScene, this.displayCamera);
        this.setCompositeSlots(this.state.layers, transition!.toActive);
        this.renderer.setRenderTarget(this.rtTo);
        this.renderer.render(this.displayScene, this.displayCamera);
        this.mixMaterial.uniforms.uFrom.value = this.rtFrom!.texture;
        this.mixMaterial.uniforms.uTo.value = this.rtTo!.texture;
        this.mixMaterial.uniforms.uProgress.value = progress;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.mixScene, this.displayCamera);
      } else if (this.state && activePostFX.length > 0) {
        // Compose into rtPingA, then chain postfx through ping-pong to screen.
        this.ensurePingPongTargets();
        this.setCompositeSlots(
          this.state.layers,
          this.state.layers.map((l) => l.activeClipIdx),
        );
        this.renderer.setRenderTarget(this.rtPingA);
        this.renderer.render(this.displayScene, this.displayCamera);

        let src = this.rtPingA!;
        let dst = this.rtPingB!;
        for (let i = 0; i < activePostFX.length; i++) {
          const entry = activePostFX[i];
          entry.material.uniforms.uTex.value = src.texture;
          this.presentQuad.material = entry.material;
          // Always write to dst so the final result stays in a texture;
          // presentMaterial then blits it to screen with flash-zoom applied.
          this.renderer.setRenderTarget(dst);
          this.renderer.render(this.presentScene, this.displayCamera);
          const tmp = src;
          src = dst;
          dst = tmp;
        }
        // Final blit with flash-zoom via presentMaterial (uZoomScale already set).
        this.presentMaterial.uniforms.uTex.value = src.texture;
        this.presentQuad.material = this.presentMaterial;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.presentScene, this.displayCamera);
      } else if (this.state) {
        // No transition and no postfx — direct composite to screen.
        this.setCompositeSlots(
          this.state.layers,
          this.state.layers.map((l) => l.activeClipIdx),
        );
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.displayScene, this.displayCamera);
      } else {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.displayScene, this.displayCamera);
      }

      // Flash overlay — applied on top of every render path.
      if (this.state?.flashAt != null) {
        const elapsed = Date.now() - this.state.flashAt;
        if (elapsed < Composer.FLASH_DURATION_MS) {
          const t = elapsed / Composer.FLASH_DURATION_MS;
          // Sharp attack (instant), quadratic decay.
          this.flashMaterial.uniforms.uFlash.value = Math.pow(1 - t, 2);
          this.renderer.setRenderTarget(null);
          // Disable autoClear so the flash overlay doesn't wipe the frame
          // that was just rendered by the main composite/postfx path.
          this.renderer.autoClear = false;
          this.renderer.render(this.flashScene, this.displayCamera);
          this.renderer.autoClear = true;
        }
      }

      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Populate the 4-layer composite uniforms. `activeIndices[i]` tells which
   * clip in `layers[i]` should be sampled (used so we can render the "from"
   * and "to" sides of a transition without mutating LayerState).
   */
  private setCompositeSlots(
    layers: LayerState[],
    activeIndices: number[],
  ): void {
    const slotTextures: (THREE.Texture | null)[] = [null, null, null, null];
    const slotOpacity = [0, 0, 0, 0];
    const slotBlend = [0, 0, 0, 0];
    const slotActive = [0, 0, 0, 0];

    const bounded = layers.slice(0, MAX_LAYERS);
    const anySolo = bounded.some((l) => l.solo);
    for (let i = 0; i < bounded.length; i++) {
      const layer = bounded[i];
      if (layer.mute) continue;
      if (anySolo && !layer.solo) continue;
      const idx = activeIndices[i] ?? -1;
      if (idx < 0) continue;
      const clip = layer.clips[idx];
      if (!clip) continue;
      const tex = this.host.getTexture(clip.pluginId);
      if (!tex) continue;
      slotTextures[i] = tex;
      slotOpacity[i] = layer.opacity;
      slotBlend[i] = BLEND_MODE[layer.blend] ?? 0;
      slotActive[i] = 1;
    }

    const u = this.displayMaterial.uniforms;
    u.uLayer0.value = slotTextures[0] ?? this.blackTexture;
    u.uLayer1.value = slotTextures[1] ?? this.blackTexture;
    u.uLayer2.value = slotTextures[2] ?? this.blackTexture;
    u.uLayer3.value = slotTextures[3] ?? this.blackTexture;
    u.uOpacity.value = slotOpacity;
    u.uBlend.value = slotBlend;
    u.uActive.value = slotActive;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.host.dispose();
    this.displayQuad.geometry.dispose();
    this.displayMaterial.dispose();
    this.mixQuad.geometry.dispose();
    this.mixMaterial.dispose();
    this.presentQuad.geometry.dispose();
    this.presentMaterial.dispose();
    this.rtFrom?.dispose();
    this.rtTo?.dispose();
    this.rtPingA?.dispose();
    this.rtPingB?.dispose();
    for (const entry of this.postfxMaterials.values()) entry.material.dispose();
    this.postfxMaterials.clear();
    this.flashMaterial.dispose();
    this.blackTexture.dispose();
    this.renderer.dispose();
  }
}
