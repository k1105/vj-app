import { Composer } from "./Composer";
import type { VJState } from "../shared/types";

console.log("[output] main.ts loaded");

const canvas = document.getElementById("stage") as HTMLCanvasElement;
if (!canvas) {
  console.error("[output] #stage canvas not found");
}
const composer = new Composer(canvas);
console.log("[output] Composer constructed");
composer.loadPlugins().catch((err) => {
  console.error("[output] loadPlugins failed:", err);
});
composer.start();

window.vj.onStateBroadcast((state: VJState) => {
  composer.updateState(state);
});

window.addEventListener("resize", () => composer.resize());
