import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
// Loaded lazily inside BuiltinSplatPlugin so the gaussian-splats-3d bundle
// is only paid for when a `splat` plugin actually mounts.
import { disposeObject3D, disposeVideo } from "../core/dispose";
import { createRenderTarget } from "../core/texture";
import type { LayerState, ParamValue, PluginMeta } from "../shared/types";

/**
 * PluginHost
 *
 * 素材プラグイン (material plugin) のライフサイクルを管理する。
 *
 *   reconcile(layers) → mount/unmount を差分適用
 *   renderAll(global)  → 各プラグインを自分の RenderTarget に描画
 *   getTexture(id)     → 描画結果のテクスチャを返す（Composer がコンポジット用に読む）
 *   dispose()          → すべてのプラグインを解放（メモリリーク対策の要）
 *
 * プラグイン契約:
 *   - plugin は default export class を持つ
 *   - setup(ctx) → THREE.Object3D | HTMLCanvasElement | HTMLVideoElement を返す
 *   - update({ global, params, inputTextures? }) を毎フレーム呼ぶ
 *   - dispose() を実装（3/27 事故の再発防止のため必須）
 *
 * プラグインは ctx.THREE を使うこと。Blob URL 経由の dynamic import では
 * "three" のような bare specifier は解決できないので、ここから渡す。
 */

export interface GlobalUniforms {
  bpm: number;
  beat: number;
  bar: number;
  time: number;
  delta: number;
  audio: { volume: number; bass: number; mid: number; high: number };
}

export interface PluginSetupContext {
  THREE: typeof THREE;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  GLTFLoader: typeof GLTFLoader;
  RoomEnvironment: typeof RoomEnvironment;
  EffectComposer: typeof EffectComposer;
  RenderPass: typeof RenderPass;
  OutputPass: typeof OutputPass;
  Pass: typeof Pass;
  FullScreenQuad: typeof FullScreenQuad;
}

export interface PluginUpdateContext {
  global: GlobalUniforms;
  params: Record<string, ParamValue>;
  inputTextures?: Record<string, THREE.Texture>;
}

export interface MaterialPluginInstance {
  setup(
    ctx: PluginSetupContext,
  ): THREE.Object3D | HTMLCanvasElement | HTMLVideoElement | void;
  update(ctx: PluginUpdateContext): void;
  dispose(): void;
}

interface MountedPlugin {
  id: string;
  meta: PluginMeta;
  instance: MaterialPluginInstance;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera; // always PerspectiveCamera at runtime
  renderTarget: THREE.WebGLRenderTarget;
  // null for built-in plugins (e.g. the video player) that don't come
  // from a dynamically imported blob.
  objectUrl: string | null;
  // For canvas/video outputs, we keep the CanvasTexture/VideoTexture here.
  // A `three`-type plugin uses renderTarget.texture instead.
  directTexture: THREE.Texture | null;
  /** Lerped float-param values, smoothed each frame toward clip.params. */
  smoothed: Record<string, number>;
}

// Smoothing time constant (seconds) for float clip params — kept in sync
// with the postfx-side constant in Composer.ts.
const PARAM_SMOOTH_TAU_SEC = 0.06;

/**
 * BuiltinVideoPlugin — driver for outputType:"video" plugins.
 *
 * A manifest with outputType:"video" carries a `videoFile` that main resolves
 * to a `vj-asset://...` URL. This class plays it via an HTMLVideoElement so
 * users don't have to ship JS for every downloaded clip.
 *
 * Params (all optional):
 *   playing   bool    — toggle play/pause
 *   speed     float   — playbackRate
 *   loopStart float   — normalized start of loop region (0-1)
 *   loopEnd   float   — normalized end of loop region (0-1)
 */
class BuiltinVideoPlugin implements MaterialPluginInstance {
  private video: HTMLVideoElement | null = null;
  private loopStartSec = 0; // seconds, kept in sync with params each frame
  private prevLoopStartSec = -1; // sentinel; first update() always counts as a change
  private isSeeking = false; // prevent seek spam across frames

  constructor(private readonly url: string) {}

