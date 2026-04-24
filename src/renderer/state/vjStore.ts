import { create } from "zustand";
import type {
  LayerState,
  ParamValue,
  PluginMeta,
  TransitionType,
  VJState,
} from "../../shared/types";

const DEFAULT_TRANSITION_DURATION_MS = 1000;

const makeLayer = (id: number): LayerState => ({
  id,
  clips: [],
  activeClipIdx: -1,
  nextClipIdx: -1,
  opacity: id === 0 ? 1 : 0,
  blend: "normal",
  solo: false,
  mute: false,
});

const initialState: VJState = {
  bpm: 128,
  beatAnchor: Date.now(),
  beat: 0,
  bar: 0,
  audio: { volume: 0, bass: 0, mid: 0, high: 0 },
  layers: [makeLayer(0), makeLayer(1), makeLayer(2), makeLayer(3)],
  selectedLayer: 0,
  transition: {
    type: "cut",
    startedAt: null,
    duration: DEFAULT_TRANSITION_DURATION_MS,
    fromActive: [-1, -1, -1, -1],
    toActive: [-1, -1, -1, -1],
  },
  postfx: [],
  flashAt: null,
};

interface VJStoreShape {
  state: VJState;
  plugins: PluginMeta[];
  loadPlugins: () => Promise<void>;
  /**
   * Append a clip to a layer's bin. The new clip is staged as NEXT. If the
   * layer was empty, it is promoted to LIVE immediately so the first drop
   * plays without needing to press GO.
   */
  addClip: (layerIdx: number, pluginId: string) => void;
  /** Queue a clip as the layer's NEXT (click to trigger, requires GO). */
  triggerClip: (layerIdx: number, clipIdx: number) => void;
  /** Remove a clip from a layer's bin. Adjusts active/next indices. */
  removeClip: (layerIdx: number, clipIdx: number) => void;
  /**
   * Move a clip (with its params) from one layer to another. No-op if
   * source and destination are the same. The moved clip lands at the end
   * of the destination bin and becomes its NEXT; if the destination was
   * empty, it also becomes LIVE so playback starts immediately.
   */
  moveClip: (fromLayer: number, fromClipIdx: number, toLayer: number) => void;
  setLayerOpacity: (layerIdx: number, opacity: number) => void;
  setLayerBlend: (layerIdx: number, blend: LayerState["blend"]) => void;
  setLayerMute: (layerIdx: number, mute: boolean) => void;
  setLayerSolo: (layerIdx: number, solo: boolean) => void;
  setTransitionType: (type: TransitionType) => void;
  /** Promote NEXT to LIVE. For `cut`, immediate. For others, starts a timed transition. */
  commitGo: () => void;
  selectLayer: (layerIdx: number) => void;
  setBPM: (bpm: number) => void;
  /**
   * Tap-tempo. Each call records the current timestamp and, if enough taps
   * are in the recent window, updates state.bpm to the averaged interval
   * and snaps beatAnchor to the latest tap so beat 0 lines up with it.
   */
  tap: () => void;
  /** Flip a postfx slot's enabled flag. Lazy-inserts if not present. */
  togglePostFX: (pluginId: string) => void;
  /** Set a single param on an existing postfx slot. No-op if not present. */
  setPostFXParam: (
    pluginId: string,
    key: string,
    value: ParamValue,
  ) => void;
  /** Set a single param on an active clip. Immediately broadcasts. */
  setClipParam: (
    layerIdx: number,
    clipIdx: number,
    key: string,
    value: ParamValue,
  ) => void;
  /** Set flashAt to now. Composer picks it up and decays the overlay per-frame. */
  triggerFlash: () => void;
  broadcastState: () => void;
}

// throttle-with-trailing-edge broadcaster
// Sends immediately on the first call, then at most once per 16 ms.
// A pending flag ensures the last value always gets sent even if calls
// kept arriving within the throttle window (important for MIDI CC sweeps).
let broadcastTimer: number | null = null;
let broadcastPending = false;
// handle to cancel an in-flight transition commit if the user presses GO again
let pendingTransitionCommit: number | null = null;

// Tap-tempo state — rolling buffer of the last N tap timestamps. Taps more
// than TAP_RESET_MS apart start a fresh session so the user can re-tap at a
// new tempo without old data skewing the average.
const TAP_RESET_MS = 2000;
const TAP_COUNT = 4;
// Minimum interval between accepted taps (ms). Filters MIDI note-off / CC-0
// double-fires that arrive a few ms after the real tap and would halve the
// measured interval — doubling the calculated BPM.
const TAP_MIN_MS = 100;
let tapHistory: number[] = [];
let lastTapTime = 0;

