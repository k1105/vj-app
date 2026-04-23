import { useEffect, useRef, useState } from "react";
import type { DownloadProgress } from "../../shared/types";

type Status = { level: "info" | "ok" | "err"; text: string } | null;

export function ImportTab() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    const off = window.vj.onDownloadProgress((p: DownloadProgress) => {
      if (p.stage === "downloading") {
        setStatus({ level: "info", text: `downloading ${p.percent.toFixed(0)}%` });
      } else if (p.stage === "merging") {
        setStatus({ level: "info", text: `merging ${p.percent.toFixed(0)}%` });
      } else if (p.stage === "done") {
        setStatus({ level: "ok", text: "done" });
      } else if (p.stage === "error") {
        setStatus({ level: "err", text: p.message ?? "error" });
      }
    });
    return off;
  }, []);

  const runDownload = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setStatus({ level: "info", text: "starting..." });
    try {
      const result = await window.vj.downloadVideo(trimmed);
      setStatus({ level: "ok", text: `added: ${result.title}` });
      setUrl("");
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Import a list of local files sequentially. Progress for each file arrives
  // on the shared onDownloadProgress channel, so we just serialize the calls.
  const runImport = async (paths: string[]) => {
    if (paths.length === 0 || busy) return;
    setBusy(true);
    try {
      let lastTitle = "";
      for (let i = 0; i < paths.length; i++) {
        setStatus({
          level: "info",
          text: paths.length > 1 ? `importing (${i + 1}/${paths.length})...` : "importing...",
        });
        const result = await window.vj.importVideo(paths[i]);
        lastTitle = result.title;
      }
      setStatus({
        level: "ok",
        text: paths.length > 1 ? `added ${paths.length} files` : `added: ${lastTitle}`,
      });
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onPickFiles = async () => {
    if (busy) return;
    const paths = await window.vj.pickVideoFile();
    if (paths.length > 0) runImport(paths);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (busy) return;
    const paths: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const p = window.vj.getFilePath(file);
      if (p) paths.push(p);
    }
    if (paths.length > 0) runImport(paths);
  };

  return (
    <div className="import-tab">
      <section className="import-section">
        <div className="import-section-title">From YouTube</div>
        <div className="url-input-wrap">
          <input
            className="url-input"
            placeholder="YouTube URL..."
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runDownload();
            }}
          />
          <button className="btn-dl" onClick={runDownload} disabled={busy}>
            {busy ? "…" : "DL"}
          </button>
        </div>
      </section>

      <section className="import-section">
        <div className="import-section-title">From Local File</div>
        <div
          className={`drop-zone ${dragOver ? "over" : ""} ${busy ? "busy" : ""}`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="drop-zone-primary">Drop mp4 files here</div>
          <div className="drop-zone-secondary">
            or <button className="btn-link" onClick={onPickFiles} disabled={busy}>
              browse files
            </button>
          </div>
          <div className="drop-zone-hint">.mp4 only (H.264 recommended)</div>
        </div>
      </section>

      {status && (
        <div className={`import-status ${status.level}`}>
          {status.level === "ok" ? "✓ " : status.level === "err" ? "✗ " : ""}
          {status.text}
        </div>
      )}
    </div>
  );
}
