import { useEffect } from "react";
import { useVJStore } from "./state/vjStore";
import { initMidi } from "./midi/midiManager";
import { startAutoSyncDriver } from "./autoSync/autoSyncDriver";
import { startBpmDetector, type BpmDetectorHandle } from "./audio/bpmDetector";
import { TopBar } from "./components/TopBar";
import { AssetsPanel } from "./components/AssetsPanel";
import { LayerStack } from "./components/LayerStack";
import { AssetParamsPanel } from "./components/AssetParamsPanel";
import { PostFXSlotsRow } from "./components/PostFXBar";
import { TransportBar } from "./components/TransportBar";
import { MidiMapPanel } from "./components/midiMap/MidiMapPanel";
import { useMidiMapPanelStore } from "./state/midiMapPanelStore";

export function App() {
  const loadPlugins = useVJStore((s) => s.loadPlugins);
  const broadcastState = useVJStore((s) => s.broadcastState);
  const tap = useVJStore((s) => s.tap);
  const state = useVJStore((s) => s.state);
  const stageMode = useVJStore((s) => s.stageMode);
  const enterStage = useVJStore((s) => s.enterStage);
  const releaseStage = useVJStore((s) => s.releaseStage);
  const cancelStage = useVJStore((s) => s.cancelStage);
  const bpmAutoMode = useVJStore((s) => s.bpmAutoMode);
  const setBpmAutoMode = useVJStore((s) => s.setBpmAutoMode);
  const setDetectedBpm = useVJStore((s) => s.setDetectedBpm);
  const toggleMidiMap = useMidiMapPanelStore((s) => s.toggle);

  useEffect(() => {
    // Restore the persisted scene first so loadPlugins' default-seed
    // doesn't overwrite the user's saved postfx arrangement.
    let off: (() => void) | null = null;
    (async () => {
      try {
        const saved = await window.vj.getSetting("scene");
        if (saved) useVJStore.getState().restoreScene(saved);
      } catch (err) {
        console.error("[scene] restore failed:", err);
      }
      await loadPlugins();
      off = window.vj.onPluginsChanged(() => loadPlugins());
    })();
    return () => {
      off?.();
    };
  }, [loadPlugins]);

  // Persist the scene-relevant slice of state. Debounced so dragging
  // sliders doesn't hammer disk; the trailing edge captures the final
  // value. Realtime fields (beatAnchor, audio, flashAt, transition
  // timestamps) are intentionally excluded — they shouldn't survive a
  // restart.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void window.vj.setSetting("scene", {
        version: 1,
        layers: state.layers,
        postfx: state.postfx,
        postfxBoundary: state.postfxBoundary,
        transitionType: state.transition.type,
        transitionDuration: state.transition.duration,
        bpm: state.bpm,
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [state]);

  useEffect(() => {
    initMidi();
  }, []);

  useEffect(() => {
    return startAutoSyncDriver();
  }, []);

  // BPM auto-detect: start when bpmAutoMode flips on, stop when it flips off.
  // Mic permission is requested on the first enable.
  useEffect(() => {
    if (!bpmAutoMode) return;
    let handle: BpmDetectorHandle | null = null;
    let cancelled = false;
    startBpmDetector({
      onUpdate: (tempo, conf, stable) => setDetectedBpm(tempo, conf, stable),
      onError: (err) => {
        console.error("[BPM] detector error:", err);
        // Drop back to MANUAL so the UI doesn't lie about being live.
        setBpmAutoMode(false);
      },
    })
      .then((h) => {
        if (cancelled) return h.stop();
        handle = h;
      })
      .catch(() => {
        // Already reported via onError above.
      });
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [bpmAutoMode, setDetectedBpm, setBpmAutoMode]);

  // Push state to output window (debounced inside the store)
  useEffect(() => {
    broadcastState();
  }, [state, broadcastState]);

  // When the Manager window opens mid-session it asks us to rebroadcast
  // state so it has something to compute "in-use" from right away.
  useEffect(() => {
    return window.vj.onRequestStateRebroadcast(() => broadcastState());
  }, [broadcastState]);

  // Global keyboard shortcuts. Ignore when the user is typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)
      ) {
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tap();
      } else if (e.code === "Space") {
        e.preventDefault();
        // Space releases the stage. No-op outside STAGE (immediate-fire model).
        if (useVJStore.getState().stageMode) releaseStage();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMidiMap();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        // 'S' toggles staging. Re-press cancels (revert).
        if (useVJStore.getState().stageMode) cancelStage();
        else enterStage();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tap, toggleMidiMap, enterStage, releaseStage, cancelStage]);

  return (
    <div className={`app${stageMode ? " stage-active" : ""}`}>
      {stageMode && (
        <div className="stage-banner">
          STAGE — Output frozen. Press RELEASE / Space to commit, S to cancel.
        </div>
      )}
      <TopBar />
      <div className="middle">
        <AssetsPanel />
        <div className="layers-column">
          <PostFXSlotsRow />
          <LayerStack />
        </div>
        <AssetParamsPanel />
      </div>
      <TransportBar />
      <MidiMapPanel />
    </div>
  );
}