export const useVJStore = create<VJStoreShape>((set, get) => ({
  state: initialState,
  plugins: [],

  loadPlugins: async () => {
    const plugins = await window.vj.listPlugins();
    set({ plugins });
  },

  addClip: (layerIdx, pluginId) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) => {
        if (i !== layerIdx) return l;
        // Seed clip params with manifest defaults so controls show correct initial values.
        const meta = s.plugins.find((p) => p.id === pluginId);
        const params: Record<string, ParamValue> = {};
        for (const def of meta?.params ?? []) params[def.key] = def.default;
        const clips = [...l.clips, { pluginId, params }];
        const newIdx = clips.length - 1;
        // First drop into an empty layer auto-plays; later drops stage NEXT only.
        const wasEmpty = l.activeClipIdx === -1;
        return {
          ...l,
          clips,
          activeClipIdx: wasEmpty ? newIdx : l.activeClipIdx,
          nextClipIdx: newIdx,
        };
      });
      return { state: { ...s.state, layers, selectedLayer: layerIdx } };
    });
  },

  triggerClip: (layerIdx, clipIdx) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) =>
        i === layerIdx ? { ...l, nextClipIdx: clipIdx } : l,
      );
      return { state: { ...s.state, layers, selectedLayer: layerIdx } };
    });
  },

  removeClip: (layerIdx, clipIdx) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) => {
        if (i !== layerIdx) return l;
        const clips = l.clips.filter((_, j) => j !== clipIdx);
        const adjust = (idx: number): number => {
          if (clips.length === 0) return -1;
          if (idx === clipIdx) return Math.min(idx, clips.length - 1);
          if (idx > clipIdx) return idx - 1;
          return idx;
        };
        return {
          ...l,
          clips,
          activeClipIdx: adjust(l.activeClipIdx),
          nextClipIdx: adjust(l.nextClipIdx),
        };
      });
      return { state: { ...s.state, layers } };
    });
  },

  moveClip: (fromLayer, fromClipIdx, toLayer) => {
    if (fromLayer === toLayer) return;
    set((s) => {
      const src = s.state.layers[fromLayer];
      if (!src) return s;
      const clip = src.clips[fromClipIdx];
      if (!clip) return s;

      const layers = s.state.layers.map((l, i) => {
        if (i === fromLayer) {
          const clips = l.clips.filter((_, j) => j !== fromClipIdx);
          const adjust = (idx: number): number => {
            if (clips.length === 0) return -1;
            if (idx === fromClipIdx) return Math.min(idx, clips.length - 1);
            if (idx > fromClipIdx) return idx - 1;
            return idx;
          };
          return {
            ...l,
            clips,
            activeClipIdx: adjust(l.activeClipIdx),
            nextClipIdx: adjust(l.nextClipIdx),
          };
        }
        if (i === toLayer) {
          const clips = [...l.clips, clip];
          const newIdx = clips.length - 1;
          const wasEmpty = l.activeClipIdx === -1;
          return {
            ...l,
            clips,
            activeClipIdx: wasEmpty ? newIdx : l.activeClipIdx,
            nextClipIdx: newIdx,
          };
        }
        return l;
      });
      return { state: { ...s.state, layers, selectedLayer: toLayer } };
    });
  },

  setLayerOpacity: (layerIdx, opacity) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) =>
        i === layerIdx ? { ...l, opacity } : l,
      );
      return { state: { ...s.state, layers } };
    });
  },

  setLayerBlend: (layerIdx, blend) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) =>
        i === layerIdx ? { ...l, blend } : l,
      );
      return { state: { ...s.state, layers } };
    });
  },

  setLayerMute: (layerIdx, mute) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) =>
        i === layerIdx ? { ...l, mute } : l,
      );
      return { state: { ...s.state, layers } };
    });
  },

  setLayerSolo: (layerIdx, solo) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) =>
        i === layerIdx ? { ...l, solo } : l,
      );
      return { state: { ...s.state, layers } };
    });
  },

  setTransitionType: (type) => {
    set((s) => ({ state: { ...s.state, transition: { ...s.state.transition, type } } }));
  },

  commitGo: () => {
    const s = get();
    const type = s.state.transition.type;
    // Build the new activeClipIdx per layer using nextClipIdx when set.
    const resolveNext = (l: LayerState): number =>
      l.nextClipIdx >= 0 ? l.nextClipIdx : l.activeClipIdx;

    // cancel any pending timed commit
    if (pendingTransitionCommit !== null) {
      window.clearTimeout(pendingTransitionCommit);
      pendingTransitionCommit = null;
    }

    if (type === "cut") {
      set((s2) => {
        const layers = s2.state.layers.map((l) => ({
          ...l,
          activeClipIdx: resolveNext(l),
        }));
        return {
          state: {
            ...s2.state,
            layers,
            transition: { ...s2.state.transition, startedAt: null },
          },
        };
      });
      return;
    }

    // Timed transition: snapshot from/to, start the clock, schedule commit.
    const fromActive = s.state.layers.map((l) => l.activeClipIdx);
    const toActive = s.state.layers.map((l) => resolveNext(l));
    const duration = s.state.transition.duration || DEFAULT_TRANSITION_DURATION_MS;
    set((s2) => ({
      state: {
        ...s2.state,
        transition: {
          ...s2.state.transition,
          startedAt: Date.now(),
          duration,
          fromActive,
          toActive,
        },
      },
    }));

    pendingTransitionCommit = window.setTimeout(() => {
      pendingTransitionCommit = null;
      set((s2) => {
        const layers = s2.state.layers.map((l, i) => ({
          ...l,
          activeClipIdx: toActive[i] ?? l.activeClipIdx,
        }));
        return {
          state: {
            ...s2.state,
            layers,
            transition: { ...s2.state.transition, startedAt: null },
          },
        };
      });
    }, duration);
  },

  togglePostFX: (pluginId) => {
    set((s) => {
      const existing = s.state.postfx.find((p) => p.pluginId === pluginId);
      let postfx;
      if (existing) {
        postfx = s.state.postfx.map((p) =>
          p.pluginId === pluginId ? { ...p, enabled: !p.enabled } : p,
        );
      } else {
        // Seed with default params from the plugin manifest.
        const plugin = s.plugins.find((p) => p.id === pluginId);
        const params: Record<string, ParamValue> = {};
        for (const def of plugin?.params ?? []) {
          params[def.key] = def.default;
        }
        postfx = [...s.state.postfx, { pluginId, enabled: true, params }];
      }
      return { state: { ...s.state, postfx } };
    });
  },

  setPostFXParam: (pluginId, key, value) => {
    set((s) => {
      const postfx = s.state.postfx.map((p) =>
        p.pluginId === pluginId ? { ...p, params: { ...p.params, [key]: value } } : p,
      );
      return { state: { ...s.state, postfx } };
    });
  },

  selectLayer: (layerIdx) =>
    set((s) => ({ state: { ...s.state, selectedLayer: layerIdx } })),

  setBPM: (bpm) =>
    set((s) => ({ state: { ...s.state, bpm, beatAnchor: Date.now() } })),

  tap: () => {
    const now = Date.now();
    // Debounce: drop taps that arrive suspiciously soon after the previous one.
    // Catches MIDI note-off / CC-value-0 arriving a few ms after the real tap.
    if (now - lastTapTime < TAP_MIN_MS) return;
    lastTapTime = now;
    const last = tapHistory[tapHistory.length - 1];
    if (last !== undefined && now - last > TAP_RESET_MS) {
      tapHistory = [];
    }
    tapHistory.push(now);
    if (tapHistory.length > TAP_COUNT) {
      tapHistory = tapHistory.slice(-TAP_COUNT);
    }
    // Every tap resets beatAnchor so the beat phase starts on the tap.
    set((s) => ({ state: { ...s.state, beatAnchor: now } }));
    // BPM is calculated only once we have a full TAP_COUNT window of taps.
    if (tapHistory.length < TAP_COUNT) return;
    const intervals: number[] = [];
    for (let i = 1; i < tapHistory.length; i++) {
      intervals.push(tapHistory[i] - tapHistory[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(Math.min(300, Math.max(30, 60000 / avg)));
    set((s) => ({ state: { ...s.state, bpm } }));
  },

  setClipParam: (layerIdx, clipIdx, key, value) => {
    set((s) => {
      const layers = s.state.layers.map((l, i) => {
        if (i !== layerIdx) return l;
        const clips = l.clips.map((c, j) =>
          j === clipIdx ? { ...c, params: { ...c.params, [key]: value } } : c,
        );
        return { ...l, clips };
      });
      return { state: { ...s.state, layers } };
    });
    get().broadcastState();
  },

  triggerFlash: () => {
    set((s) => ({ state: { ...s.state, flashAt: Date.now() } }));
  },

  broadcastState: () => {
    if (broadcastTimer !== null) {
      // Already throttling — mark that a trailing send is needed
      broadcastPending = true;
      return;
    }
    // First call in this window: send immediately
    window.vj.sendStateUpdate(get().state);
    broadcastTimer = window.setTimeout(() => {
      broadcastTimer = null;
      if (broadcastPending) {
        broadcastPending = false;
        window.vj.sendStateUpdate(get().state);
      }
    }, 16);
  },
}));