  setup(_ctx: PluginSetupContext): void {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = this.url;
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    video.addEventListener("loadedmetadata", () =>
      console.log(`[video] loadedmetadata ${this.url} dur=${video.duration}`),
    );
    video.addEventListener("playing", () =>
      console.log(`[video] playing ${this.url}`),
    );
    video.addEventListener("ended", () => {
      // Natural end (or loopEnd = duration): seek back to loopStart.
      // play() is intentionally NOT called here — seeked handler does it
      // to avoid racing a play() call against an in-progress seek.
      this.isSeeking = true;
      video.currentTime = Math.min(this.loopStartSec, video.duration || 0);
    });
    video.addEventListener("seeked", () => {
      this.isSeeking = false;
      // Always resume after any seek (loop, loopEnd wrap, or initial start).
      void video.play().catch(() => {});
    });
    video.addEventListener("error", () => {
      this.isSeeking = false;
      if (video.error?.code === MediaError.MEDIA_ERR_ABORTED) return; // seek interrupted — not fatal
      console.error(`[video] error ${this.url}`, video.error);
    });

    video.play().catch((err) => {
      console.warn(`[video] play() rejected ${this.url}`, err);
    });
    this.video = video;
  }

  getElement(): HTMLVideoElement {
    if (!this.video) throw new Error("BuiltinVideoPlugin: setup() not called");
    return this.video;
  }

  update({ params }: PluginUpdateContext): void {
    const video = this.video;
    if (!video) return;

    // play / pause — skip while seeking to avoid interrupting a loop seek
    const playing = params.playing;
    if (playing === false) {
      if (!video.paused) video.pause();
    } else {
      if (video.paused && !this.isSeeking) void video.play().catch(() => {});
    }

    const speed = typeof params.speed === "number" ? params.speed : 1;
    if (video.playbackRate !== speed && speed > 0) video.playbackRate = speed;

    // loopStart / loopEnd are in seconds (not normalised 0-1)
    const loopStartSec = typeof params.loopStart === "number" ? params.loopStart : 0;
    const loopEndSec   = typeof params.loopEnd   === "number" ? params.loopEnd   : Infinity;
    const newLoopStartSec = Math.max(0, loopStartSec);
    const loopStartChanged = newLoopStartSec !== this.prevLoopStartSec;
    this.loopStartSec     = newLoopStartSec;
    this.prevLoopStartSec = newLoopStartSec;

    const duration = video.duration || 0;
    if (duration > 0 && !this.isSeeking) {
      const s = Math.min(this.loopStartSec, duration);
      // Upper bound: enforce loopEnd in-frame when set below duration.
      //   When loopEnd >= duration, the natural 'ended' event handles the wrap.
      if (loopEndSec < duration) {
        const e = Math.max(s + 0.05, Math.min(loopEndSec, duration));
        if (video.currentTime >= e) {
          this.isSeeking = true;
          video.currentTime = s;
        }
      }
      // Lower bound: only re-seek when loopStart was just changed by the user
      //   (or on first frame). Continuous enforcement deadlocks the player when
      //   the browser snaps the seek target to a keyframe slightly before `s`.
      if (loopStartChanged && video.currentTime < s && !this.isSeeking) {
        this.isSeeking = true;
        video.currentTime = s;
      }
    }
  }

  dispose(): void {
    disposeVideo(this.video);
    this.video = null;
  }
}

/**
 * BuiltinSplatPlugin — driver for outputType:"splat" plugins.
 *
 * Loads a Gaussian Splatting scene (.splat / .ply / .ksplat) via
 * @mkkellogg/gaussian-splats-3d's DropInViewer (a THREE.Group) and exposes
 * a small set of camera params so the scene can be flown around like a
 * regular VJ asset.
 *
 * Params (all optional, sensible defaults):
 *   posX/posY/posZ         camera position
 *   targetX/targetY/targetZ camera lookAt point
 *   fov                    vertical field of view (degrees)
 *   orbitSpeed             passive rotation around the target Y axis (rad/s)
 */
class BuiltinSplatPlugin implements MaterialPluginInstance {
  private group: THREE.Group | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private viewer: any = null;
  private hostScene: THREE.Scene | null = null;
  private hostCamera: THREE.PerspectiveCamera | null = null;
  private orbit = 0;
  // Set true the moment dispose() runs so any in-flight async setup work
  // (dynamic import, addSplatScene) bails out before mutating GPU state.
  private disposed = false;

  constructor(private readonly url: string) {}

