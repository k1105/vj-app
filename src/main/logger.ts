import { app } from "electron";
import { createWriteStream, mkdirSync } from "fs";
import { join } from "path";

type WriteStream = ReturnType<typeof createWriteStream>;
let stream: WriteStream | null = null;
export let logPath = "";

export function initLogger(): void {
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  logPath = join(dir, `session-${ts}.log`);
  stream = createWriteStream(logPath, { flags: "a" });
  write("INFO", `=== VJ session started ${new Date().toISOString()} ===`);
  write("INFO", `log: ${logPath}`);
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

export function logInfo(...args: unknown[]): void { write("INFO",  ...args); }
export function logWarn(...args: unknown[]): void { write("WARN",  ...args); }
export function logError(...args: unknown[]): void { write("ERROR", ...args); }

export function closeLogger(): void {
  if (stream) {
    write("INFO", "=== VJ session ended ===");
    stream.end();
    stream = null;
  }
}
