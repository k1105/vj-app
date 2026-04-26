import * as THREE from "three";
import { easeCubicIn } from "d3-ease";
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
  /** Per-key type lookup so we only smooth float params (int/bool/etc snap). */
  paramTypes: Record<string, string>;
  /** Last lerped value pushed to each `u_<key>` uniform. */
  smoothed: Record<string, number>;
  /** Timestamp of the previous syncPostFX tick — for time-based lerp. */
  lastSyncMs: number;
  /**
   * Per-pass double-buffered render targets. Each frame, one is sampled as
   * `uPrev` (last frame's output) and the other is written to (this frame's
   * output). They swap every frame via `flip`. Avoids needing a separate
   * texture-to-texture copy.
   */
  rtA: THREE.WebGLRenderTarget;
  rtB: THREE.WebGLRenderTarget;
  flip: boolean;
}

// Smoothing time constant (seconds): roughly the time taken to cover ~63%
// of the distance to a new target. Short enough to feel responsive on a
// drag, long enough to filter MIDI / sync-step jumps.
const PARAM_SMOOTH_TAU_SEC = 0.06;

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

  // Flash effect: invert the framebuffer for FLASH_DURATION_MS. We snapshot
  // the current screen into a FramebufferTexture, then re-render via a quad
  // that mixes the original colour with its invert.
  private flashScene: THREE.Scene;
  private flashMaterial: THREE.ShaderMaterial;
  private flashCaptureTexture: THREE.FramebufferTexture | null = null;
  private static readonly FLASH_DURATION_MS = 120;
  // Flash-zoom: short, sharply-damped ring so the camera punch feels
  // crisp without leaving a lingering wobble.
  private static readonly FLASH_ZOOM_DURATION_MS = 240;
  private static readonly FLASH_ZOOM_AMPLITUDE = 0.04; // ±4 % of frame
  private static readonly FLASH_ZOOM_OSCILLATIONS = 1.25;

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
        uLayer0:     { value: this.blackTexture as THREE.Texture },
        uLayer1:     { value: this.blackTexture as THREE.Texture },
        uLayer2:     { value: this.blackTexture as THREE.Texture },
        uLayer3:     { value: this.blackTexture as THREE.Texture },
        uOpacity:    { value: [0, 0, 0, 0] },
        uBlend:      { value: [0, 0, 0, 0] },
        uActive:     { value: [0, 0, 0, 0] },
        // Per-layer texAspect / canvasAspect — used to apply CSS-`cover` UV
        // remap so video textures keep their aspect ratio. 1.0 = no remap.
        uLayerAspect:{ value: [1, 1, 1, 1] },
        uTime:       { value: 0 },
        uZoomScale:  { value: 1.0 },
        // When uBaseActive=1, the composite starts from uBase instead of
        // transparent black. Used for the postfx-boundary 2-pass path where
        // the postfx'd "below" group is the background for the "above" group.
        uBase:       { value: this.blackTexture as THREE.Texture },
        uBaseActive: { value: 0 },
      },
      vertexShader: ZOOM_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uLayer0;
        uniform sampler2D uLayer1;
        uniform sampler2D uLayer2;
        uniform sampler2D uLayer3;
        uniform sampler2D uBase;
        uniform int uBaseActive;
        uniform float uOpacity[4];
        uniform int uBlend[4];
        uniform int uActive[4];
        uniform float uLayerAspect[4];
        uniform float uTime;

        // CSS background-size:cover. r = texAspect / canvasAspect.
        //   r > 1 → texture is wider; sample a centred horizontal slice.
        //   r < 1 → texture is taller; sample a centred vertical slice.
        vec2 coverUV(vec2 uv, float r) {
          if (r > 1.0)        return vec2((uv.x - 0.5) / r + 0.5, uv.y);
          if (r > 0.0001)     return vec2(uv.x, (uv.y - 0.5) * r + 0.5);
          return uv;
        }

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
          if (idx == 0) return texture2D(uLayer0, coverUV(vUv, uLayerAspect[0]));
          if (idx == 1) return texture2D(uLayer1, coverUV(vUv, uLayerAspect[1]));
          if (idx == 2) return texture2D(uLayer2, coverUV(vUv, uLayerAspect[2]));
          return texture2D(uLayer3, coverUV(vUv, uLayerAspect[3]));
        }

        void main() {
          // Draw bottom-up so L1 (layers[0]) ends up on top — matches the
          // Controller's layer-list convention and Resolume-style apps.
          vec4 acc = uBaseActive == 1
            ? vec4(texture2D(uBase, vUv).rgb, 1.0)
            : vec4(0.0, 0.0, 0.0, 0.0);
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
        // 0 = crossfade, 1 = dissolve, 2 = wipe,
        // 3 = blackout (FROM → black → TO), 4 = whiteout (FROM → white → TO).
        uType:      { value: 0 },
      },
      vertexShader: ZOOM_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uFrom;
        uniform sampler2D uTo;
        uniform float uProgress;
        uniform int uType;

        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          float p = clamp(uProgress, 0.0, 1.0);
          vec4 a = texture2D(uFrom, vUv);
          vec4 b = texture2D(uTo, vUv);
          if (uType == 1) {
            // dissolve: each pixel switches once it crosses its random threshold
            float t = hash21(floor(vUv * 1024.0));
            gl_FragColor = t < p ? b : a;
          } else if (uType == 2) {
            // wipe: soft-edged horizontal sweep, left → right
            float edge = vUv.x;
            float w = 0.04;
            float k = smoothstep(p - w, p + w, edge);
            gl_FragColor = mix(b, a, k);
          } else if (uType == 3 || uType == 4) {
            // blackout / whiteout: FROM → solid → TO across two halves.
            vec3 hold = uType == 4 ? vec3(1.0) : vec3(0.0);
            vec4 mid = vec4(hold, 1.0);
            gl_FragColor = p < 0.5
              ? mix(a, mid, p * 2.0)
              : mix(mid, b, (p - 0.5) * 2.0);
          } else {
            gl_FragColor = mix(a, b, p);
          }
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

    // ── Flash invert pass ───────────────────────────────────────────────
    // Samples a snapshot of the framebuffer (uTex) and blends original ↔
    // its invert by uFlash. uTex is bound at render time after the snapshot.
    this.flashScene = new THREE.Scene();
    this.flashMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFlash: { value: 0 },
        uTex: { value: null },
      },
      vertexShader: POSTFX_VERTEX_SHADER,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform float uFlash;
        void main() {
          vec4 c = texture2D(uTex, vUv);
          // Rec.709 luma → grayscale, push contrast around 0.5, then invert.
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          float boosted = clamp((l - 0.5) * 2.8 + 0.5, 0.0, 1.0);
          vec3 invGray = vec3(1.0 - boosted);
          gl_FragColor = vec4(mix(c.rgb, invGray, clamp(uFlash, 0.0, 1.0)), c.a);
        }
      `,
      blending: THREE.NoBlending,
      depthWrite: false,
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
    // (active / next / transition.fromActive). Without pinning fromActive
    // here, an immediate-fire trigger would unmount the outgoing plugin
    // before the crossfade finishes.
    const txActive = state.transition?.startedAt != null;
    const fromKey = txActive
      ? state.layers
          .map((l, i) => l.clips[state.transition.fromActive[i] ?? -1]?.pluginId ?? "")
          .join(",")
      : "";
    const key =
      state.layers
        .map((l) => {
          const active = l.clips[l.activeClipIdx]?.pluginId ?? "";
          const next = l.clips[l.nextClipIdx]?.pluginId ?? "";
          return `${active}/${next}:${l.mute ? 1 : 0}`;
        })
        .join("|") + `|tx:${txActive ? 1 : 0}|from:${fromKey}`;
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
    const txActive = this.state.transition?.startedAt != null;
    for (let i = 0; i < this.state.layers.length; i++) {
      const layer = this.state.layers[i];
      if (layer.mute) continue;
      const active = layer.clips[layer.activeClipIdx];
      if (active) wanted.add(active.pluginId);
      const next = layer.clips[layer.nextClipIdx];
      if (next) wanted.add(next.pluginId);
      // Pin the outgoing plugin while a transition is running so the
      // crossfade's "from" side stays available even after activeClipIdx
      // has already been advanced (immediate-fire model).
      if (txActive) {
        const fromIdx = this.state.transition.fromActive[i] ?? -1;
        const fromClip = layer.clips[fromIdx];
        if (fromClip) wanted.add(fromClip.pluginId);
      }
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
    // Resolution uniforms + per-pass feedback RTs need to follow the window.
    for (const entry of this.postfxMaterials.values()) {
      const u = entry.material.uniforms.uResolution;
      if (u) (u.value as THREE.Vector2).set(w, h);
      entry.rtA.setSize(w, h);
      entry.rtB.setSize(w, h);
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
        // Last frame's output of this pass — for feedback shaders (Droste,
        // trails). Black on the first frame.
        uPrev: { value: this.blackTexture as THREE.Texture },
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

      const rtA = this.makeRT();
      const rtB = this.makeRT();
      const paramTypes: Record<string, string> = {};
      const smoothed: Record<string, number> = {};
      for (const p of meta.params) {
        paramTypes[p.key] = p.type;
        if (typeof p.default === "number") smoothed[p.key] = p.default;
      }
      this.postfxMaterials.set(pluginId, {
        pluginId,
        material,
        paramKeys,
        paramTypes,
        smoothed,
        lastSyncMs: 0,
        rtA,
        rtB,
        flip: false,
      });
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
    entry.rtA.dispose();
    entry.rtB.dispose();
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
      const dtMs = entry.lastSyncMs > 0 ? timeMs - entry.lastSyncMs : 0;
      entry.lastSyncMs = timeMs;
      const k =
        dtMs > 0
          ? 1 - Math.exp(-(dtMs * 0.001) / PARAM_SMOOTH_TAU_SEC)
          : 1;
      for (const key of entry.paramKeys) {
        const val = slot.params[key];
        const uniform = entry.material.uniforms[`u_${key}`];
        if (!uniform) continue;
        if (typeof val === "boolean") {
          uniform.value = val ? 1 : 0;
          continue;
        }
        if (typeof val !== "number") continue;
        // Only float params get lerped — int / step controls are meant to
        // snap, and shaders that read them as discrete values would break.
        if (entry.paramTypes[key] === "float") {
          const cur = entry.smoothed[key] ?? val;
          const next = cur + (val - cur) * k;
          entry.smoothed[key] = next;
          uniform.value = next;
        } else {
          entry.smoothed[key] = val;
          uniform.value = val;
        }
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

      // ── Flash-zoom: short sine ring damped by a cubic-in envelope on the
      // remaining time so the wobble decays fast and doesn't induce motion
      // sickness with frequent flashes.
      if (this.state?.flashAt != null) {
        const flashElapsed = Date.now() - this.state.flashAt;
        if (flashElapsed < Composer.FLASH_ZOOM_DURATION_MS) {
          const ft = flashElapsed / Composer.FLASH_ZOOM_DURATION_MS;
          const envelope = easeCubicIn(1 - ft); // (1-ft)^3 — fast initial decay
          const wave = Math.sin(ft * Composer.FLASH_ZOOM_OSCILLATIONS * Math.PI * 2);
          this.zoomScale = 1 + Composer.FLASH_ZOOM_AMPLITUDE * envelope * wave;
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

      const activePostFX =
        this.state
          ? this.state.postfx
              .filter((p) => p.enabled)
              .map((p) => this.postfxMaterials.get(p.pluginId))
              .filter((e): e is PostFXEntry => !!e)
          : [];

      // Run the enabled postfx chain starting from `srcRt`; returns the RT
      // holding the final result. Caller decides what to do with it.
      const runPostFXChain = (
        srcRt: THREE.WebGLRenderTarget,
      ): THREE.WebGLRenderTarget => {
        let src = srcRt;
        for (let i = 0; i < activePostFX.length; i++) {
          const entry = activePostFX[i];
          // Per-pass double buffer: write to one RT, sample the other (last
          // frame's output) as uPrev. Swap which is which every frame.
          const writeRT = entry.flip ? entry.rtB : entry.rtA;
          const readRT  = entry.flip ? entry.rtA : entry.rtB;
          entry.material.uniforms.uTex.value = src.texture;
          entry.material.uniforms.uPrev.value = readRT.texture;
          this.presentQuad.material = entry.material;
          this.renderer.setRenderTarget(writeRT);
          this.renderer.render(this.presentScene, this.displayCamera);
          src = writeRT;
          entry.flip = !entry.flip;
        }
        return src;
      };

      // Clear any rtPing reference left on postfx / present materials so the
      // next frame can write to the same RT without ANGLE flagging a
      // feedback loop on a stale binding.
      const detachChainSamplers = () => {
        for (const entry of activePostFX) {
          entry.material.uniforms.uTex.value = this.blackTexture;
          entry.material.uniforms.uPrev.value = this.blackTexture;
        }
        this.presentMaterial.uniforms.uTex.value = this.blackTexture;
        this.displayMaterial.uniforms.uBase.value = this.blackTexture;
      };

      // Blit an RT to the screen via presentMaterial (applies flash-zoom).
      const presentToScreen = (rt: THREE.WebGLRenderTarget): void => {
        this.presentMaterial.uniforms.uTex.value = rt.texture;
        this.presentQuad.material = this.presentMaterial;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.presentScene, this.displayCamera);
      };

      const boundary = this.state
        ? Math.max(0, Math.min(MAX_LAYERS, this.state.postfxBoundary ?? 0))
        : 0;

      if (inTransition && this.state) {
        this.ensureTransitionTargets();
        const progress = Math.min(
          (now - (transition!.startedAt as number)) / transition!.duration,
          1,
        );
        const fromActive = transition!.fromActive;
        const toActive = transition!.toActive;
        const transitionTypeId =
          transition!.type === "dissolve"
            ? 1
            : transition!.type === "wipe"
              ? 2
              : transition!.type === "blackout"
                ? 3
                : transition!.type === "whiteout"
                  ? 4
                  : 0;
        this.mixMaterial.uniforms.uType.value = transitionTypeId;

        if (
          activePostFX.length > 0 &&
          boundary > 0 &&
          boundary < MAX_LAYERS
        ) {
          // ── Boundary-aware transition ───────────────────────────────────
          // Pass A: mix(from, to) of below-boundary layers → postfx chain.
          // Pass B: mix(from, to) of above-boundary layers, composited on
          //         top of the postfxed result via uBase. Both sides honour
          //         the FROM/TO transition independently.
          this.ensurePingPongTargets();
          this.displayMaterial.uniforms.uBaseActive.value = 0;
          this.setCompositeSlots(this.state.layers, fromActive, (i) => i >= boundary);
          this.renderer.setRenderTarget(this.rtFrom);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.setCompositeSlots(this.state.layers, toActive, (i) => i >= boundary);
          this.renderer.setRenderTarget(this.rtTo);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.mixMaterial.uniforms.uFrom.value = this.rtFrom!.texture;
          this.mixMaterial.uniforms.uTo.value = this.rtTo!.texture;
          this.mixMaterial.uniforms.uProgress.value = progress;
          this.renderer.setRenderTarget(this.rtPingA);
          this.renderer.render(this.mixScene, this.displayCamera);
          const postfxedRt = runPostFXChain(this.rtPingA!);

          // Above-boundary layers composite on top of the postfxed result.
          this.displayMaterial.uniforms.uBase.value = postfxedRt.texture;
          this.displayMaterial.uniforms.uBaseActive.value = 1;
          this.setCompositeSlots(this.state.layers, fromActive, (i) => i < boundary);
          this.renderer.setRenderTarget(this.rtFrom);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.setCompositeSlots(this.state.layers, toActive, (i) => i < boundary);
          this.renderer.setRenderTarget(this.rtTo);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.displayMaterial.uniforms.uBaseActive.value = 0;

          this.mixMaterial.uniforms.uFrom.value = this.rtFrom!.texture;
          this.mixMaterial.uniforms.uTo.value = this.rtTo!.texture;
          this.mixMaterial.uniforms.uProgress.value = progress;
          this.renderer.setRenderTarget(null);
          this.renderer.render(this.mixScene, this.displayCamera);
          detachChainSamplers();
        } else {
          // No boundary split: composite all layers, then optionally postfx.
          this.displayMaterial.uniforms.uBaseActive.value = 0;
          this.setCompositeSlots(this.state.layers, fromActive);
          this.renderer.setRenderTarget(this.rtFrom);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.setCompositeSlots(this.state.layers, toActive);
          this.renderer.setRenderTarget(this.rtTo);
          this.renderer.render(this.displayScene, this.displayCamera);
          this.mixMaterial.uniforms.uFrom.value = this.rtFrom!.texture;
          this.mixMaterial.uniforms.uTo.value = this.rtTo!.texture;
          this.mixMaterial.uniforms.uProgress.value = progress;

          if (activePostFX.length > 0 && boundary === 0) {
            this.ensurePingPongTargets();
            this.renderer.setRenderTarget(this.rtPingA);
            this.renderer.render(this.mixScene, this.displayCamera);
            const finalRt = runPostFXChain(this.rtPingA!);
            presentToScreen(finalRt);
            detachChainSamplers();
          } else {
            this.renderer.setRenderTarget(null);
            this.renderer.render(this.mixScene, this.displayCamera);
          }
        }
      } else if (
        this.state &&
        activePostFX.length > 0 &&
        boundary > 0 &&
        boundary < MAX_LAYERS
      ) {
        // ── Postfx boundary (2-pass) ──────────────────────────────────────
        // Pass 1: composite layers[boundary..N-1] → postfx chain.
        // Pass 2: composite layers[0..boundary-1] on top of the postfx'd
        //         result via uBase. Zoom is applied on the final screen blit.
        this.ensurePingPongTargets();
        const activeIndices = this.state.layers.map((l) => l.activeClipIdx);
        this.displayMaterial.uniforms.uBaseActive.value = 0;
        this.setCompositeSlots(
          this.state.layers,
          activeIndices,
          (i) => i >= boundary,
        );
        this.renderer.setRenderTarget(this.rtPingA);
        this.renderer.render(this.displayScene, this.displayCamera);
        const postfxedRt = runPostFXChain(this.rtPingA!);

        this.setCompositeSlots(
          this.state.layers,
          activeIndices,
          (i) => i < boundary,
        );
        this.displayMaterial.uniforms.uBase.value = postfxedRt.texture;
        this.displayMaterial.uniforms.uBaseActive.value = 1;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.displayScene, this.displayCamera);
        this.displayMaterial.uniforms.uBaseActive.value = 0;
        detachChainSamplers();
      } else if (this.state && activePostFX.length > 0 && boundary === 0) {
        // Postfx applied to all layers (original path).
        this.ensurePingPongTargets();
        this.displayMaterial.uniforms.uBaseActive.value = 0;
        this.setCompositeSlots(
          this.state.layers,
          this.state.layers.map((l) => l.activeClipIdx),
        );
        this.renderer.setRenderTarget(this.rtPingA);
        this.renderer.render(this.displayScene, this.displayCamera);
        const finalRt = runPostFXChain(this.rtPingA!);
        presentToScreen(finalRt);
        detachChainSamplers();
      } else if (this.state) {
        // No postfx (either none enabled, or boundary === MAX_LAYERS).
        this.displayMaterial.uniforms.uBaseActive.value = 0;
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

      // Flash invert — snapshot the just-rendered framebuffer, then redraw
      // it through the invert shader.
      if (this.state?.flashAt != null) {
        const elapsed = Date.now() - this.state.flashAt;
        if (elapsed < Composer.FLASH_DURATION_MS) {
          const t = elapsed / Composer.FLASH_DURATION_MS;
          // Hold at full strength, then snap off near the end (almost no fade).
          const strength = 1 - Math.pow(t, 8);

          // Allocate / resize the snapshot texture to match the drawing buffer.
          const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
          const w = Math.max(1, Math.floor(size.x));
          const h = Math.max(1, Math.floor(size.y));
          const cap = this.flashCaptureTexture;
          if (!cap || cap.image.width !== w || cap.image.height !== h) {
            cap?.dispose();
            this.flashCaptureTexture = new THREE.FramebufferTexture(w, h);
          }

          this.renderer.setRenderTarget(null);
          this.renderer.copyFramebufferToTexture(this.flashCaptureTexture!);

          this.flashMaterial.uniforms.uTex.value = this.flashCaptureTexture;
          this.flashMaterial.uniforms.uFlash.value = strength;
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
   * `includeFilter`, if supplied, lets the postfx-boundary path render only
   * a subset of layer indices while keeping the others inactive.
   */
  private setCompositeSlots(
    layers: LayerState[],
    activeIndices: number[],
    includeFilter?: (layerIdx: number) => boolean,
  ): void {
    const slotTextures: (THREE.Texture | null)[] = [null, null, null, null];
    const slotOpacity = [0, 0, 0, 0];
    const slotBlend = [0, 0, 0, 0];
    const slotActive = [0, 0, 0, 0];
    const slotAspect = [1, 1, 1, 1];

    const canvas = this.renderer.domElement;
    const canvasAspect =
      canvas.height > 0 ? canvas.width / canvas.height : 1;
    const textureAspect = (tex: THREE.Texture): number => {
      const img = tex.image as
        | (HTMLVideoElement & { videoWidth: number; videoHeight: number })
        | (HTMLCanvasElement & { width: number; height: number })
        | { width?: number; height?: number }
        | null
        | undefined;
      if (!img) return canvasAspect;
      if (typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement) {
        if (img.videoWidth > 0 && img.videoHeight > 0) {
          return img.videoWidth / img.videoHeight;
        }
        return canvasAspect;
      }
      if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) {
        if (img.width > 0 && img.height > 0) return img.width / img.height;
        return canvasAspect;
      }
      // RenderTarget textures and DataTextures expose width/height directly.
      const w = (img as { width?: number }).width ?? 0;
      const h = (img as { height?: number }).height ?? 0;
      return w > 0 && h > 0 ? w / h : canvasAspect;
    };

    const bounded = layers.slice(0, MAX_LAYERS);
    const anySolo = bounded.some((l) => l.solo);
    for (let i = 0; i < bounded.length; i++) {
      if (includeFilter && !includeFilter(i)) continue;
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
      slotAspect[i] = canvasAspect > 0 ? textureAspect(tex) / canvasAspect : 1;
    }

    const u = this.displayMaterial.uniforms;
    u.uLayer0.value = slotTextures[0] ?? this.blackTexture;
    u.uLayer1.value = slotTextures[1] ?? this.blackTexture;
    u.uLayer2.value = slotTextures[2] ?? this.blackTexture;
    u.uLayer3.value = slotTextures[3] ?? this.blackTexture;
    u.uOpacity.value = slotOpacity;
    u.uBlend.value = slotBlend;
    u.uActive.value = slotActive;
    u.uLayerAspect.value = slotAspect;
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
    for (const entry of this.postfxMaterials.values()) {
      entry.material.dispose();
      entry.rtA.dispose();
      entry.rtB.dispose();
    }
    this.postfxMaterials.clear();
    this.flashMaterial.dispose();
    this.flashCaptureTexture?.dispose();
    this.blackTexture.dispose();
    this.renderer.dispose();
  }
}