  setup(ctx: PluginSetupContext): void {
    this.hostScene = ctx.scene;
    this.hostCamera = ctx.camera;
    // Lazy import keeps the heavy bundle out of the main entry chunk.
    void import(
      /* @vite-ignore */ "@mkkellogg/gaussian-splats-3d"
    )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((mod: any) => {
        if (this.disposed || !this.hostScene) return;
        const dropIn = new mod.DropInViewer({
          // CPU-side sort. The GPU sort path opens a parallel WebGL context
          // that doesn't share state with our off-screen render target —
          // when active, the splat renders but its output never reaches our
          // pipeline, leaving the layer black.
          gpuAcceleratedSort: false,
          sharedMemoryForWorkers: false,
          sphericalHarmonicsDegree: 0,
        });
        this.viewer = dropIn;
        this.group = dropIn as unknown as THREE.Group;
        // SHARP / most 3DGS outputs use OpenCV camera convention
        // (y down, z forward). Three.js uses y up, z toward viewer.
        // A 180° rotation about X aligns the two so the splat appears in
        // front of our default camera.
        this.group.rotation.x = Math.PI;
        this.hostScene.add(this.group);
        console.log(`[splat] loading ${this.url}`);
        const t0 = performance.now();
        // Don't pass progressiveLoad — it's only valid for .splat/.ksplat,
        // and SHARP-generated assets are .ply.
        const promise = dropIn.addSplatScene(this.url);
        // Some lib versions return an AbortablePromise; fall back gracefully.
        Promise.resolve(promise)
          .then(() => {
            const dt = ((performance.now() - t0) / 1000).toFixed(2);
            if (this.disposed) {
              console.log(`[splat] load finished after dispose (${dt}s) — releasing`);
              this.cleanupViewer();
              return;
            }
            const splatMesh =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (dropIn as any).splatMesh ?? (dropIn as any).viewer?.splatMesh;
            const inViewer = splatMesh ? splatMesh.parent === dropIn : false;
            console.log(
              `[splat] loaded in ${dt}s · splatMesh=${!!splatMesh} attached=${inViewer}`,
            );
            if (splatMesh) {
              // Splat meshes use shader-based instancing without a standard
              // bounding box, so Three's frustum culling treats them as
              // empty and skips rendering. Force them to always draw.
              splatMesh.frustumCulled = false;
              splatMesh.traverse((child: THREE.Object3D) => {
                child.frustumCulled = false;
              });
            }
          })
          .catch((err: unknown) =>
            console.error(`[splat] addSplatScene failed:`, err),
          );
      })
      .catch((err) => {
        console.error(`[splat] dynamic import failed:`, err);
      });
  }

  private cleanupViewer(): void {
    const viewer = this.viewer;
    const group = this.group;
    const scene = this.hostScene;
    if (group && scene) scene.remove(group);
    if (viewer) {
      try {
        if (typeof viewer.removeSplatScene === "function") {
          // Best-effort: remove the loaded scene before disposing the viewer
          // so any internal sort workers / GPU buffers tied to it release.
          const result = viewer.removeSplatScene(0);
          if (result && typeof result.then === "function") {
            result.catch(() => {});
          }
        }
      } catch (err) {
        console.warn(`[splat] removeSplatScene threw:`, err);
      }
      try {
        if (typeof viewer.dispose === "function") viewer.dispose();
      } catch (err) {
        console.warn(`[splat] viewer.dispose threw:`, err);
      }
    }
    this.group = null;
    this.viewer = null;
  }

  update({ params, global }: PluginUpdateContext): void {
    const camera = this.hostCamera;
    if (!camera) return;
    const dt = Math.max(0, (global?.delta ?? 16) * 0.001);
    const orbitSpeed = num(params.orbitSpeed, 0);
    this.orbit += orbitSpeed * dt;

    const targetX = num(params.targetX, 0);
    const targetY = num(params.targetY, 0);
    const targetZ = num(params.targetZ, 0);
    const posX = num(params.posX, 0);
    const posY = num(params.posY, 1);
    const posZ = num(params.posZ, 3);

    // Apply orbit as a rotation around the target's Y axis. Cheap per-frame
    // transform — keeps the user's pos params as the "base" position.
    const c = Math.cos(this.orbit);
    const s = Math.sin(this.orbit);
    const dx = posX - targetX;
    const dz = posZ - targetZ;
    camera.position.set(
      targetX + dx * c - dz * s,
      posY,
      targetZ + dx * s + dz * c,
    );
    camera.lookAt(targetX, targetY, targetZ);

    const fov = num(params.fov, 50);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupViewer();
    this.hostScene = null;
    this.hostCamera = null;
  }
}

