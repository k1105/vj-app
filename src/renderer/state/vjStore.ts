import { create } from "zustand";
import type {
  Deck,
  LayerState,
  ParamValue,
  PluginMeta,
  PostFXSlot,
  TransitionType,
  VJState,
} from "../../shared/types";
import { POSTFX_SLOT_COUNT } from "../../shared/types";

const DEFAULT_TRANSITION_DURATION_MS = 1000;

const emptySlot = (): PostFXSlot => ({ pluginId: null, enabled: false, params: {} });
const makeSlots = (): PostFXSlot[] =>
  Array.from({ length: POSTFX_SLOT_COUNT }, () => emptySlot());

const makeLayer = (id: number): LayerState => ({
  id,
  clips: [],
  activeClipIdx: -1,
  nextClipIdx: -1,
  opacity: 1,
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
    type: "wipe",
    startedAt: null,
    duration: DEFAULT_TRANSITION_DURATION_MS,
    fromActive: [-1, -1, -1, -1],
    toActive: [-1, -1, -1, -1],
  },
  postfx: makeSlots(),
  postfxBoundary: 0,
  flashAt: null,
  burstAt: null,
};

interface VJStoreShape {
  state: VJState;
  plugins: PluginMeta[];
  /**
   * STAGE mode. When true, the Output is frozen on `liveSnapshot` while the
   * Controller continues to mutate `state` freely. A subsequent release/GO
   * snaps the staged `state` to the Output. Realtime fields (bpm, audio,
   * flash...) are passed through to Output even in STAGE so timing stays sync.
   */
  stageMode: boolean;
  liveSnapshot: VJState | null;
  /** Enter STAGE mode: snapshot current state and freeze Output until release. */
  enterStage: () => void;
  /** Release STAGE: push `state` to Output and exit stage mode. v1: instant snap. */
  releaseStage: () => void;
  /** Cancel STAGE: revert `state` to the snapshot (preserves realtime fields). */
  cancelStage: () => void;
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
  /** Reorder a clip within the same layer. fromIdx → toIdx (insert-before semantics). */
  reorderClip: (layerIdx: number, fromIdx: number, toIdx: number) => void;
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
  /** Flip slot[slotIdx].enabled. Slots with null pluginId stay disabled. */
  togglePostFXSlot: (slotIdx: number) => void;
  /** Assign / unassign a plugin in slot[slotIdx]. Seeds default params. */
  setPostFXSlotPlugin: (slotIdx: number, pluginId: string | null) => void;
  /** Set a single param on slot[slotIdx]. */
  setPostFXSlotParam: (slotIdx: number, key: string, value: ParamValue) => void;
  /** Clear slot[slotIdx] (pluginId=null, enabled=false, params={}). */
  clearPostFXSlot: (slotIdx: number) => void;
  /** Currently focused postfx slot (drives editor highlight + scroll). */
  selectedPostFXSlot: number;
  selectPostFXSlot: (slotIdx: number) => void;
  /**
   * Restore the scene (layers / postfx / boundary / transition / bpm)
   * from electron-store on launch. Only writes recognized fields so a
   * stale save with extra junk doesn't corrupt anything. Marks the
   * postfx default-seed flag so loadPlugins() won't overwrite the
   * restored slots.
   */
  restoreScene: (saved: unknown) => void;
  /**
   * BPM source mode. AUTO = mic-driven realtime detector writes state.bpm.
   * MANUAL = user controls via TAP / MIDI. In AUTO, TAP only nudges the
   * beat phase (beatAnchor); BPM stays driven by the detector.
   */
  bpmAutoMode: boolean;
  /** Latest detector output. null when AUTO is off or no estimate yet. */
  bpmDetected: number | null;
  /** Detector "count" / confidence-ish from the latest event. */
  bpmConfidence: number;
  /** Whether the latest detector fire was a `bpmStable` (vs. running estimate). */
  bpmStable: boolean;
  setBpmAutoMode: (on: boolean) => void;
  setDetectedBpm: (tempo: number, confidence: number, stable: boolean) => void;
  /** Per-frame audio band update from the analyser (all 0..1). */
  setAudio: (volume: number, bass: number, mid: number, high: number) => void;
  /** Set the postfx application boundary. Clamped to [0, layers.length]. */
  setPostfxBoundary: (n: number) => void;
  /** Set a single param on an active clip. Immediately broadcasts. */
  setClipParam: (
    layerIdx: number,
    clipIdx: number,
    key: string,
    value: ParamValue,
  ) => void;
  /** Set flashAt to now. Composer picks it up and decays the overlay per-frame. */
  triggerFlash: () => void;
  /**
   * Hold-style BURST. Sets burstAt to now while on, null on off.
   * Composer drives a continuous high-frequency strobe (invert ↔ white)
   * while burstAt is non-null.
   */
  setBurst: (on: boolean) => void;
  broadcastState: () => void;
  /** All saved decks. Persisted to electron-store. */
  decks: Deck[];
  /** Overwrite decks list (called on boot to restore from store). */
  setDecks: (decks: Deck[]) => void;
  /** Snapshot current layers/postfx/boundary as a named deck. */
  saveDeck: (title: string) => void;
  /** Remove a deck by id. */
  deleteDeck: (id: string) => void;
  /** Rename a deck by id. */
  renameDeck: (id: string, title: string) => void;
  /**
   * Overwrite current state.layers / postfx / postfxBoundary with a saved
   * deck's contents. No-op if the id is unknown.
   */
  applyDeck: (id: string) => void;
}

