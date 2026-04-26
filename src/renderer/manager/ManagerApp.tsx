import { useState } from "react";
import { ImportTab } from "./ImportTab";
import { LibraryTab } from "./LibraryTab";
import { SceneTab } from "./SceneTab";

type Tab = "asset" | "postfx" | "create" | "scene";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "asset", label: "Asset" },
  { id: "postfx", label: "PostFX" },
  { id: "create", label: "Create" },
  { id: "scene", label: "Scene" },
];

export function ManagerApp() {
  const [active, setActive] = useState<Tab>("asset");

  return (
    <div className="manager">
      <div className="manager-header">
        <div className="manager-title">LIBRARY</div>
        <div className="manager-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`manager-tab ${active === t.id ? "active" : ""}`}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="manager-body">
        {active === "asset" && <LibraryTab kind="material" />}
        {active === "postfx" && <LibraryTab kind="postfx" />}
        {active === "create" && <ImportTab />}
        {active === "scene" && <SceneTab />}
      </div>
    </div>
  );
}
