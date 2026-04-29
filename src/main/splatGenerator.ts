import { spawn } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { basename, extname, join } from "path";
import { randomUUID } from "crypto";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";
import { getSetting } from "./store";
import type { SplatProgress, SplatResult } from "../shared/types";

/**
 * Image → 3D Gaussian Splatting pipeline.
 *
 * The actual generator is configurable via the `splatGeneratorCommand`
 * electron-store setting. Default targets Apple's SHARP (`apple/ml-sharp`),
 * which is a directory-in / directory-out CLI:
 *
 *   conda run -n sharp sharp predict -i <inputDir> -o <outputDir>
 *
 * Placeholders supported in the command template:
 *   {inputDir}  → temp dir containing the source image (for batch CLIs)
 *   {outputDir} → temp dir the generator should write its result into
 *   {input}     → absolute path to the staged source image (for file CLIs)
 *   {output}    → absolute path the generator should write to (for file CLIs)
 *
 * After the command exits, we scan {outputDir} recursively for the first
 * .ply / .splat / .ksplat file and copy it into the new plugin directory.
 */

// Use the absolute path to Miniforge's conda by default — picking up bare
// `conda` on $PATH risks hitting an Intel Anaconda install whose `sharp` env
// can't actually run torch. install-sharp.sh writes its env into Miniforge.
const DEFAULT_COMMAND =
  "/opt/homebrew/Caskroom/miniforge/base/bin/conda run -n sharp sharp predict -i {inputDir} -o {outputDir}";
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;
const SPLAT_EXTS = [".ply", ".splat", ".ksplat"];

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function pluginsDir(): string {
  return join(appRoot(), "plugins");
}

async function pickUniqueSlug(baseSlug: string): Promise<string> {
  let slug = `scene-${baseSlug || "untitled"}`;
  let suffix = 1;
  while (true) {
    try {
      await fs.access(join(pluginsDir(), slug));
      suffix++;
      slug = `scene-${baseSlug}-${suffix}`;
    } catch {
      return slug;
    }
  }
}

function defaultManifest(name: string, splatFile: string): Record<string, unknown> {
  return {
    name: name.trim() || "Scene",
    author: "user",
    version: "0.1.0",
    outputType: "splat",
    category: "scene",
    splatFile,
    params: [
      // SHARP places the scene roughly at (0, 0, +z) in OpenCV space; after
      // BuiltinSplatPlugin's 180°-X rotation that becomes (0, 0, -z), so a
      // camera at the origin looking toward -Z sees the scene.
      // The target sits deeper inside the scene so orbitSpeed pivots around
      // the scene's interior rather than spinning the camera in place.
      { key: "posX",       type: "float", default: 0,  min: -10, max: 10,  step: 0.05 },
      { key: "posY",       type: "float", default: 0,  min: -10, max: 10,  step: 0.05 },
      { key: "posZ",       type: "float", default: 0,  min: -10, max: 10,  step: 0.05 },
      { key: "targetX",    type: "float", default: 0,  min: -10, max: 10,  step: 0.05 },
      { key: "targetY",    type: "float", default: 0,  min: -10, max: 10,  step: 0.05 },
      { key: "targetZ",    type: "float", default: -5, min: -50, max: 10,  step: 0.05 },
      { key: "fov",         type: "float", default: 50,  min: 20, max: 120, step: 1    },
      { key: "cruiseSpeed", type: "float", default: 0,   min: -1, max: 1,   step: 0.01 },
      { key: "cruiseSize",  type: "float", default: 0.5, min: 0,  max: 1,   step: 0.01 },
    ],
  };
}

async function findFirstSplatOutput(dir: string): Promise<string | null> {
  async function walk(d: string): Promise<string | null> {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        const inner = await walk(p);
        if (inner) return inner;
      } else if (SPLAT_EXTS.some((x) => p.toLowerCase().endsWith(x))) {
        return p;
      }
    }
    return null;
  }
  return walk(dir);
}

export async function generateSplat(
  imagePath: string,
  name: string,
  onProgress: (p: SplatProgress) => void,
): Promise<SplatResult> {
  const configured = getSetting("splatGeneratorCommand") as string | undefined;
  const command =
    configured && configured.trim().length > 0 ? configured : DEFAULT_COMMAND;

  // Verify the source image exists before doing anything irreversible.
  await fs.access(imagePath);

  const slug = await pickUniqueSlug(slugify(name));
  const pluginDir = join(pluginsDir(), slug);
  await fs.mkdir(pluginDir, { recursive: true });

  // SHARP (and most multi-view splat tools) take input/output directories,
  // not file pairs. Stage the image into a fresh temp dir, give the
  // generator another temp dir to write into, then harvest whatever
  // .ply/.splat appears.
  const tempBase = join(tmpdir(), `vj-splat-${randomUUID()}`);
  const inputDir = join(tempBase, "in");
  const outputDir = join(tempBase, "out");
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  const ext = extname(imagePath) || ".jpg";
  const stagedImage = join(inputDir, `image${ext}`);
  await fs.copyFile(imagePath, stagedImage);

  const cmd = command
    .split("{inputDir}").join(JSON.stringify(inputDir))
    .split("{outputDir}").join(JSON.stringify(outputDir))
    .split("{input}").join(JSON.stringify(stagedImage))
    .split("{output}").join(JSON.stringify(join(outputDir, "scene.ply")));

  onProgress({ percent: 0, stage: "starting", message: cmd });

  const cleanup = async () => {
    await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
  };

  return new Promise<SplatResult>((resolvePromise, reject) => {
    const proc = spawn(cmd, { shell: true });
    let lastErr = "";
    let stderrBuf = "";

    const handleLine = (line: string) => {
      if (!line) return;
      const m = PERCENT_RE.exec(line);
      const percent = m ? Math.max(0, Math.min(100, parseFloat(m[1]))) : -1;
      onProgress({
        percent: percent >= 0 ? percent : 0,
        stage: "running",
        message: line,
      });
    };

    let stdoutBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        handleLine(stdoutBuf.slice(0, idx).trim());
        stdoutBuf = stdoutBuf.slice(idx + 1);
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      lastErr = text.trim().split("\n").slice(-3).join(" | ");
      handleLine(text.trim());
    });

    proc.on("error", async (err) => {
      await cleanup();
      await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});
      reject(new Error(`failed to launch splat generator: ${err.message}`));
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        await cleanup();
        await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});
        const hint = lastErr || stderrBuf.slice(-300);
        reject(
          new Error(`splat generator exited with code ${code}${hint ? `: ${hint}` : ""}`),
        );
        return;
      }
      const produced = await findFirstSplatOutput(outputDir);
      if (!produced) {
        await cleanup();
        await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});
        reject(
          new Error(
            "generator finished but no .ply/.splat/.ksplat appeared in the output directory",
          ),
        );
        return;
      }
      const splatFile = `scene${extname(produced)}`;
      await fs.copyFile(produced, join(pluginDir, splatFile));
      await cleanup();

      const manifest = defaultManifest(name, splatFile);
      await fs.writeFile(
        join(pluginDir, "manifest.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        "utf-8",
      );
      await broadcastPluginsNow();
      onProgress({ percent: 100, stage: "done", message: basename(produced) });
      resolvePromise({ pluginId: slug });
    });
  });
}
