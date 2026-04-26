import { useEffect, useState } from "react";
import type { SplatProgress } from "../../shared/types";

const COMMAND_KEY = "splatGeneratorCommand";

/**
 * Image → 3D Gaussian Splatting tab.
 *
 * The actual generator is configurable (any CLI that accepts an input
 * image and writes a .splat file). The user sets the command once via the
 * input here; we persist it via electron-store. Two placeholders are
 * required: {input} and {output}.
 */
export function SceneTab() {
  const [command, setCommand] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SplatProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.vj.getSetting(COMMAND_KEY).then((v) => {
      if (typeof v === "string") setCommand(v);
    });
    const off = window.vj.onSplatProgress(setProgress);
    return off;
  }, []);

  const persistCommand = (next: string) => {
    setCommand(next);
    void window.vj.setSetting(COMMAND_KEY, next);
  };

  const onPick = async () => {
    setError(null);
    const p = await window.vj.pickImageFile();
    if (!p) return;
    setImagePath(p);
    if (!name) {
      const base = p.split("/").pop() ?? "scene";
      setName(base.replace(/\.[^.]+$/, ""));
    }
  };

  const onGenerate = async () => {
    if (!imagePath || busy) return;
    setBusy(true);
    setError(null);
    setProgress({ percent: 0, stage: "starting" });
    try {
      const result = await window.vj.generateSplat(imagePath, name || "scene");
      setProgress({ percent: 100, stage: "done", message: result.pluginId });
      setImagePath(null);
    } catch (err) {
      setError((err as Error).message);
      setProgress({ percent: 0, stage: "error" });
    } finally {
      setBusy(false);
    }
  };

  const placeholderHint =
    command.length > 0
      ? null
      : "Leave blank to use the default Apple SHARP command (`conda run -n sharp sharp predict -i {inputDir} -o {outputDir}`). Placeholders: {inputDir}, {outputDir}, {input}, {output}.";

  return (
    <div className="scene-tab">
      <div className="scene-section scene-install">
        <div className="scene-section-title">SHARP install (one-time)</div>
        <pre className="scene-pre">{`conda create -y -n sharp python=3.13
conda activate sharp
git clone https://github.com/apple/ml-sharp.git ~/ml-sharp
cd ~/ml-sharp && pip install -r requirements.txt`}</pre>
        <div className="scene-hint">
          Or run <code>bash bin/install-sharp.sh</code> from the repo root.
          Apple's "Apple Sample Code" license — review before using output in
          paid productions. macOS uses MPS automatically; the built-in
          orbit-render preview is CUDA-only and not used here.
        </div>
      </div>

      <div className="scene-section">
        <div className="scene-section-title">Generator command</div>
        <input
          className="scene-command"
          placeholder='/opt/homebrew/Caskroom/miniforge/base/bin/conda run -n sharp sharp predict -i {inputDir} -o {outputDir}'
          value={command}
          onChange={(e) => persistCommand(e.target.value)}
        />
        {placeholderHint && (
          <div className="scene-hint">{placeholderHint}</div>
        )}
      </div>

      <div className="scene-section">
        <div className="scene-section-title">Source image</div>
        <div className="scene-row">
          <button className="btn-mini" onClick={onPick} disabled={busy}>
            Pick image…
          </button>
          <span className="scene-imgpath">
            {imagePath ?? <em className="scene-muted">(none selected)</em>}
          </span>
        </div>
      </div>

      <div className="scene-section">
        <div className="scene-section-title">Asset name</div>
        <input
          className="scene-name"
          placeholder="My Scene"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="scene-section">
        <button
          className="btn-mini accent"
          onClick={onGenerate}
          disabled={busy || !imagePath}
        >
          {busy ? "Generating…" : "Generate splat"}
        </button>
      </div>

      {progress && (
        <div className={`scene-progress stage-${progress.stage}`}>
          <div className="scene-progress-bar">
            <div
              className="scene-progress-fill"
              style={{ width: `${Math.round(progress.percent)}%` }}
            />
          </div>
          <div className="scene-progress-text">
            {progress.stage} · {Math.round(progress.percent)}%
            {progress.message && (
              <span className="scene-progress-msg"> · {progress.message}</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="scene-error" onClick={() => setError(null)}>
          ✗ {error} — click to dismiss
        </div>
      )}
    </div>
  );
}
