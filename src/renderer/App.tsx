import { useEffect } from "react";
import { useVJStore } from "./state/vjStore";
import { initMidi } from "./midi/midiManager";
import { startAutoSyncDriver } from "./autoSync/autoSyncDriver";
import { startBpmDetector, type BpmDetectorHandle } from "./audio/bpmDetector";
import { TopBar } from "./components/TopBar";
import { AssetsPanel } from "./components/AssetsPanel";
import { LayerStack } from "./components/LayerStack";
import { AssetParamsPanel } from "./components/AssetParamsPanel";
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
    loadPlugins();
    const off = window.vj.onPluginsChanged(() => loadPlugins());
    return off;
  }, [loadPlugins]);

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
      onBpm: (tempo, conf) => setDetectedBpm(tempo, conf, false),
      onStable: (tempo, conf) => setDetectedBpm(tempo, conf, true),
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
        <LayerStack />
        <AssetParamsPanel />
      </div>
      <TransportBar />
      <MidiMapPanel />
    </div>
  );
}
