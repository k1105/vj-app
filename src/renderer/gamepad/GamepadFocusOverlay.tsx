import { useEffect, useRef } from "react";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";

/** Returns the data-gpid selector string for a given focus target. */
function gpidFor(t: FocusTarget): string | null {
  if (!t) return null;
  if (t.kind === "clip")   return `[data-gpid="clip-${t.layerIdx}-${t.clipIdx}"]`;
  if (t.kind === "add")    return `[data-gpid="add-${t.layerIdx}"]`;
  if (t.kind === "postfx") return `[data-gpid="postfx-${t.slotIdx}"]`;
  return null;
}

/**
 * Renders a focus ring that tracks the currently focused gamepad target.
 * Positioned with `position:fixed` so it works regardless of scroll.
 */
export function GamepadFocusOverlay() {
  const target = useGamepadFocusStore((s) => s.target);
  const active = useGamepadFocusStore((s) => s.active);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;

    if (!active || !target) {
      ring.style.display = "none";
      return;
    }

    const sel = gpidFor(target);
    if (!sel) { ring.style.display = "none"; return; }

    function place() {
      const el = document.querySelector<HTMLElement>(sel!);
      if (!el || !ring) { ring!.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
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
  }, [target, active]);

  return (
    <div
      ref={ringRef}
      className="gp-focus-ring"
      style={{ display: "none" }}
      aria-hidden
    />
  );
}
