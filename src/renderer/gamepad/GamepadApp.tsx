/**
 * GamepadApp — PS4コントローラー専用UI。
 * vjStore を共有するが、既存の MIDI コンポーネントは一切使わない。
 */
import { useEffect, useState } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";
import { GamepadRoot }         from "./GamepadRoot";
import { GamepadParamPanel }   from "./GamepadParamPanel";
import { GamepadOptionsModal } from "./GamepadOptionsModal";
import { GamepadAssetPicker }  from "./GamepadAssetPicker";
import { GamepadFocusOverlay } from "./GamepadFocusOverlay";
import "../styles/gamepad.css";

// ─── Top bar ────────────────────────────────────────────────────────────────

function GpTopBar() {
  const bpm       = useVJStore((s) => s.state.bpm);
  const stageMode = useVJStore((s) => s.stageMode);
  const [beatIdx, setBeatIdx] = useState(0);
  // perf stats from IPC
  const [fps, setFps]     = useState<number | null>(null);
  const [heapMB, setHeap] = useState<number | null>(null);

  useEffect(() => {
    const interval = Math.round(60000 / (bpm || 120));
    const id = setInterval(() => setBeatIdx(i => (i + 1) % 4), interval);
    return () => clearInterval(id);
  }, [bpm]);

  useEffect(() => {
    const offPreview = window.vj.onPreviewLive(() => {});
    const offPerf    = window.vj.onPerfStats((s) => { setFps(s.fps); setHeap(s.heapUsedMB); });
    return () => { offPreview(); offPerf(); };
  }, []);

  return (
    <div className="gpa-topbar">
      <span className="gpa-app-id">VJ · PS4</span>
      <div className="gpa-bpm">
        <span className="gpa-bpm-val">{Math.round(bpm)}</span>
        <span className="gpa-bpm-unit">BPM</span>
      </div>
      <div className="gpa-beats">
        {[0,1,2,3].map(i => (
          <div key={i} className={`gpa-beat-dot${i === beatIdx ? " active" : ""}`} />
        ))}
      </div>
      {fps !== null && (
        <div className="gpa-perf">
          <span className={fps < 50 ? "gpa-perf-warn" : ""}>{fps.toFixed(1)}</span>
          <span className="gpa-perf-u">FPS</span>
          {heapMB !== null && <><span> · </span><span>{heapMB}</span><span className="gpa-perf-u">MB</span></>}
        </div>
      )}
      <div className="gpa-spacer" />
      {stageMode && <div className="gpa-stage-badge">STAGE</div>}
      <div className="gpa-mode-badge">GAMEPAD</div>
    </div>
  );
}

// ─── Preview row ─────────────────────────────────────────────────────────────