function num(v: ParamValue | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

export class PluginHost {
  private mounted = new Map<string, MountedPlugin>();
  private metas = new Map<string, PluginMeta>();
  private width = 1280;
  private height = 720;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const m of this.mounted.values()) {
      m.renderTarget.setSize(width, height);
      m.camera.aspect = width / height;
      m.camera.updateProjectionMatrix();
    }
  }

  setMetas(metas: PluginMeta[]): void {
    this.metas.clear();
    for (const m of metas) {
      if (m.kind === "material") this.metas.set(m.id, m);
    }
  }

  /**
   * Ensure exactly `wanted` are mounted. Unmounts anything not in the set.
   * The caller (Composer) decides which plugin ids to keep alive — typically
   * the union of every layer's active + next clip, so GO triggers are snappy.
   */
  async reconcileWanted(wanted: Set<string>): Promise<void> {
    for (const id of [...this.mounted.keys()]) {
      if (!wanted.has(id)) this.unmount(id);
    }
    for (const id of wanted) {
      if (!this.mounted.has(id)) {
        try {
          await this.mount(id);
        } catch (err) {
          console.error(`[PluginHost] mount failed for "${id}":`, err);
        }
      }
    }
  }

  private async mount(id: string): Promise<void> {
    const meta = this.metas.get(id);
    if (!meta) throw new Error(`meta not found: ${id}`);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      this.width / this.height,
      0.1,
      100,
    );
    camera.position.set(0, 0, 3);
    const renderTarget = createRenderTarget(this.width, this.height);

    // outputType === "splat" uses a built-in Gaussian-Splatting driver.
    if (meta.outputType === "splat") {
      if (!meta.splatUrl) {
        throw new Error(`splat plugin ${id} has no splatUrl`);
      }
      const instance = new BuiltinSplatPlugin(meta.splatUrl);
      instance.setup({
        THREE,
        renderer: this.renderer,
        scene,
        camera,
        width: this.width,
        height: this.height,
        GLTFLoader,
        RoomEnvironment,
        EffectComposer,
        RenderPass,
        OutputPass,
        Pass,
        FullScreenQuad,
      });
      this.mounted.set(id, {
        id,
        meta,
        instance,
        scene,
        camera,
        renderTarget,
        objectUrl: null,
        directTexture: null,
        smoothed: {},
      });
      return;
    }

    // outputType === "video" uses a built-in player — no JS source needed.
    if (meta.outputType === "video") {
      if (!meta.videoUrl) {
        throw new Error(`video plugin ${id} has no videoUrl`);
      }
      console.log(`[PluginHost] mounting video ${id} url=${meta.videoUrl}`);
      const instance = new BuiltinVideoPlugin(meta.videoUrl);
      instance.setup({
        THREE,
        renderer: this.renderer,
        scene,
        camera,
        width: this.width,
        height: this.height,
        GLTFLoader,
        RoomEnvironment,
        EffectComposer,
        RenderPass,
        OutputPass,
        Pass,
        FullScreenQuad,
      });
      const videoEl = instance.getElement();
      const directTexture = new THREE.VideoTexture(videoEl);
      directTexture.minFilter = THREE.LinearFilter;
      directTexture.magFilter = THREE.LinearFilter;
      directTexture.colorSpace = THREE.SRGBColorSpace;
      this.mounted.set(id, {
        id,
        meta,
        instance,
        scene,
        camera,
        renderTarget,
        objectUrl: null,
        directTexture,
        smoothed: {},
      });
      return;
    }

    const source = await window.vj.readPluginSource(meta.kind, id);
    if (!source) throw new Error(`plugin source not found: ${id}`);

    const blob = new Blob([source], { type: "text/javascript" });
    const objectUrl = URL.createObjectURL(blob);

    let mod: { default?: new () => MaterialPluginInstance };
    try {
      mod = (await import(/* @vite-ignore */ objectUrl)) as {
        default?: new () => MaterialPluginInstance;
      };
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      throw err;
    }
    const Ctor = mod.default;
    if (typeof Ctor !== "function") {
      URL.revokeObjectURL(objectUrl);
      throw new Error(`plugin ${id} has no default export class`);
    }

    const instance = new Ctor();
    const setupResult = instance.setup({
      THREE,
      renderer: this.renderer,
      scene,
      camera,
      width: this.width,
      height: this.height,
      GLTFLoader,
      RoomEnvironment,
      EffectComposer,
      RenderPass,
      OutputPass,
      Pass,
      FullScreenQuad,
    });

    let directTexture: THREE.Texture | null = null;
    if (setupResult instanceof THREE.Object3D) {
      scene.add(setupResult);
    } else if (
      typeof HTMLCanvasElement !== "undefined" &&
      setupResult instanceof HTMLCanvasElement
    ) {
      directTexture = new THREE.CanvasTexture(setupResult);
      directTexture.minFilter = THREE.LinearFilter;
      directTexture.magFilter = THREE.LinearFilter;
    } else if (
      typeof HTMLVideoElement !== "undefined" &&
      setupResult instanceof HTMLVideoElement
    ) {
      directTexture = new THREE.VideoTexture(setupResult);
      directTexture.minFilter = THREE.LinearFilter;
      directTexture.magFilter = THREE.LinearFilter;
      directTexture.colorSpace = THREE.SRGBColorSpace;
    }
    // If setupResult is void, the plugin manages its own scene additions.

    this.mounted.set(id, {
      id,
      meta,
      instance,
      scene,
      camera,
      renderTarget,
      objectUrl,
      directTexture,
      smoothed: {},
    });
  }

  private unmount(id: string): void {
    const m = this.mounted.get(id);
    if (!m) return;
    try {
      m.instance.dispose();
    } catch (err) {
      console.warn(`[PluginHost] dispose() threw for ${id}:`, err);
    }
    disposeObject3D(m.scene);
    m.renderTarget.dispose();
    if (m.directTexture) m.directTexture.dispose();
    if (m.objectUrl) URL.revokeObjectURL(m.objectUrl);
    this.mounted.delete(id);
  }

  /**
   * Update every mounted plugin, then render each `three`-type plugin
   * into its own render target. Canvas/Video plugins just mark their
   * texture as dirty via the update() call.
   */
  renderAll(global: GlobalUniforms, layers: LayerState[]): void {
    // Lerp coefficient for float-param smoothing. delta is in ms.
    const dtSec = Math.max(0, global.delta) * 0.001;
    const k =
      dtSec > 0 ? 1 - Math.exp(-dtSec / PARAM_SMOOTH_TAU_SEC) : 1;
    // Prefer the active clip's params; during a transition the plugin may
    // only appear in NEXT, so fall back to nextClipIdx — otherwise the TO
    // side renders with empty params (all manifest defaults).
    for (const m of this.mounted.values()) {
      let params: Record<string, ParamValue> = {};
      let found = false;
      for (const layer of layers) {
        const clip =
          layer.activeClipIdx >= 0 ? layer.clips[layer.activeClipIdx] : null;
        if (clip && clip.pluginId === m.id) {
          params = clip.params;
          found = true;
          break;
        }
      }
      if (!found) {
        for (const layer of layers) {
          const clip =
            layer.nextClipIdx >= 0 ? layer.clips[layer.nextClipIdx] : null;
          if (clip && clip.pluginId === m.id) {
            params = clip.params;
            break;
          }
        }
      }
      // Smooth float params toward their target each frame; int / bool /
      // enum / strings / camera / color stay raw so discrete behaviour
      // (snap, toggle, dropdown selection) isn't blurred.
      const smoothedParams: Record<string, ParamValue> = { ...params };
      for (const def of m.meta.params) {
        if (def.type !== "float") continue;
        const target = params[def.key];
        if (typeof target !== "number") continue;
        const cur = m.smoothed[def.key];
        const next = cur === undefined ? target : cur + (target - cur) * k;
        m.smoothed[def.key] = next;
        smoothedParams[def.key] = next;
      }
      try {
        m.instance.update({ global, params: smoothedParams });
      } catch (err) {
        console.warn(`[PluginHost] update() threw for ${m.id}:`, err);
      }
      if (m.directTexture) {
        if (m.directTexture instanceof THREE.CanvasTexture) {
          m.directTexture.needsUpdate = true;
        }
        // VideoTexture updates itself.
        continue;
      }
      this.renderer.setRenderTarget(m.renderTarget);
      this.renderer.clear();
      this.renderer.render(m.scene, m.camera);
    }
    this.renderer.setRenderTarget(null);
  }

  /** Texture to sample when compositing the given plugin as a layer. */
  getTexture(pluginId: string): THREE.Texture | null {
    const m = this.mounted.get(pluginId);
    if (!m) return null;
    return m.directTexture ?? m.renderTarget.texture;
  }

  dispose(): void {
    for (const id of [...this.mounted.keys()]) this.unmount(id);
  }
}