// Default PostFX slot assignment, seeded once on the first plugin load if
// the user hasn't already arranged their own. Order = chain order.
const DEFAULT_POSTFX_SEEDS = ["droste", "thermal", "mirror", "glitch", "kaleidoscope", "drift"];
let postfxSeeded = false;

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

// Compute transition meta for an immediate-fire trigger on one layer.
// In STAGE mode, no transition is scheduled (Output is frozen). For "cut",
// no fade is needed. For other types, build a one-layer transition where
// only `layerIdx` differs between fromActive and toActive.
function computeLayerTransition(
  state: VJState,
  layerIdx: number,
  fromIdx: number,
  toIdx: number,
  stageMode: boolean,
): {
  transition: VJState["transition"] | null;
  scheduleClear: boolean;
  duration: number;
} {
  const type = state.transition.type;
  const noFade = stageMode || type === "cut" || fromIdx < 0 || fromIdx === toIdx;
  if (noFade) {
    return {
      transition: { ...state.transition, startedAt: null },
      scheduleClear: false,
      duration: 0,
    };
  }
  if (pendingTransitionCommit !== null) {
    window.clearTimeout(pendingTransitionCommit);
    pendingTransitionCommit = null;
  }
  const fromActive = state.layers.map((l) => l.activeClipIdx);
  const toActive = state.layers.map((l, i) => (i === layerIdx ? toIdx : l.activeClipIdx));
  const duration = state.transition.duration || DEFAULT_TRANSITION_DURATION_MS;
  return {
    transition: {
      ...state.transition,
      startedAt: Date.now(),
      duration,
      fromActive,
      toActive,
    },
    scheduleClear: true,
    duration,
  };
}

// Compose the state to send to Output. Returns `state` directly when LIVE.
// In STAGE mode the snapshot's "scene composition" fields freeze, but
// realtime fields (bpm/beatAnchor/audio/flashAt + cached beat/bar) flow
// through so timing & analysis stay in sync.
function buildBroadcastState(
  state: VJState,
  stageMode: boolean,
  snap: VJState | null,
): VJState {
  if (!stageMode || !snap) return state;
  return {
    ...snap,
    bpm: state.bpm,
    beatAnchor: state.beatAnchor,
    beat: state.beat,
    bar: state.bar,
    audio: state.audio,
    flashAt: state.flashAt,
    burstAt: state.burstAt,
  };
}

