import { app } from "electron";
import { appendFileSync, createWriteStream, mkdirSync } from "fs";
import { join } from "path";
import type { LogEntry } from "../shared/types";

type WriteStream = ReturnType<typeof createWriteStream>;
let stream: WriteStream | null = null;
export let logPath = "";
export let jsonlPath = "";

// Structured log buffer: flushed every 100ms, or immediately for errors.
let jsonlBuffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let loggingEnabled = true;

export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
  if (!enabled) flushJsonlBuffer(); // flush pending before turning off
}

export function isLoggingEnabled(): boolean {
  return loggingEnabled;
}

export function initLogger(): void {
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  logPath = join(dir, `session-${ts}.log`);
  jsonlPath = join(dir, `session-${ts}.jsonl`);
  stream = createWriteStream(logPath, { flags: "a" });
  write("INFO", `=== VJ session started ${new Date().toISOString()} ===`);
  write("INFO", `log: ${logPath}`);
  write("INFO", `structured log: ${jsonlPath}`);
  flushTimer = setInterval(flushJsonlBuffer, 100);
  flushTimer.unref();
}

function write(level: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `${ts} [${level}] ${msg}\n`;
  process.stdout.write(line);
  stream?.write(line);
}

function flushJsonlBuffer(): void {
  if (jsonlBuffer.length === 0 || !jsonlPath) return;
  const batch = jsonlBuffer.join("");
  jsonlBuffer = [];
  try {
    appendFileSync(jsonlPath, batch);
  } catch { /* noop */ }
}

export function logStructured(entry: LogEntry): void {
  if (!loggingEnabled || !jsonlPath) return;
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + "\n";
  if (entry.level === "error") {
    // Sync write for errors so they survive crashes.
    flushJsonlBuffer(); // flush pending buffer first
    try { appendFileSync(jsonlPath, line); } catch { /* noop */ }
  } else {
    jsonlBuffer.push(line);
  }
}

export function logInfo(...args: unknown[]): void { write("INFO",  ...args); }
export function logWarn(...args: unknown[]): void { write("WARN",  ...args); }
export function logError(...args: unknown[]): void { write("ERROR", ...args); }

export function closeLogger(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flushJsonlBuffer();
  if (stream) {
    write("INFO", "=== VJ session ended ===");
    stream.end();
    stream = null;
  }
}
