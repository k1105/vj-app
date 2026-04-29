import { useEffect, useRef, useState } from "react";
import type { DownloadProgress, PluginMeta } from "../../shared/types";
import { SceneTab } from "./SceneTab";

type Status = { level: "info" | "ok" | "err"; text: string } | null;
type Category = "video" | "text" | "image" | "sequence" | "scene";

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "video",    label: "Video"    },
  { id: "text",     label: "Text"     },
  { id: "image",    label: "Image"    },
  { id: "sequence", label: "Sequence" },
  { id: "scene",    label: "Scene"    },
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

      {category === "video"    ? <VideoImport />    :
       category === "text"     ? <TextImport />     :
       category === "image"    ? <ImageImport />    :
       category === "sequence" ? <SequenceImport /> :
       <SceneTab />}
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

function ImageImport() {
  const [name, setName] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const addPaths = (incoming: string[]) => {
    setPaths((prev) => {
      const set = new Set(prev);
      incoming.forEach((p) => set.add(p));
      return Array.from(set);
    });
  };

  const onBrowse = async () => {
    const picked = await window.vj.pickImagesForAsset();
    if (picked.length > 0) addPaths(picked);
  };

  const onDragEnter = (e: React.DragEvent) => {
    dragDepth.current++;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  };
  const onDragLeave = () => {
    dragDepth.current--;
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(jpe?g|png|webp|gif)$/i.test(f.name),
    );
    addPaths(files.map((f) => window.vj.getFilePath(f)));
  };

  const submit = async () => {
    if (busy || paths.length === 0) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus({ level: "err", text: "asset name is required" });
      return;
    }
    setBusy(true);
    setStatus({ level: "info", text: "creating..." });
    try {
      const id = await window.vj.createImageAsset(trimmedName, paths);
      setStatus({ level: "ok", text: `added: ${id} (${paths.length} image${paths.length > 1 ? "s" : ""})` });
      setName("");
      setPaths([]);
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="import-section">
        <div className="import-section-title">New Image Asset</div>
        <div className="text-import-form">
          <input
            className="url-input"
            placeholder="Asset name (e.g. VISUALS)..."
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          />
          <div
            className={`drop-zone ${dragOver ? "drag-over" : ""}`}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {paths.length === 0 ? (
              <>
                <div className="drop-zone-primary">Drop image files here</div>
                <div className="drop-zone-secondary">
                  or{" "}
                  <button className="btn-link" onClick={onBrowse} disabled={busy}>
                    browse files
                  </button>
                </div>
                <div className="drop-zone-hint">.jpg / .png / .webp / .gif</div>
              </>
            ) : (
              <div className="image-file-list">
                {paths.map((p, i) => (
                  <div key={p} className="image-file-row">
                    <span className="image-file-name">{p.split(/[\\/]/).pop()}</span>
                    <button
                      className="btn-link"
                      onClick={() => setPaths((prev) => prev.filter((_, j) => j !== i))}
                      disabled={busy}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button className="btn-link" onClick={onBrowse} disabled={busy}>
                  + add more
                </button>
              </div>
            )}
          </div>
          <button
            className="btn-dl"
            onClick={submit}
            disabled={busy || paths.length === 0}
          >
            {busy ? "…" : "Create"}
          </button>
          <div className="drop-zone-hint">
            The asset holds all images; the <code>idx</code> param picks which one is drawn live.
          </div>
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

function SequenceImport() {
  const [name, setName] = useState("");
  const [available, setAvailable] = useState<PluginMeta[]>([]);
  const [sequence, setSequence] = useState<PluginMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    window.vj.listPlugins().then((plugins) => {
      setAvailable(
        plugins.filter((p) => p.kind === "material" && p.outputType === "video" && !p.hidden),
      );
    });
  }, []);

  const add = (p: PluginMeta) =>
    setSequence((prev) => (prev.find((x) => x.id === p.id) ? prev : [...prev, p]));
  const remove = (i: number) => setSequence((prev) => prev.filter((_, j) => j !== i));
  const moveUp = (i: number) => setSequence((prev) => {
    if (i === 0) return prev;
    const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next;
  });
  const moveDown = (i: number) => setSequence((prev) => {
    if (i >= prev.length - 1) return prev;
    const next = [...prev]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next;
  });

  const submit = async () => {
    if (busy || sequence.length === 0) return;
    const trimmedName = name.trim();
    if (!trimmedName) { setStatus({ level: "err", text: "asset name is required" }); return; }
    setBusy(true);
    setStatus({ level: "info", text: "creating..." });
    try {
      const id = await window.vj.createSequenceAsset(trimmedName, sequence.map((p) => p.id));
      setStatus({ level: "ok", text: `created: ${id} (${sequence.length} videos)` });
      setName(""); setSequence([]);
    } catch (err) {
      setStatus({ level: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="import-section">
        <div className="import-section-title">New Sequence Asset</div>
        <input
          className="url-input"
          placeholder="Asset name…"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
        />
        {/* Available — thumbnail grid */}
        <div className="seq-section-label">Available</div>
        <div className="seq-card-grid">
          {available.length === 0
            ? <div className="sequence-empty">no video assets</div>
            : available.map((p) => {
                const inSeq = !!sequence.find((x) => x.id === p.id);
                return (
                  <div
                    key={p.id}
                    className={`seq-card${inSeq ? " seq-card-added" : ""}`}
                    onClick={() => !inSeq && add(p)}
                    title={inSeq ? "already in sequence" : p.name}
                  >
                    <div className="seq-card-thumb">
                      {p.thumbnailUrl
                        ? <img src={p.thumbnailUrl} alt="" />
                        : <div className="seq-card-nothumb" />}
                      {inSeq && <div className="seq-card-check">✓</div>}
                    </div>
                    <div className="seq-card-name">{p.name}</div>
                  </div>
                );
              })}
        </div>

        {/* Sequence — horizontal strip of numbered cards */}
        <div className="seq-section-label">
          Sequence
          <span className="seq-section-count">{sequence.length}</span>
        </div>
        <div className="seq-strip">
          {sequence.length === 0
            ? <div className="sequence-empty">click a card above to add</div>
            : sequence.map((p, i) => (
              <div key={i} className="seq-strip-card">
                <div className="seq-strip-thumb">
                  {p.thumbnailUrl
                    ? <img src={p.thumbnailUrl} alt="" />
                    : <div className="seq-card-nothumb" />}
                  <span className="seq-strip-num">{i + 1}</span>
                </div>
                <div className="seq-strip-controls">
                  <button className="seq-btn" onClick={() => moveUp(i)} disabled={i === 0}>◀</button>
                  <button className="seq-btn danger" onClick={() => remove(i)}>✕</button>
                  <button className="seq-btn" onClick={() => moveDown(i)} disabled={i === sequence.length - 1}>▶</button>
                </div>
              </div>
            ))}
        </div>
        <button className="btn-dl" onClick={submit} disabled={busy || sequence.length === 0}>
          {busy ? "…" : "Create"}
        </button>
        <div className="drop-zone-hint">
          Plays through each video in order. Auto-advances on end. <code>loop</code> param wraps back to start.
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