export const useVJStore = create<VJStoreShape>((set, get) => ({
  state: initialState,
  plugins: [],
  stageMode: false,
  liveSnapshot: null,
  selectedPostFXSlot: 0,
  decks: [],
  setDecks: (decks) => set({ decks }),
  saveDeck: (title) => {
    const s = get();
    const deck: Deck = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      title,
      layers: structuredClone(s.state.layers),
      postfx: structuredClone(s.state.postfx),
      postfxBoundary: s.state.postfxBoundary,
      createdAt: Date.now(),
    };
    const next = [...s.decks, deck];
    set({ decks: next });
    void window.vj.setSetting("decks", next);
  },
  deleteDeck: (id) => {
    const next = get().decks.filter((d) => d.id !== id);
    set({ decks: next });
    void window.vj.setSetting("decks", next);
  },
  renameDeck: (id, title) => {
    const next = get().decks.map((d) => d.id === id ? { ...d, title } : d);
    set({ decks: next });
    void window.vj.setSetting("decks", next);
  },
  applyDeck: (id) => {
    const s = get();
    const deck = s.decks.find((d) => d.id === id);
    if (!deck) return;
    set((s2) => ({
      state: {
        ...s2.state,
        layers: structuredClone(deck.layers),
        postfx: structuredClone(deck.postfx),
        postfxBoundary: deck.postfxBoundary,
      },
    }));
    get().broadcastState();
  },
  selectPostFXSlot: (slotIdx) =>
    set(() => ({ selectedPostFXSlot: Math.max(0, Math.min(POSTFX_SLOT_COUNT - 1, slotIdx)) })),
  restoreScene: (saved) => {
    if (!saved || typeof saved !== "object") return;
    const obj = saved as Record<string, unknown>;
    set((s) => {
      const next: VJState = { ...s.state };
      if (Array.isArray(obj.layers)) next.layers = obj.layers as VJState["layers"];
      if (Array.isArray(obj.postfx)) {
        // Pad / clip to POSTFX_SLOT_COUNT so a stale save can't shrink the rack.
        const slots = (obj.postfx as PostFXSlot[]).slice(0, POSTFX_SLOT_COUNT);
        while (slots.length < POSTFX_SLOT_COUNT) slots.push(emptySlot());
        next.postfx = slots;
      }
      if (typeof obj.postfxBoundary === "number") next.postfxBoundary = obj.postfxBoundary;
      if (typeof obj.transitionType === "string") {
        next.transition = {
          ...s.state.transition,
          type: obj.transitionType as VJState["transition"]["type"],
          duration: typeof obj.transitionDuration === "number"
            ? obj.transitionDuration
            : s.state.transition.duration,
        };
      }
      if (typeof obj.bpm === "number") next.bpm = obj.bpm;
      return { state: next };
    });
    // Restored postfx counts as "user-arranged" — block the default seed
    // in the next loadPlugins so we don't overwrite the restore.
    postfxSeeded = true;
  },
  bpmAutoMode: false,
  bpmDetected: null,
  bpmConfidence: 0,
  bpmStable: false,
  setBpmAutoMode: (on) => set(() => ({ bpmAutoMode: on, ...(on ? {} : { bpmDetected: null, bpmConfidence: 0, bpmStable: false }) })),
  setAudio: (volume, bass, mid, high) => {
    set((s) => ({ state: { ...s.state, audio: { volume, bass, mid, high } } }));
  },
  setDetectedBpm: (tempo, confidence, stable) => {
    set((s) => {
      // Only write into state.bpm when AUTO is active. Otherwise keep the
      // detector value cached for telemetry but don't override user input.
      if (!s.bpmAutoMode) {
        return { bpmDetected: tempo, bpmConfidence: confidence, bpmStable: stable };
      }
      const rounded = Math.max(30, Math.min(300, Math.round(tempo)));
      return {
        bpmDetected: tempo,
        bpmConfidence: confidence,
        bpmStable: stable,
        state: { ...s.state, bpm: rounded },
      };
    });
  },

  enterStage: () => {
    const s = get();
    if (s.stageMode) return;
    // Cancel any in-flight commitGo timeout — its scheduled effect would
    // mutate `state` after we entered STAGE, which the user doesn't expect.
    if (pendingTransitionCommit !== null) {
      window.clearTimeout(pendingTransitionCommit);
      pendingTransitionCommit = null;
    }
    set({ stageMode: true, liveSnapshot: structuredClone(s.state) });
    get().broadcastState();
  },

  releaseStage: () => {
    const s = get();
    if (!s.stageMode) return;
    if (pendingTransitionCommit !== null) {
      window.clearTimeout(pendingTransitionCommit);
      pendingTransitionCommit = null;
    }
    // v1: instant snap. Transition support on release is a follow-up.
    set((s2) => ({
      stageMode: false,
      liveSnapshot: null,
      state: {
        ...s2.state,
        transition: { ...s2.state.transition, startedAt: null },
      },
    }));
    get().broadcastState();
  },

  cancelStage: () => {
    const s = get();
    if (!s.stageMode || !s.liveSnapshot) return;
    // Revert scene fields to snapshot, keep realtime fields current.
    const restored: VJState = {
      ...s.liveSnapshot,
      bpm: s.state.bpm,
      beatAnchor: s.state.beatAnchor,
      beat: s.state.beat,
      bar: s.state.bar,
      audio: s.state.audio,
      flashAt: s.state.flashAt,
      burstAt: s.state.burstAt,
    };
    set({ state: restored, stageMode: false, liveSnapshot: null });
    get().broadcastState();
  },

  loadPlugins: async () => {
    const plugins = await window.vj.listPlugins();
    set({ plugins });
    // Seed default PostFX assignments on the first successful load. Skip
    // when the user already has anything in the rack, and only run once
    // per session so a manual clear doesn't get silently re-seeded.
    if (!postfxSeeded) {
      postfxSeeded = true;
      const s = get();
      if (s.state.postfx.every((p) => !p.pluginId)) {
        DEFAULT_POSTFX_SEEDS.forEach((id, i) => {
          if (plugins.some((p) => p.id === id && p.kind === "postfx")) {
            s.setPostFXSlotPlugin(i, id);
          }
        });
      }
    }
  },

  addClip: (layerIdx, pluginId) => {
    const s = get();
    const layer = s.state.layers[layerIdx];
    if (!layer) return;
    // No duplicates per layer — if the asset already exists, just trigger it.
    const existing = layer.clips.findIndex((c) => c.pluginId === pluginId);
    if (existing >= 0) {
      get().triggerClip(layerIdx, existing);
      return;
    }
    const meta = s.plugins.find((p) => p.id === pluginId);
    const params: Record<string, ParamValue> = {};
    for (const def of meta?.params ?? []) params[def.key] = def.default;
    const newClips = [...layer.clips, { pluginId, params }];
    const newIdx = newClips.length - 1;
    const fromIdx = layer.activeClipIdx;
    const txInfo = computeLayerTransition(s.state, layerIdx, fromIdx, newIdx, s.stageMode);

    set((s2) => ({
      state: {
        ...s2.state,
        layers: s2.state.layers.map((l, i) =>
          i === layerIdx
            ? { ...l, clips: newClips, activeClipIdx: newIdx, nextClipIdx: newIdx }
            : l,
        ),
        selectedLayer: layerIdx,
        transition: txInfo.transition ?? s2.state.transition,
      },
    }));
    if (txInfo.scheduleClear) {
      pendingTransitionCommit = window.setTimeout(() => {
        pendingTransitionCommit = null;
        set((s3) => ({
          state: { ...s3.state, transition: { ...s3.state.transition, startedAt: null } },
        }));
      }, txInfo.duration);
    }
  },

  triggerClip: (layerIdx, clipIdx) => {
    const s = get();
    const layer = s.state.layers[layerIdx];
    if (!layer) return;
    const fromIdx = layer.activeClipIdx;
    const txInfo = computeLayerTransition(s.state, layerIdx, fromIdx, clipIdx, s.stageMode);

    set((s2) => ({
      state: {
        ...s2.state,
        layers: s2.state.layers.map((l, i) =>
          i === layerIdx ? { ...l, activeClipIdx: clipIdx, nextClipIdx: clipIdx } : l,
        ),
        selectedLayer: layerIdx,
        transition: txInfo.transition ?? s2.state.transition,
      },
    }));
    if (txInfo.scheduleClear) {
      pendingTransitionCommit = window.setTimeout(() => {
        pendingTransitionCommit = null;
        set((s3) => ({
          state: { ...s3.state, transition: { ...s3.state.transition, startedAt: null } },
        }));
      }, txInfo.duration);
    }
  },

  reorderClip: (layerIdx, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    set((s) => {
      const layers = s.state.layers.map((l, i) => {
        if (i !== layerIdx) return l;
        const clips = [...l.clips];
        const [moved] = clips.splice(fromIdx, 1);
        // toIdx was calculated before removal; adjust if needed
        const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        clips.splice(insertAt, 0, moved);
        const adjust = (idx: number): number => {
          if (idx < 0) return idx;
          if (idx === fromIdx) return insertAt;
          if (fromIdx < insertAt) {
            if (idx > fromIdx && idx <= insertAt) return idx - 1;
          } else {
            if (idx >= insertAt && idx < fromIdx) return idx + 1;
          }
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
      // Block moves that would create a duplicate on the destination layer.
      const dst = s.state.layers[toLayer];
      if (dst?.clips.some((c) => c.pluginId === clip.pluginId)) return s;

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

  togglePostFXSlot: (slotIdx) => {
    set((s) => {
      const slot = s.state.postfx[slotIdx];
      if (!slot || !slot.pluginId) return s;
      const postfx = s.state.postfx.map((p, i) =>
        i === slotIdx ? { ...p, enabled: !p.enabled } : p,
      );
      // Toggling a slot's bypass also focuses it — keeps the editor
      // pane in sync with whatever the user just acted on (whether via
      // mouse, MIDI, or wherever).
      return {
        state: { ...s.state, postfx },
        selectedPostFXSlot: slotIdx,
      };
    });
  },

  setPostFXSlotPlugin: (slotIdx, pluginId) => {
    set((s) => {
      const slot = s.state.postfx[slotIdx];
      if (!slot) return s;
      // Seed default params from the new plugin manifest. Empty when clearing.
      let params: Record<string, ParamValue> = {};
      if (pluginId) {
        const plugin = s.plugins.find((p) => p.id === pluginId);
        for (const def of plugin?.params ?? []) {
          params[def.key] = def.default;
        }
      }
      const postfx = s.state.postfx.map((p, i) =>
        i === slotIdx
          ? { pluginId, enabled: pluginId ? p.enabled : false, params }
          : p,
      );
      return { state: { ...s.state, postfx } };
    });
  },

  setPostFXSlotParam: (slotIdx, key, value) => {
    set((s) => {
      const slot = s.state.postfx[slotIdx];
      if (!slot || !slot.pluginId) return s;
      const postfx = s.state.postfx.map((p, i) =>
        i === slotIdx ? { ...p, params: { ...p.params, [key]: value } } : p,
      );
      return { state: { ...s.state, postfx } };
    });
  },

  clearPostFXSlot: (slotIdx) => {
    set((s) => {
      const slot = s.state.postfx[slotIdx];
      if (!slot) return s;
      const postfx = s.state.postfx.map((p, i) => (i === slotIdx ? emptySlot() : p));
      return { state: { ...s.state, postfx } };
    });
  },

  setPostfxBoundary: (n) => {
    set((s) => {
      const max = s.state.layers.length;
      const clamped = Math.max(0, Math.min(max, Math.round(n)));
      if (clamped === s.state.postfxBoundary) return s;
      return { state: { ...s.state, postfxBoundary: clamped } };
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
    // In AUTO mode the detector owns BPM; TAP only nudges phase.
    if (get().bpmAutoMode) return;
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

  setBurst: (on) => {
    set((s) => ({ state: { ...s.state, burstAt: on ? Date.now() : null } }));
  },

  broadcastState: () => {
    const send = () => {
      const s = get();
      window.vj.sendStateUpdate(
        buildBroadcastState(s.state, s.stageMode, s.liveSnapshot),
      );
    };
    if (broadcastTimer !== null) {
      // Already throttling — mark that a trailing send is needed
      broadcastPending = true;
      return;
    }
    // First call in this window: send immediately
    send();
    broadcastTimer = window.setTimeout(() => {
      broadcastTimer = null;
      if (broadcastPending) {
        broadcastPending = false;
        send();
      }
    }, 16);
  },
}));
