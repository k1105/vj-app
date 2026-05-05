/** PS4 / DualShock 4 standard Gamepad API button indices. */
export const PS4_BUTTONS = {
  cross:    0,
  circle:   1,
  square:   2,
  triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  share: 8, options: 9,
  l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
  ps: 16, touchpad: 17,
} as const;

export type ButtonName = keyof typeof PS4_BUTTONS;
export type GamepadEvent = { type: "press" | "release"; button: ButtonName };

const DEADZONE = 0.15;
const listeners = new Set<(ev: GamepadEvent) => void>();
const prevPressed: Record<number, boolean> = {};
let rafId = 0;

function firstPad(): Gamepad | null {
  for (const gp of navigator.getGamepads()) {
    if (gp?.connected) return gp;
  }
  return null;
}

/** Left stick Y axis, dead-zone applied. Negative = up, positive = down. */
export function readLStickY(): number {
  const gp = firstPad();
  if (!gp) return 0;
  const v = gp.axes[1] ?? 0;
  return Math.abs(v) > DEADZONE ? v : 0;
}

/** Right stick Y axis, dead-zone applied. Negative = up, positive = down. */
export function readRStickY(): number {
  const gp = firstPad();
  if (!gp) return 0;
  const v = gp.axes[3] ?? 0;
  return Math.abs(v) > DEADZONE ? v : 0;
}

export function isButtonHeld(button: ButtonName): boolean {
  const gp = firstPad();
  return gp?.buttons[PS4_BUTTONS[button]]?.pressed ?? false;
}

export function isGamepadConnected(): boolean {
  return firstPad() !== null;
}

export function addGamepadListener(fn: (ev: GamepadEvent) => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) rafId = requestAnimationFrame(tick);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) cancelAnimationFrame(rafId);
  };
}

function tick() {
  rafId = requestAnimationFrame(tick);
  const gp = firstPad();
  if (!gp) return;
  for (const name of Object.keys(PS4_BUTTONS) as ButtonName[]) {
    const idx = PS4_BUTTONS[name];
    const pressed = gp.buttons[idx]?.pressed ?? false;
    const was = prevPressed[idx] ?? false;
    if (pressed && !was) listeners.forEach(f => f({ type: "press", button: name }));
    else if (!pressed && was) listeners.forEach(f => f({ type: "release", button: name }));
    prevPressed[idx] = pressed;
  }
}
