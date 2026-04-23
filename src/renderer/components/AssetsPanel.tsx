import { useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { DownloadProgress } from "../../shared/types";

const ASSETS_WIDTH_MIN = 140;
const ASSETS_WIDTH_MAX = 600;
const ASSETS_WIDTH_DEFAULT = 200;
const ASSETS_WIDTH_SETTING = "assetsWidth";

export function AssetsPanel() {
  const plugins = useVJStore((s) => s.plugins);
  const materials = plugins.filter((p) => p.kind === "material");

  const onDragStart = (e: React.DragEvent, pluginId: string) => {
    e.dataTransfer.setData("application/x-plugin-id", pluginId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const widthRef = useRef<number>(ASSETS_WIDTH_DEFAULT);

  // Load the persisted width once on mount and apply it via CSS var.
  // We write directly to the CSS var (not via React state) so the drag
  // stays smooth; React state is only used to re-render on boot.
  useEffect(() => {
    window.vj.getSetting(ASSETS_WIDTH_SETTING).then((v) => {
      const n = typeof v === "number" ? v : ASSETS_WIDTH_DEFAULT;
      const clamped = Math.max(ASSETS_WIDTH_MIN, Math.min(ASSETS_WIDTH_MAX, n));
      widthRef.current = clamped;
      document.documentElement.style.setProperty("--assets-width", `${clamped}px`);
    });
  }, []);

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    let latest = startWidth;
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(
        ASSETS_WIDTH_MIN,
        Math.min(ASSETS_WIDTH_MAX, startWidth + (ev.clientX - startX)),
      );
      document.documentElement.style.setProperty("--assets-width", `${latest}px`);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      widthRef.current = latest;
      window.vj.setSetting(ASSETS_WIDTH_SETTING, latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    const off = window.vj.onDownloadProgress((p: DownloadProgress) => {
      if (p.stage === "downloading") {
        setStatus(`⏳ ${p.percent.toFixed(0)}%`);
      } else if (p.stage === "merging") {
        setStatus(`⚙ merging ${p.percent.toFixed(0)}%`);
      } else if (p.stage === "done") {
        setStatus("✅ done");
      } else if (p.stage === "error") {
        setStatus(`✗ ${p.message ?? "error"}`);
      }
    });
    return off;
  }, []);

  const onDownload = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setStatus("starting...");
    try {
      const result = await window.vj.downloadVideo(trimmed);
      setStatus(`✅ ${result.title}`);
      setUrl("");
      // manifest file is written by main; fs.watch triggers PluginsChanged,
      // which reloads the list in the store. clear the status after a bit.
      window.setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(`✗ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assets-area">
      <div className="assets-header">
        <span>Assets</span>
      </div>
      <div className="assets-grid">
        {materials.map((p) => (
          <div
            key={p.id}
            className="asset-thumb"
            draggable
            onDragStart={(e) => onDragStart(e, p.id)}
            title={p.name}
            style={
              p.thumbnailUrl
                ? {
                    backgroundImage: `url("${p.thumbnailUrl}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          >
            <div className="asset-thumb-name">{p.name}</div>
          </div>
        ))}
      </div>
      <div className="assets-dl">
        <div className="url-input-wrap">
          <input
            className="url-input"
            placeholder="YouTube URL..."
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onDownload();
            }}
          />
          <button className="btn-dl" onClick={onDownload} disabled={busy}>
            {busy ? "…" : "DL"}
          </button>
        </div>
        {status && <div className="dl-status">{status}</div>}
      </div>
      <div
        className="assets-resize-handle"
        onPointerDown={onResizeStart}
        title="Drag to resize"
      />
    </div>
  );
}
