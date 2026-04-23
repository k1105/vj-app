import { useEffect } from "react";
import { useVJStore } from "./state/vjStore";
import { initMidi } from "./midi/midiManager";
import { TopBar } from "./components/TopBar";
import { AssetsPanel } from "./components/AssetsPanel";
import { LayerStack } from "./components/LayerStack";
import { AssetParamsPanel } from "./components/AssetParamsPanel";
import { TransportBar } from "./components/TransportBar";

export function App() {
  const loadPlugins = useVJStore((s) => s.loadPlugins);
  const broadcastState = useVJStore((s) => s.broadcastState);
  const tap = useVJStore((s) => s.tap);
  const commitGo = useVJStore((s) => s.commitGo);
  const state = useVJStore((s) => s.state);

  useEffect(() => {
    loadPlugins();
    const off = window.vj.onPluginsChanged(() => loadPlugins());
    return off;
  }, [loadPlugins]);

  useEffect(() => {
    initMidi();
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
        commitGo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tap, commitGo]);

  return (
    <div className="app">
      <TopBar />
      <div className="middle">
        <AssetsPanel />
        <LayerStack />
        <AssetParamsPanel />
      </div>
      <TransportBar />
    </div>
  );
}
