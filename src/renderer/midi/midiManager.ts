import { useVJStore } from "../state/vjStore";
import { useMidiStore, type MidiAddress } from "../state/midiStore";
import { useAutoSyncStore } from "../state/autoSyncStore";
import { useMidiMapPanelStore } from "../state/midiMapPanelStore";
import { LCXL3_LAYOUT } from "../components/midiMap/lcxl3Layout";

let _connected = false;

export function isMidiConnected(): boolean {
  return _connected;
}

export async function initMidi(): Promise<void> {
  // Load persisted mappings
  try {
    const saved = await window.vj.getSetting("midiMappings");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      useMidiStore.getState().setMappings(saved as Record<string, MidiAddress>);
    }
  } catch (e) {
    console.warn("[MIDI] failed to load saved mappings:", e);
  }

  // Load LCXL3 calibration overrides used by the MIDI Map panel
  try {
    const saved = await window.vj.getSetting("lcxl3Overrides");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      useMidiMapPanelStore.getState().setOverrides(
        saved as Record<string, MidiAddress>,
      );
    }
  } catch (e) {
    console.warn("[MIDI] failed to load LCXL3 overrides:", e);
  }

  if (!navigator.requestMIDIAccess) {
    console.warn("[MIDI] Web MIDI API not available");
    return;
  }

  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    _connected = true;

    access.inputs.forEach((input) => {
      input.onmidimessage = handleMessage;
    });

    access.onstatechange = (e) => {
      const port = e.port;
      if (port && port.type === "input" && port.state === "connected") {
        (port as MIDIInput).onmidimessage = handleMessage;
        console.log("[MIDI] device connected:", port.name);
      }
    };

    console.log(`[MIDI] ready, ${access.inputs.size} input(s)`);
  } catch (e) {
    console.warn("[MIDI] access denied:", e);
  }
}

function handleMessage(e: MIDIMessageEvent): void {
  const data = e.data;
  if (!data || data.length < 2) return;

  const status = data[0] ?? 0;
  const statusType = status & 0xf0;
  const channel = status & 0x0f;
  const number = data[1] ?? 0;
  const value = data.length > 2 ? (data[2] ?? 0) : 0;

  let type: "cc" | "note" | null = null;
  if (statusType === 0xb0) type = "cc";
  else if (statusType === 0x90) type = "note";
  else return;

  const address: MidiAddress = { channel, type, number };
  const midiState = useMidiStore.getState();
  const panel = useMidiMapPanelStore.getState();

  // MIDI Map panel calibration: bind the next incoming message to the
  // pending physical control. Skips note-off so we capture the press.
  if (panel.calibratingControlId) {
    if (type === "note" && value === 0) return;
    panel.applyOverride(panel.calibratingControlId, address);
    midiState.pulsePhysical(panel.calibratingControlId);
    return;
  }

  // Learn mode: capture the next incoming message
  if (midiState.learningTarget) {
    // For notes, skip note-off (velocity 0) so we capture the note-on
    if (type === "note" && value === 0) return;
    midiState.applyLearn(address);
    // Reflect the bind on the physical layout if the address is recognised
    pulsePhysicalForAddress(address);
    return;
  }

  // Always pulse the physical control if we recognise the address — useful
  // both for the MIDI Map panel and any future visualisations.
  pulsePhysicalForAddress(address);

  // Normal dispatch
  const matchedId = Object.keys(midiState.mappings).find((id) => {
    const m = midiState.mappings[id];
    return m.channel === channel && m.type === type && m.number === number;
  });
  if (!matchedId) return;

  midiState.pulse(matchedId);
  dispatch(matchedId, value, type);
}

function pulsePhysicalForAddress(address: MidiAddress): void {
  const overrides = useMidiMapPanelStore.getState().overrides;
  // Override wins over the layout default when both name the same address.
  for (const [controlId, addr] of Object.entries(overrides)) {
    if (
      addr.channel === address.channel &&
      addr.type === address.type &&
      addr.number === address.number
    ) {
      useMidiStore.getState().pulsePhysical(controlId);
      return;
    }
  }
  for (const c of LCXL3_LAYOUT) {
    if (overrides[c.id]) continue; // already considered above
    const a = c.defaultAddress;
    if (
      a &&
      a.channel === address.channel &&
      a.type === address.type &&
      a.number === address.number
    ) {
      useMidiStore.getState().pulsePhysical(c.id);
      return;
    }
  }
}

function dispatch(targetId: string, rawValue: number, addrType: "cc" | "note"): void {
  const vj = useVJStore.getState();

  // Note velocity=0 is note-off — skip it for trigger targets.
  // CC value=0 from a toggle button IS a real button press, so don't skip it.
  const isNoteOff = addrType === "note" && rawValue === 0;

  // Touching a MIDI control on a sync-active target turns sync off (matches
  // the user's mental model: physical input takes over).
  if (!isNoteOff) useAutoSyncStore.getState().disable(targetId);

  if (targetId === "go") {
    if (!isNoteOff) vj.commitGo();
    return;
  }

  if (targetId === "tap") {
    if (!isNoteOff) vj.tap();
    return;
  }

  if (targetId === "flash") {
    if (!isNoteOff) vj.triggerFlash();
    return;
  }

  if (targetId.startsWith("layer-opacity-")) {
    const layerIdx = parseInt(targetId.slice("layer-opacity-".length), 10);
    if (!isNaN(layerIdx)) vj.setLayerOpacity(layerIdx, rawValue / 127);
    return;
  }

  if (targetId.startsWith("postfx:")) {
    // format: "postfx:{pluginId}:{key}"
    const rest = targetId.slice("postfx:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return;
    const pluginId = rest.slice(0, colonIdx);
    const key = rest.slice(colonIdx + 1);
    const plugin = vj.plugins.find((p) => p.id === pluginId);
    const def = plugin?.params.find((p) => p.key === key);
    const min = def?.min ?? 0;
    const max = def?.max ?? 1;
    vj.setPostFXParam(pluginId, key, min + (rawValue / 127) * (max - min));
    return;
  }

  if (targetId.startsWith("clip:")) {
    // format: "clip:{layerIdx}:{key}"
    // Targets the active clip on the specified layer.
    const rest = targetId.slice("clip:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) return;
    const layerIdx = parseInt(rest.slice(0, colonIdx), 10);
    const key = rest.slice(colonIdx + 1);
    if (isNaN(layerIdx) || !key) return;
    // Loop boundaries are structural — never drive them from MIDI even if a
    // legacy mapping exists.
    if (key === "loopStart" || key === "loopEnd") return;
    const layer = vj.state.layers[layerIdx];
    const clipIdx = layer?.activeClipIdx ?? -1;
    if (clipIdx < 0) return;
    const clip = layer.clips[clipIdx];
    const plugin = vj.plugins.find((p) => p.id === clip?.pluginId);
    const def = plugin?.params.find((p) => p.key === key);
    const min = def?.min ?? 0;
    const max = def?.max ?? 1;
    const step = def?.step;

    if (addrType === "note" && isNoteOff) return;

    // Linear map 0-127 → min-max, then snap to step if defined.
    let value = min + (rawValue / 127) * (max - min);
    if (step != null && step > 0) {
      value = min + Math.round((value - min) / step) * step;
      if (value < min) value = min;
      if (value > max) value = max;
    }
    vj.setClipParam(layerIdx, clipIdx, key, value);
    return;
  }
}
