import { useEffect, useRef } from "react";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";

export function gpidFor(t: FocusTarget): string | null {
  if (!t) return null;
  if (t.kind === "clip")   return `[data-gpid="clip-${t.layerIdx}-${t.clipIdx}"]`;
  if (t.kind === "add")    return `[data-gpid="add-${t.layerIdx}"]`;
  if (t.kind === "postfx") return `[data-gpid="postfx-${t.slotIdx}"]`;
  return null;
}

/**
 * Renders a focus ring that tracks the currently focused gamepad target.
 * Hidden automatically when any overlay/panel is open so it never floats
 * on top of modals.
 */
export function GamepadFocusOverlay() {
  const target     = useGamepadFocusStore((s) => s.target);
  const active     = useGamepadFocusStore((s) => s.active);
  // Hide ring whenever any panel/modal is open
  const anyOverlay = useGamepadFocusStore((s) =>
    s.paramPanelOpen || s.layerParamOpen || s.optionsOpen ||
    s.assetPickerLayer !== null || s.deleteTarget !== null
  );
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;

    if (!active || !target || anyOverlay) {
      ring.style.display = "none";
      return;
    }

    const sel = gpidFor(target);
    if (!sel) { ring.style.display = "none"; return; }

    function place() {
      const el = document.querySelector<HTMLElement>(sel!);
      if (!el || !ring) { ring!.style.display = "none"; return; }

      // Hide if the element is clipped outside its scroll container
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { ring!.style.display = "none"; return; }

      ring!.style.display = "block";
      ring!.style.top    = `${r.top    - 2}px`;
      ring!.style.left   = `${r.left   - 2}px`;
      ring!.style.width  = `${r.width  + 4}px`;
      ring!.style.height = `${r.height + 4}px`;
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const ro = new ResizeObserver(place);
    const el = document.querySelector<HTMLElement>(sel);
    if (el) ro.observe(el);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro.disconnect();
    };
  }, [target, active, anyOverlay]);

  return (
    <div
      ref={ringRef}
      className="gp-focus-ring"
      style={{ display: "none" }}
      aria-hidden
    />
  );
}