function GpPreviewRow() {
  const stageMode = useVJStore((s) => s.stageMode);
  const [liveSrc, setLiveSrc] = useState("");

  useEffect(() => {
    return window.vj.onPreviewLive((url) => setLiveSrc(url));
  }, []);

  return (
    <div className="gpa-preview-row">
      {/* LIVE OUT */}
      <div className="gpa-preview-box live">
        <div className="gpa-preview-hdr">
          <span className="gpa-preview-label">LIVE OUT</span>
          <span className="gpa-live-dot">● LIVE</span>
        </div>
        <div className="gpa-preview-canvas">
          {liveSrc
            ? <img src={liveSrc} className="gpa-preview-img" alt="live" />
            : <span className="gpa-preview-placeholder">waiting…</span>
          }
        </div>
      </div>

      {/* NEXT OUT */}
      <div className={`gpa-preview-box next${stageMode ? " staged" : ""}`}>
        <div className="gpa-preview-hdr">
          <span className="gpa-preview-label">NEXT OUT</span>
          <span className={stageMode ? "gpa-stage-dot" : "gpa-stage-off"}>
            {stageMode ? "● STAGED" : "◎ STAGE OFF"}
          </span>
        </div>
        <div className="gpa-preview-canvas">
          {stageMode
            ? <span className="gpa-preview-placeholder" style={{ color: "var(--info)" }}>stage preview</span>
            : <span className="gpa-preview-placeholder">□ で stage</span>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Layer stack ─────────────────────────────────────────────────────────────

function GpLayerStack() {
  const layers         = useVJStore((s) => s.state.layers);
  const plugins        = useVJStore((s) => s.plugins);
  const postfxBoundary = useVJStore((s) => s.state.postfxBoundary);
  const setPostfxBoundary = useVJStore((s) => s.setPostfxBoundary);
  const setLayerOpacity   = useVJStore((s) => s.setLayerOpacity);
  const setLayerBlend     = useVJStore((s) => s.setLayerBlend);
  const setLayerMute      = useVJStore((s) => s.setLayerMute);
  const setLayerSolo      = useVJStore((s) => s.setLayerSolo);
  const triggerClip       = useVJStore((s) => s.triggerClip);
  const target            = useGamepadFocusStore((s) => s.target);
  const openAssetPicker   = useGamepadFocusStore((s) => s.openAssetPicker);

  const pluginName = (id: string) => plugins.find(p => p.id === id)?.name ?? id;
  const thumbnailUrl = (id: string) => plugins.find(p => p.id === id)?.thumbnailUrl;

  const isFocused = (t: FocusTarget): boolean => {
    if (!target) return false;
    if (t.kind !== target.kind) return false;
    if (t.kind === "clip"   && target.kind === "clip")   return t.layerIdx === target.layerIdx && t.clipIdx === target.clipIdx;
    if (t.kind === "add"    && target.kind === "add")    return t.layerIdx === target.layerIdx;
    if (t.kind === "postfx" && target.kind === "postfx") return t.slotIdx  === target.slotIdx;
    return false;
  };

  return (
    <div className="gpa-layer-stack">
      {layers.map((layer, li) => (
        <div key={layer.id}>
          {/* PostFX boundary slot */}
          <GpBoundarySlot
            slotIdx={li}
            currentBoundary={postfxBoundary}
            totalLayers={layers.length}
            onSet={setPostfxBoundary}
          />

          {/* Layer row */}
          <div className={`gpa-layer-row${layer.mute ? " muted" : ""}`}>
            {/* Opacity track */}
            <div
              className="gpa-op-track"
              title={`opacity ${Math.round(layer.opacity * 100)}%`}
              onClick={() => setLayerOpacity(li, layer.opacity >= 1 ? 0.5 : 1)}
            >
              <div className="gpa-op-fill" style={{ height: `${Math.round(layer.opacity * 100)}%` }} />
            </div>

            {/* Meta column */}
            <div className="gpa-layer-meta">
              <span className="gpa-layer-num">L{li + 1}</span>
              <span className="gpa-layer-opval">{Math.round(layer.opacity * 100)}</span>
              <button
                className="gpa-blend-badge"
                onClick={() => {
                  const modes = ["normal","add","multiply","screen"] as const;
                  const cur = modes.indexOf(layer.blend);
                  setLayerBlend(li, modes[(cur + 1) % modes.length]);
                }}
              >
                {layer.blend === "normal" ? "NRM" : layer.blend === "multiply" ? "MUL" : layer.blend.toUpperCase()}
              </button>
              <div className="gpa-ms-row">
                <button
                  className={`gpa-ms-btn${layer.mute ? " muted" : ""}`}
                  onClick={() => setLayerMute(li, !layer.mute)}
                >M</button>
                <button
                  className={`gpa-ms-btn${layer.solo ? " solo" : ""}`}
                  onClick={() => setLayerSolo(li, !layer.solo)}
                >S</button>
              </div>
            </div>

            {/* Clip grid */}
            <div className="gpa-clip-grid">
              {layer.clips.map((clip, ci) => {
                const focused   = isFocused({ kind: "clip", layerIdx: li, clipIdx: ci });
                const isActive  = ci === layer.activeClipIdx;
                const isNext    = ci === layer.nextClipIdx && ci !== layer.activeClipIdx;
                const thumb     = thumbnailUrl(clip.pluginId);
                return (
                  <div
                    key={ci}
                    data-gpid={`clip-${li}-${ci}`}
                    className={[
                      "gpa-clip-card",
                      isActive  ? "active"      : "",
                      isNext    ? "next-active" : "",
                      focused   ? "focused"     : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => triggerClip(li, ci)}
                    title={pluginName(clip.pluginId)}
                  >
                    {(isActive || isNext) && <div className="gpa-clip-dot" />}
                    <div
                      className="gpa-clip-thumb"
                      style={thumb ? { backgroundImage: `url("${thumb}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    >
                      {!thumb && <span className="gpa-clip-icon">{pluginName(clip.pluginId)[0]}</span>}
                    </div>
                    <div className="gpa-clip-name">{pluginName(clip.pluginId)}</div>
                  </div>
                );
              })}

              {/* + add slot */}
              <div
                data-gpid={`add-${li}`}
                className={`gpa-add-slot${isFocused({ kind: "add", layerIdx: li }) ? " focused" : ""}`}
                onClick={() => openAssetPicker(li)}
                title="Add asset"
              >
                <span className="gpa-add-plus">+</span>
                <span className="gpa-add-lbl">ADD</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Final boundary */}
      <GpBoundarySlot
        slotIdx={layers.length}
        currentBoundary={postfxBoundary}
        totalLayers={layers.length}
        onSet={setPostfxBoundary}
      />
    </div>
  );
}

function GpBoundarySlot({ slotIdx, currentBoundary, totalLayers, onSet }: {
  slotIdx: number; currentBoundary: number; totalLayers: number; onSet: (n: number) => void;
}) {
  const active = slotIdx === currentBoundary;
  const label  = slotIdx === 0 ? "POSTFX · ALL"
               : slotIdx === totalLayers ? "POSTFX · OFF"
               : `POSTFX ↓ L${slotIdx + 1}…`;
  return (
    <div className={`gpa-boundary${active ? " active" : ""}`} onClick={() => onSet(slotIdx)}>
      <div className="gpa-boundary-line" />
      <span className="gpa-boundary-label">{label}</span>
      <div className="gpa-boundary-line" />
    </div>
  );
}

// ─── PostFX slots row ─────────────────────────────────────────────────────────

function GpPostFXRow() {
  const plugins          = useVJStore((s) => s.plugins);
  const postfx           = useVJStore((s) => s.state.postfx);
  const togglePostFXSlot = useVJStore((s) => s.togglePostFXSlot);
  const target           = useGamepadFocusStore((s) => s.target);

  const available = plugins.filter(p => p.kind === "postfx" && !p.hidden);

  return (
    <div className="gpa-postfx-row">
      <div className="gpa-section-hdr">
        <span className="gpa-section-label">PostFX</span>
        <span className="gpa-section-hint">8 SLOTS</span>
      </div>
      <div className="gpa-postfx-slots">
        {Array.from({ length: 8 }, (_, i) => {
          const slot    = postfx[i];
          const on      = !!slot?.enabled && !!slot?.pluginId;
          const meta    = slot?.pluginId ? available.find(p => p.id === slot.pluginId) : null;
          const focused = target?.kind === "postfx" && target.slotIdx === i;
          return (
            <div
              key={i}
              data-gpid={`postfx-${i}`}
              className={[
                "gpa-postfx-slot",
                on      ? "on"      : "",
                focused ? "focused" : "",
                !slot?.pluginId ? "empty" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => { if (slot?.pluginId) togglePostFXSlot(i); }}
            >
              <div className="gpa-pfx-dot" />
              <span className="gpa-pfx-num">{i + 1}</span>
              <span className="gpa-pfx-name">{meta?.name ?? <span style={{ color: "var(--text-muted)" }}>empty</span>}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Transport bar ────────────────────────────────────────────────────────────

function GpTransportBar() {
  const tap          = useVJStore((s) => s.tap);
  const stageMode    = useVJStore((s) => s.stageMode);
  const enterStage   = useVJStore((s) => s.enterStage);
  const releaseStage = useVJStore((s) => s.releaseStage);
  const cancelStage  = useVJStore((s) => s.cancelStage);
  const target       = useGamepadFocusStore((s) => s.target);

  const [tapPressed,   setTapPressed]   = useState(false);
  const [flashPressed, setFlashPressed] = useState(false);
  const [burstPressed, setBurstPressed] = useState(false);

  const focusLabel = (() => {
    if (!target) return "—";
    if (target.kind === "clip")   return `L${target.layerIdx + 1} · clip ${target.clipIdx + 1}`;
    if (target.kind === "add")    return `L${target.layerIdx + 1} · + Add`;
    if (target.kind === "postfx") return `PostFX ${target.slotIdx + 1}`;
    return "—";
  })();

  return (
    <div className="gpa-transport">
      <button
        className={`gpa-t-btn${tapPressed ? " pressed" : ""}`}
        onMouseDown={() => { setTapPressed(true); tap(); }}
        onMouseUp={() => setTapPressed(false)}
      >
        <span className="gpa-t-badge gpa-l1">L1</span> TAP
      </button>
      <div className="gpa-t-sep" />
      <button
        className={`gpa-t-btn flash${flashPressed ? " pressed" : ""}`}
        onMouseDown={() => setFlashPressed(true)}
        onMouseUp={() => setFlashPressed(false)}
      >
        <span className="gpa-t-badge gpa-r1">R1</span> FLASH
      </button>
      <div className="gpa-t-sep" />
      <button
        className={`gpa-t-btn burst${burstPressed ? " pressed" : ""}`}
        onMouseDown={() => setBurstPressed(true)}
        onMouseUp={() => setBurstPressed(false)}
      >
        <span className="gpa-t-badge gpa-l1r1">L1+R1</span> BURST
      </button>
      <div className="gpa-t-sep" />
      {stageMode
        ? <>
            <button className="gpa-t-btn stage-release" onClick={releaseStage}>
              <span className="gpa-t-badge gpa-r1" style={{background:'rgba(100,180,255,0.18)',color:'#64b4ff'}}>R2</span> RELEASE
            </button>
            <button className="gpa-t-btn stage-cancel" onClick={cancelStage}>
              <span className="gpa-t-badge gpa-sq">□</span> CANCEL
            </button>
          </>
        : <button className="gpa-t-btn" onClick={enterStage}>
            <span className="gpa-t-badge gpa-sq">□</span> STAGE
          </button>
      }
      <div className="gpa-spacer" />
      <div className="gpa-focus-label">
        Focus: <span>{focusLabel}</span>
      </div>
    </div>
  );
}

// ─── Status / hint bar ────────────────────────────────────────────────────────

function GpStatusBar() {
  const target       = useGamepadFocusStore((s) => s.target);
  const paramOpen    = useGamepadFocusStore((s) => s.paramPanelOpen);

  type Hint = { badge: string; cls: string; label: string };
  const hints: Hint[] = paramOpen
    ? [
        { badge: "↑↓",    cls: "gp-dpad",  label: "パラメータ選択" },
        { badge: "L ↕",   cls: "gp-stick", label: "値変更" },
        { badge: "←→",    cls: "gp-dpad",  label: "step/enum" },
        { badge: "R3",     cls: "gp-r3",    label: "toggle/fire" },
        { badge: "△",     cls: "gp-tri",   label: "閉じる" },
      ]
    : !target
    ? [{ badge: "D-PAD", cls: "gp-dpad", label: "Navigate" }]
    : target.kind === "add"
    ? [
        { badge: "○",     cls: "gp-circle", label: "Open picker" },
        { badge: "D-PAD", cls: "gp-dpad",   label: "Navigate" },
      ]
    : target.kind === "postfx"
    ? [
        { badge: "○",     cls: "gp-circle",   label: "Toggle" },
        { badge: "△",     cls: "gp-tri",      label: "Params" },
        { badge: "D-PAD", cls: "gp-dpad",     label: "Navigate" },
      ]
    : [
        { badge: "○",     cls: "gp-circle",   label: "Trigger" },
        { badge: "△",     cls: "gp-tri",      label: "Params" },
        { badge: "✕",    cls: "gp-cross",    label: "Remove" },
        { badge: "D-PAD", cls: "gp-dpad",     label: "Navigate" },
      ];

  return (
    <div className="gpa-statusbar">
      <span className="gpa-status-focus">
        {target
          ? target.kind === "clip"   ? `clip-${target.layerIdx}-${target.clipIdx}`
          : target.kind === "add"    ? `add-${target.layerIdx}`
          : `postfx-${target.slotIdx}`
          : "no focus"}
      </span>
      <div className="gpa-hints">
        {hints.map((h, i) => (
          <span key={i} className="gpa-hint-item">
            <span className={`gp-btn-badge ${h.cls}`}>{h.badge}</span>
            {h.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Delete confirm (inline) ─────────────────────────────────────────────────

function GpDeleteConfirm() {
  const deleteTarget = useGamepadFocusStore((s) => s.deleteTarget);
  const close        = useGamepadFocusStore((s) => s.closeDeleteConfirm);
  const plugins      = useVJStore((s) => s.plugins);
  const layers       = useVJStore((s) => s.state.layers);
  const removeClip   = useVJStore((s) => s.removeClip);

  if (!deleteTarget || deleteTarget.kind !== "clip") return null;

  const clip = layers[deleteTarget.layerIdx]?.clips[deleteTarget.clipIdx];
  const name = plugins.find(p => p.id === clip?.pluginId)?.name ?? "?";

  const confirm = () => {
    removeClip(deleteTarget.layerIdx, deleteTarget.clipIdx);
    close();
  };

  return (
    <div className="gp-modal-overlay open" onClick={close}>
      <div className="gp-delete-card" onClick={e => e.stopPropagation()}>
        <div className="gp-delete-icon">⚠️</div>
        <div className="gp-delete-title">削除しますか？</div>
        <div className="gp-delete-body">「{name}」をレイヤーから削除します。</div>
        <div className="gp-delete-actions">
          <button className="gp-delete-btn" onClick={close}>
            <span className="gp-btn-badge gp-tri">△</span> キャンセル
          </button>
          <button className="gp-delete-btn danger" onClick={confirm}>
            <span className="gp-btn-badge gp-cross">✕</span> 削除
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function useVJSession() {
  const loadPlugins    = useVJStore((s) => s.loadPlugins);
  const broadcastState = useVJStore((s) => s.broadcastState);
  const state          = useVJStore((s) => s.state);

  // Scene restore + plugin load (same as App.tsx)
  useEffect(() => {
    let off: (() => void) | null = null;
    (async () => {
      try {
        const saved = await window.vj.getSetting("scene");
        if (saved) useVJStore.getState().restoreScene(saved);
      } catch { /* ignore */ }
      await loadPlugins();
      off = window.vj.onPluginsChanged(() => loadPlugins());
    })();
    return () => { off?.(); };
  }, [loadPlugins]);

  // Push state to output on every change
  useEffect(() => { broadcastState(); }, [state, broadcastState]);

  // Re-broadcast when output window re-opens
  useEffect(() => {
    return window.vj.onRequestStateRebroadcast(() => broadcastState());
  }, [broadcastState]);
}

export function GamepadApp() {
  useVJSession();
  const stageMode = useVJStore((s) => s.stageMode);

  return (
    <div className={`gpa-root${stageMode ? " stage-active" : ""}`}>
      {stageMode && (
        <div className="gpa-stage-banner">
          STAGE — Output frozen. □+R1 でコミット、□ でキャンセル
        </div>
      )}

      <GpTopBar />
      <GpPreviewRow />

      <div className="gpa-main">
        <GpLayerStack />
        <GpPostFXRow />
      </div>

      <GpTransportBar />
      <GpStatusBar />

      {/* Gamepad input + overlays */}
      <GamepadRoot />
      <GamepadFocusOverlay />
      <GamepadParamPanel onClose={() => useGamepadFocusStore.getState().closeParamPanel()} />
      <GamepadOptionsModal />
      <GamepadAssetPicker />
      <GpDeleteConfirm />
    </div>
  );
}
