import { useEffect, useRef, useState } from "react";
import type { DownloadProgress } from "../../shared/types";

type Status = { level: "info" | "ok" | "err"; text: string } | null;
type Category = "video" | "text";

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "video", label: "Video" },
  { id: "text", label: "Text" },
];

export function ImportTab() {
  const [category, setCategory] = useState<Category>("video");

  return (
    <div className="import-tab">
      <div className="import-category-tabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`import-category-tab ${category === c.id ? "active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {category === "video" ? <VideoImport /> : <TextImport />}
    </div>
  );
}

function VideoImport() {
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
    <>
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
    </>
  );
}

function TextImport() {
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const submit = async () => {
    if (busy) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus({ level: "err", text: "asset name is required" });
      return;
    }
    const texts = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (texts.length === 0) {
      setStatus({ level: "err", text: "at least one non-empty text is required" });
      return;
    }
    setBusy(true);
    setStatus({ level: "info", text: "creating..." });
    try {
      const id = await window.vj.createTextAsset(trimmedName, texts);
      setStatus({ level: "ok", text: `added: ${id} (${texts.length} text${texts.length > 1 ? "s" : ""})` });
      setName("");
      setRaw("");
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runMigrate = async () => {
    if (busy) return;
    setBusy(true);
    setStatus({ level: "info", text: "migrating..." });
    try {
      const count = await window.vj.migrateTextAssets();
      setStatus({ level: "ok", text: `migrated ${count} text asset${count === 1 ? "" : "s"}` });
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="import-section">
        <div className="import-section-title">New Text Asset</div>
        <div className="text-import-form">
          <input
            className="url-input"
            placeholder="Asset name (e.g. CLUB NIGHT)..."
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="text-import-textarea"
            placeholder={"One text per line.\nE.g.\nDJ HTK\nCLUB NIGHT"}
            value={raw}
            disabled={busy}
            rows={6}
            onChange={(e) => setRaw(e.target.value)}
          />
          <button className="btn-dl" onClick={submit} disabled={busy}>
            {busy ? "…" : "Create"}
          </button>
          <div className="drop-zone-hint">
            The asset holds all lines; the <code>idx</code> param picks which one is drawn live.
          </div>
        </div>
      </section>

      <section className="import-section">
        <div className="import-section-title">Maintenance</div>
        <button className="btn-link" onClick={runMigrate} disabled={busy}>
          Migrate all text assets to current template
        </button>
        <div className="drop-zone-hint">
          Rewrites each text asset's manifest against the current template schema, preserving the <code>texts</code> array.
        </div>
      </section>

      {status && (
        <div className={`import-status ${status.level}`}>
          {status.level === "ok" ? "✓ " : status.level === "err" ? "✗ " : ""}
          {status.text}
        </div>
      )}
    </>
  );
}
