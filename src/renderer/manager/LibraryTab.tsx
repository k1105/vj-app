import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginKind, PluginMeta, VJState } from "../../shared/types";

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

interface LibraryTabProps {
  kind?: PluginKind;
}

export function LibraryTab({ kind = "material" }: LibraryTabProps = {}) {
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

  // Listen to state broadcasts to compute which plugins are currently used.
  // For materials, "in use" = referenced by any layer (active or queued).
  // For postfx, "in use" = present in the postfx rack (regardless of enabled).
  useEffect(() => {
    const off = window.vj.onStateBroadcast((state: VJState) => {
      const ids = new Set<string>();
      if (kind === "material") {
        for (const layer of state.layers) {
          for (const clip of layer.clips) ids.add(clip.pluginId);
        }
      } else if (kind === "postfx") {
        for (const p of state.postfx) {
          if (p.pluginId) ids.add(p.pluginId);
        }
      }
      setInUse(ids);
    });
    window.vj.requestStateRebroadcast();
    return off;
  }, [kind]);

  const materials = useMemo(
    () => plugins.filter((p) => p.kind === kind),
    [plugins, kind],
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

  const [baking, setBaking] = useState<Set<string>>(new Set());
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<string>("");

  const startEditCategory = (p: PluginMeta) => {
    setEditingCategoryId(p.id);
    setDraftCategory(p.category ?? "");
  };
  const commitCategory = async (p: PluginMeta) => {
    const next = draftCategory.trim();
    setEditingCategoryId(null);
    if (next === (p.category ?? "")) return;
    try {
      await window.vj.setPluginCategory(p.kind, p.id, next);
    } catch (err) {
      setError(`category change failed: ${(err as Error).message}`);
    }
  };

  const onBake = async (p: PluginMeta) => {
    setBaking((s) => new Set(s).add(p.id));
    try {
      // Captures the Output window's current frame. The user is expected
      // to solo / arrange the asset on Output before clicking Bake.
      await window.vj.bakePluginThumbnail(p.kind, p.id);
    } catch (err) {
      setError(`bake failed for ${p.name}: ${(err as Error).message}`);
    } finally {
      setBaking((s) => {
        const next = new Set(s);
        next.delete(p.id);
        return next;
      });
    }
  };

  const onToggleHidden = async (p: PluginMeta) => {
    try {
      await window.vj.setPluginHidden(p.id, !p.hidden);
    } catch (err) {
      setError(`toggle visibility failed: ${(err as Error).message}`);
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
    const empty =
      kind === "postfx"
        ? { title: "No postfx plugins yet", body: "Drop a manifest into postfx/ to add one." }
        : kind === "transition"
          ? { title: "No transitions yet", body: "Drop a manifest into transitions/ to add one." }
          : { title: "No assets yet", body: "Switch to the Create tab to add videos." };
    return (
      <div className="manager-placeholder">
        <div className="manager-placeholder-title">{empty.title}</div>
        <div className="manager-placeholder-body">{empty.body}</div>
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
            <th>Category</th>
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
              <tr
                key={p.id}
                className={[used ? "used" : "", p.hidden ? "hidden-row" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
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
                <td className="category-cell">
                  {editingCategoryId === p.id ? (
                    <input
                      autoFocus
                      className="library-name-input"
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                      onBlur={() => commitCategory(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingCategoryId(null);
                      }}
                    />
                  ) : (
                    <button
                      className="library-name-btn"
                      onClick={() => startEditCategory(p)}
                      title="Click to edit category"
                    >
                      {p.category ?? "–"}
                    </button>
                  )}
                </td>
                <td>{p.outputType ?? "–"}</td>
                <td className="num">{formatDuration(p.duration)}</td>
                <td className="num">{formatSize(p.sizeBytes)}</td>
                <td className="actions-cell">
                  <button
                    className={`btn-mini${p.hidden ? " active" : ""}`}
                    onClick={() => onToggleHidden(p)}
                    title={
                      p.hidden
                        ? "Currently hidden — click to show in Assets"
                        : "Hide from the Controller's Assets grid (non-destructive)"
                    }
                  >
                    {p.hidden ? "Show" : "Hide"}
                  </button>
                  <button
                    className="btn-mini"
                    onClick={() => onBake(p)}
                    disabled={baking.has(p.id)}
                    title="Capture the Output window's current frame as this asset's thumbnail. Set up the asset on Output first."
                  >
                    {baking.has(p.id) ? "…" : "Bake"}
                  </button>
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
