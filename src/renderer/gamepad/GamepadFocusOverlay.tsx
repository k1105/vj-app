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
 * Hidden when modals open. paramPanel は R2+←/→ で対象を切り替えるため、
 * 開いていてもリングを生かしておく。
 */
export function GamepadFocusOverlay() {
  const target     = useGamepadFocusStore((s) => s.target);
  const active     = useGamepadFocusStore((s) => s.active);
  const anyOverlay = useGamepadFocusStore((s) =>
    s.layerParamOpen || s.optionsOpen ||
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

    let raf = 0;
    let lastTop = -Infinity, lastLeft = -Infinity, lastW = -Infinity, lastH = -Infinity;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) { ring.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { ring.style.display = "none"; return; }

      const t = r.top - 2, l = r.left - 2, w = r.width + 4, h = r.height + 4;
      if (t === lastTop && l === lastLeft && w === lastW && h === lastH) return;
      lastTop = t; lastLeft = l; lastW = w; lastH = h;

      ring.style.display = "block";
      ring.style.top    = `${t}px`;
      ring.style.left   = `${l}px`;
      ring.style.width  = `${w}px`;
      ring.style.height = `${h}px`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
