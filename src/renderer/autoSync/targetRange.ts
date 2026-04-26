import { useVJStore } from "../state/vjStore";

export interface TargetRange {
  min: number;
  max: number;
  set: (value: number) => void;
}

/**
 * Resolve a MIDI/sync targetId into its numeric range and a setter.
 * Returns null for triggers (go/tap/flash), bool/enum params, or unknown ids.
 */
export function resolveTargetRange(targetId: string): TargetRange | null {
  const vj = useVJStore.getState();

  if (targetId.startsWith("layer-opacity-")) {
    const idx = parseInt(targetId.slice("layer-opacity-".length), 10);
    if (isNaN(idx)) return null;
    return { min: 0, max: 1, set: (v) => vj.setLayerOpacity(idx, v) };
  }

  if (targetId.startsWith("postfx:")) {
    const rest = targetId.slice("postfx:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return null;
    const pluginId = rest.slice(0, colonIdx);
    const key = rest.slice(colonIdx + 1);
    const plugin = vj.plugins.find((p) => p.id === pluginId);
    const def = plugin?.params.find((p) => p.key === key);
    if (
      !def ||
      def.type === "bool" ||
      def.type === "enum" ||
      def.type === "strings" ||
      def.type === "camera" ||
      def.type === "color"
    ) return null;
    return {
      min: def.min ?? 0,
      max: def.max ?? 1,
      set: (v) => vj.setPostFXParam(pluginId, key, v),
    };
  }

  if (targetId.startsWith("clip:")) {
    const rest = targetId.slice("clip:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return null;
    const layerIdx = parseInt(rest.slice(0, colonIdx), 10);
    const key = rest.slice(colonIdx + 1);
    if (isNaN(layerIdx) || !key) return null;
    const layer = vj.state.layers[layerIdx];
    const clipIdx = layer?.activeClipIdx ?? -1;
    if (clipIdx < 0) return null;
    const clip = layer.clips[clipIdx];
    const plugin = vj.plugins.find((p) => p.id === clip?.pluginId);
    const def = plugin?.params.find((p) => p.key === key);
    if (
      !def ||
      def.type === "bool" ||
      def.type === "enum" ||
      def.type === "strings" ||
      def.type === "camera" ||
      def.type === "color"
    ) return null;
    return {
      min: def.min ?? 0,
      max: def.max ?? 1,
      set: (v) => vj.setClipParam(layerIdx, clipIdx, key, v),
    };
  }

  return null;
}
