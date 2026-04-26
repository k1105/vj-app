import { useEffect } from "react";
import { useVJStore } from "./state/vjStore";
import { initMidi } from "./midi/midiManager";
import { startAutoSyncDriver } from "./autoSync/autoSyncDriver";
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
  const commitGo = useVJStore((s) => s.commitGo);
  const state = useVJStore((s) => s.state);
  const stageMode = useVJStore((s) => s.stageMode);
  const enterStage = useVJStore((s) => s.enterStage);
  const releaseStage = useVJStore((s) => s.releaseStage);
  const cancelStage = useVJStore((s) => s.cancelStage);
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
        // While staging, Space releases. Otherwise it triggers GO.
        if (useVJStore.getState().stageMode) releaseStage();
        else commitGo();
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
  }, [tap, commitGo, toggleMidiMap, enterStage, releaseStage, cancelStage]);

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
