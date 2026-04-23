import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginMeta, VJState } from "../../shared/types";

function formatDuration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number | undefined): string {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function LibraryTab() {
  const [plugins, setPlugins] = useState<PluginMeta[]>([]);
  const [inUse, setInUse] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Initial plugin list + live updates.
  useEffect(() => {
    window.vj.listPlugins().then(setPlugins);
    return window.vj.onPluginsChanged(setPlugins);
  }, []);

  // Listen to state broadcasts to compute which plugins are currently used
  // by any layer (active or queued). Ask Controller to rebroadcast once on
  // mount so we start with fresh info even if nothing is changing.
  useEffect(() => {
    const off = window.vj.onStateBroadcast((state: VJState) => {
      const ids = new Set<string>();
      for (const layer of state.layers) {
        for (const clip of layer.clips) ids.add(clip.pluginId);
      }
      for (const p of state.postfx) ids.add(p.pluginId);
      setInUse(ids);
    });
    window.vj.requestStateRebroadcast();
    return off;
  }, []);

  const materials = useMemo(
    () => plugins.filter((p) => p.kind === "material"),
    [plugins],
  );

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.select();
  }, [editingId]);

  const startRename = (p: PluginMeta) => {
    setEditingId(p.id);
    setDraftName(p.name);
  };

  const commitRename = async (p: PluginMeta) => {
    const next = draftName.trim();
    setEditingId(null);
    if (!next || next === p.name) return;
    try {
      await window.vj.renamePlugin(p.kind, p.id, next);
    } catch (err) {
      setError(`rename failed: ${(err as Error).message}`);
    }
  };

  const onReveal = async (p: PluginMeta) => {
    try {
      await window.vj.revealPlugin(p.kind, p.id);
    } catch (err) {
      setError(`reveal failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (p: PluginMeta) => {
    if (inUse.has(p.id)) return; // UI already disables, but guard anyway
    const isVideo = p.outputType === "video";
    const warning = isVideo
      ? `Delete "${p.name}"?\n\nThis removes the plugin and its mp4 from materials/videos.`
      : `PERMANENTLY delete "${p.name}"?\n\nThis plugin is not a video — its source code will be deleted and cannot be recovered.`;
    if (!window.confirm(warning)) return;
    try {
      await window.vj.deletePlugin(p.kind, p.id);
    } catch (err) {
      setError(`delete failed: ${(err as Error).message}`);
    }
  };

  if (materials.length === 0) {
    return (
      <div className="manager-placeholder">
        <div className="manager-placeholder-title">No assets yet</div>
        <div className="manager-placeholder-body">
          Switch to the Import tab to add videos.
        </div>
      </div>
    );
  }

  return (
    <div className="library-tab">
      {error && (
        <div className="import-status err" onClick={() => setError(null)}>
          ✗ {error} — click to dismiss
        </div>
      )}
      <table className="library-table">
        <thead>
          <tr>
            <th />
            <th>Name</th>
            <th>Type</th>
            <th className="num">Duration</th>
            <th className="num">Size</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((p) => {
            const used = inUse.has(p.id);
            const isEditing = editingId === p.id;
            return (
              <tr key={p.id} className={used ? "used" : ""}>
                <td className="thumb-cell">
                  {p.thumbnailUrl ? (
                    <div
                      className="library-thumb"
                      style={{ backgroundImage: `url("${p.thumbnailUrl}")` }}
                    />
                  ) : (
                    <div className="library-thumb placeholder" />
                  )}
                </td>
                <td className="name-cell">
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      className="library-name-input"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      className="library-name-btn"
                      onClick={() => startRename(p)}
                      title="Click to rename"
                    >
                      {p.name}
                    </button>
                  )}
                  <div className="library-id">{p.id}</div>
                </td>
                <td>{p.outputType ?? "–"}</td>
                <td className="num">{formatDuration(p.duration)}</td>
                <td className="num">{formatSize(p.sizeBytes)}</td>
                <td className="actions-cell">
                  <button className="btn-mini" onClick={() => onReveal(p)}>
                    Reveal
                  </button>
                  <button
                    className="btn-mini danger"
                    onClick={() => onDelete(p)}
                    disabled={used}
                    title={used ? "used by a layer — remove from layers first" : "Delete"}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
