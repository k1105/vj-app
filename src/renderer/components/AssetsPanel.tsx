import { Fragment, useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { Deck, DownloadProgress, PluginMeta } from "../../shared/types";

const ASSETS_WIDTH_MIN = 140;
const ASSETS_WIDTH_MAX = 600;
const ASSETS_WIDTH_DEFAULT = 200;
const ASSETS_WIDTH_SETTING = "assetsWidth";

const DT_DECK = "application/x-deck-id";

export function AssetsPanel() {
  const plugins = useVJStore((s) => s.plugins);
  const materials = plugins.filter((p) => p.kind === "material" && !p.hidden);
  const stageMode = useVJStore((s) => s.stageMode);
  const decks = useVJStore((s) => s.decks);
  const deleteDeck = useVJStore((s) => s.deleteDeck);
  const renameDeck = useVJStore((s) => s.renameDeck);

  // User-created empty categories are persisted in settings so they survive
  // restarts even when no manifest currently references them.
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  useEffect(() => {
    window.vj.getSetting("extraCategories").then((v) => {
      if (Array.isArray(v)) {
        setExtraCategories(
          (v as unknown[]).filter((s): s is string => typeof s === "string"),
        );
      }
    });
  }, []);
  const persistExtras = (next: string[]) => {
    const dedup = Array.from(new Set(next)).sort((a, b) => a.localeCompare(b));
    setExtraCategories(dedup);
    void window.vj.setSetting("extraCategories", dedup);
  };

  // Group by category. Empty extra-categories still get a slot.
  const keyOf = (p: PluginMeta) =>
    p.category && p.category.length > 0 ? p.category : "other";
  const grouped = new Map<string, PluginMeta[]>();
  for (const p of materials) {
    const list = grouped.get(keyOf(p)) ?? [];
    list.push(p);
    grouped.set(keyOf(p), list);
  }
  for (const c of extraCategories) {
    if (!grouped.has(c)) grouped.set(c, []);
  }
  const groups = Array.from(grouped.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  // window.prompt is a no-op in Electron, so we render a tiny custom modal.
  // promptValue(...) returns the trimmed input or null on cancel/empty.
  const [promptCfg, setPromptCfg] = useState<null | {
    title: string;
    defaultValue: string;
    resolve: (value: string | null) => void;
  }>(null);
  const promptValue = (
    title: string,
    defaultValue = "",
  ): Promise<string | null> =>
    new Promise((resolve) => setPromptCfg({ title, defaultValue, resolve }));
  const closePrompt = (value: string | null) => {
    promptCfg?.resolve(value);
    setPromptCfg(null);
  };

  const setCategoryFor = async (p: PluginMeta, value: string) => {
    try {
      await window.vj.setPluginCategory(p.kind, p.id, value);
    } catch (err) {
      console.error("[AssetsPanel] setPluginCategory failed:", err);
    }
  };

  // Drop an asset onto a category group → re-assign manifest.category.
  const DT_PLUGIN = "application/x-plugin-id";
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  // Clear the highlight reliably when the drag ends anywhere (drop or cancel).
  useEffect(() => {
    const clear = () => setDragOverCategory(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);
  const onCategoryDragOver = (e: React.DragEvent, category: string) => {
    if (!e.dataTransfer.types.includes(DT_PLUGIN)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCategory !== category) setDragOverCategory(category);
  };
  const onCategoryDrop = (e: React.DragEvent, category: string) => {
    const pluginId = e.dataTransfer.getData(DT_PLUGIN);
    setDragOverCategory(null);
    if (!pluginId) return;
    e.preventDefault();
    e.stopPropagation();
    const p = materials.find((m) => m.id === pluginId);
    if (!p) return;
    const isFallback =
      category === "other" && !extraCategories.includes("other");
    const next = isFallback ? "" : category;
    if ((p.category ?? "") === next) return;
    void setCategoryFor(p, next);
  };

  const onGroupContextMenu = async (
    e: React.MouseEvent,
    category: string,
    items: PluginMeta[],
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // The "other" bucket — plugins with no manifest.category and not in
    // extraCategories — is a synthetic fallback group, so there's nothing
    // to rename or delete there.
    const inExtras = extraCategories.includes(category);
    const isFallback = !inExtras && items.every((p) => !p.category);
    if (isFallback) return;
    const choice = await window.vj.showContextMenu([
      { id: "rename", label: `Rename "${category}"…` },
      { id: "delete", label: `Delete "${category}"` },
    ]);
    if (choice === "rename") {
      const next = await promptValue(`Rename "${category}" to`, category);
      if (!next || next === category) return;
      for (const p of items) await setCategoryFor(p, next);
      if (inExtras) {
        persistExtras(
          extraCategories.map((c) => (c === category ? next : c)),
        );
      }
    } else if (choice === "delete") {
      const msg = items.length === 0
        ? `Delete empty category "${category}"?`
        : `Clear category "${category}" from ${items.length} asset(s)?`;
      if (!window.confirm(msg)) return;
      for (const p of items) await setCategoryFor(p, "");
      if (inExtras) {
        persistExtras(extraCategories.filter((c) => c !== category));
      }
    }
  };

  const onSpacerContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const name = await promptValue("New category name");
    if (!name) return;
    persistExtras([...extraCategories, name]);
  };

  const onDeckContextMenu = async (e: React.MouseEvent, deck: Deck) => {
    e.preventDefault();
    e.stopPropagation();
    const choice = await window.vj.showContextMenu([
      { id: "rename", label: "Rename…" },
      { id: "delete", label: `Delete "${deck.title}"`, danger: true },
    ]);
    if (choice === "rename") {
      const next = await promptValue("Rename deck", deck.title);
      if (next && next !== deck.title) renameDeck(deck.id, next);
    } else if (choice === "delete") {
      deleteDeck(deck.id);
    }
  };

  const onDeckDragStart = (e: React.DragEvent, deckId: string) => {
    e.dataTransfer.setData(DT_DECK, deckId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onAssetContextMenu = async (e: React.MouseEvent, p: PluginMeta) => {
    e.preventDefault();
    e.stopPropagation();
    const choice = await window.vj.showContextMenu([
      { id: "hide", label: "Hide" },
    ]);
    if (choice === "hide") {
      await window.vj.setPluginHidden(p.id, true);
    }
  };

  const onDragStart = (e: React.DragEvent, pluginId: string) => {
    e.dataTransfer.setData("application/x-plugin-id", pluginId);
    // copy → drop on a layer (LayerStack uses "copy")
    // move → drop on a category group (AssetsPanel uses "move")
    e.dataTransfer.effectAllowed = "copyMove";
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
      <div className="assets-groups">
        {stageMode && (
          <div className="deck-section">
            <div className="deck-section-header">
              <span>Decks</span>
              <span className="assets-group-count">{decks.length}</span>
            </div>
            {decks.length === 0 ? (
              <div className="deck-empty">No decks — Cmd+D to save</div>
            ) : (
              <div className="deck-list">
                {[...decks].sort((a, b) => a.title.localeCompare(b.title)).map((deck) => (
                  <div
                    key={deck.id}
                    className="deck-card"
                    draggable
                    onDragStart={(e) => onDeckDragStart(e, deck.id)}
                    onContextMenu={(e) => onDeckContextMenu(e, deck)}
                    title={`${deck.title} — drag to apply · right-click to delete`}
                  >
                    <span className="deck-card-title">{deck.title}</span>
                    <span className="deck-card-meta">
                      {new Date(deck.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div
          className="assets-group-spacer"
          onContextMenu={onSpacerContextMenu}
          title="Right-click to create a new category"
        />
        {groups.map(([category, items]) => (
          <Fragment key={category}>
            <div
              className={`assets-group${dragOverCategory === category ? " drag-over" : ""}`}
              onDragOver={(e) => onCategoryDragOver(e, category)}
              onDrop={(e) => onCategoryDrop(e, category)}
            >
              <div
                className="assets-group-header"
                onContextMenu={(e) => onGroupContextMenu(e, category, items)}
              >
                <span>{category}</span>
                <span className="assets-group-count">{items.length}</span>
              </div>
              <div className="assets-grid">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="asset-thumb"
                    draggable
                    onDragStart={(e) => onDragStart(e, p.id)}
                    onContextMenu={(e) => onAssetContextMenu(e, p)}
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
            </div>
            <div
              className="assets-group-spacer"
              onContextMenu={onSpacerContextMenu}
              title="Right-click to create a new category"
            />
          </Fragment>
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
      {promptCfg && (
        <PromptModal
          title={promptCfg.title}
          defaultValue={promptCfg.defaultValue}
          onSubmit={(v) => closePrompt(v)}
        />
      )}
    </div>
  );
}

function PromptModal({
  title,
  defaultValue,
  onSubmit,
}: {
  title: string;
  defaultValue: string;
  onSubmit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="modal-overlay" onMouseDown={() => onSubmit(null)}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <input
          autoFocus
          className="modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(value.trim() || null);
            if (e.key === "Escape") onSubmit(null);
          }}
        />
        <div className="modal-actions">
          <button className="btn-mini" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button
            className="btn-mini accent"
            onClick={() => onSubmit(value.trim() || null)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
