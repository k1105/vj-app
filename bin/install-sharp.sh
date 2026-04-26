#!/usr/bin/env bash
# Install Apple's SHARP (apple/ml-sharp) into a conda env so the VJ app's
# Scene tab can call it. Prefers an arm64-native conda (Miniforge) on Apple
# Silicon — Intel Anaconda envs can't install torch wheels for python 3.13.
#
# Requirements: a working conda (Miniforge / Miniconda / Anaconda).
#
# Notes:
#   - Apple's license for SHARP is the "Apple Sample Code" style, not OSI.
#     Review LICENSE and LICENSE_MODEL before using output commercially.
#   - On Apple Silicon, Miniforge is required for torch + MPS.
set -euo pipefail

ENV_NAME="${SHARP_ENV:-sharp}"
INSTALL_DIR="${SHARP_DIR:-${HOME}/ml-sharp}"
PYTHON_VERSION="${SHARP_PYTHON:-3.13}"

# Pick the best available conda. On macOS prefer the Miniforge install
# Homebrew drops at /opt/homebrew/Caskroom/miniforge/base/ because that's
# the only one shipping native arm64 packages.
CONDA_BIN=""
if [ -n "${SHARP_CONDA:-}" ]; then
  CONDA_BIN="${SHARP_CONDA}"
elif [ -x "/opt/homebrew/Caskroom/miniforge/base/bin/conda" ]; then
  CONDA_BIN="/opt/homebrew/Caskroom/miniforge/base/bin/conda"
elif command -v conda >/dev/null 2>&1; then
  CONDA_BIN="$(command -v conda)"
fi
if [ -z "${CONDA_BIN}" ]; then
  echo "✗ no conda found. Install Miniforge: brew install --cask miniforge" >&2
  exit 1
fi
echo "→ using conda at ${CONDA_BIN}"

# Warn if the conda is Intel on Apple Silicon — torch wheels won't resolve.
ARCH="$(uname -m)"
SUBDIR="$("${CONDA_BIN}" config --show subdir 2>/dev/null | awk '{print $2}' || true)"
if [ "${ARCH}" = "arm64" ] && [ "${SUBDIR}" = "osx-64" ]; then
  echo "✗ ${CONDA_BIN} is configured for osx-64 on an arm64 host." >&2
  echo "  Use Miniforge instead:  brew install --cask miniforge" >&2
  echo "  or override:  SHARP_CONDA=/opt/homebrew/Caskroom/miniforge/base/bin/conda bash bin/install-sharp.sh" >&2
  exit 1
fi

# Reuse the env if it already exists, otherwise create it.
if "${CONDA_BIN}" env list | awk '{print $1}' | grep -qx "${ENV_NAME}"; then
  echo "✓ conda env \"${ENV_NAME}\" already exists — skipping create"
else
  echo "→ creating conda env \"${ENV_NAME}\" with python=${PYTHON_VERSION}"
  "${CONDA_BIN}" create -y -n "${ENV_NAME}" "python=${PYTHON_VERSION}"
fi

# Clone or update the repo.
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "✓ repo already present at ${INSTALL_DIR} — pulling latest"
  git -C "${INSTALL_DIR}" pull --ff-only || true
else
  echo "→ cloning apple/ml-sharp into ${INSTALL_DIR}"
  git clone https://github.com/apple/ml-sharp.git "${INSTALL_DIR}"
fi

# requirements.txt has `-e .`, so pip's CWD must be the repo. Force `python -m pip`
# so the env's bundled pip is used (bare `pip` may pick up a Homebrew binary
# pointing at a stale interpreter).
echo "→ installing requirements into env \"${ENV_NAME}\""
"${CONDA_BIN}" run --cwd "${INSTALL_DIR}" -n "${ENV_NAME}" \
  python -m pip install -r requirements.txt

# Smoke-test the CLI.
if "${CONDA_BIN}" run -n "${ENV_NAME}" sharp --help >/dev/null 2>&1; then
  echo "✓ sharp CLI is available"
else
  echo "✗ sharp --help failed" >&2
  exit 1
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────
✓ SHARP installed.

Paste this into the VJ app's Scene tab → "Generator command":

  ${CONDA_BIN} run -n ${ENV_NAME} sharp predict -i {inputDir} -o {outputDir}

──────────────────────────────────────────────────────────────────────
EOF
