import Store from "electron-store";

const store = new Store({
  name: "videojockeyjs-settings",
  defaults: {
    midiMappings: {},
    lastBPM: 128,
  },
});

export function getSetting(key: string): unknown {
  return store.get(key);
}

export function setSetting(key: string, value: unknown): void {
  store.set(key, value as never);
}
