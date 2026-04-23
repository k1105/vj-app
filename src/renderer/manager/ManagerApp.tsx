import { useState } from "react";
import { ImportTab } from "./ImportTab";
import { LibraryTab } from "./LibraryTab";

type Tab = "library" | "import";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "library", label: "Library" },
  { id: "import", label: "Import" },
];

export function ManagerApp() {
  const [active, setActive] = useState<Tab>("library");

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
        {active === "library" && <LibraryTab />}
        {active === "import" && <ImportTab />}
      </div>
    </div>
  );
}
