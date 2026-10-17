#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v ffmpeg >/dev/null; then
  echo 'Install ffmpeg first: brew install ffmpeg' >&2
  exit 1
fi
export UV_CACHE_DIR="$PWD/.cache/uv"
export UV_PYTHON_INSTALL_DIR="$PWD/.cache/python"
if command -v uv >/dev/null; then
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python -r requirements.txt
else
  python3.12 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
export HF_HOME="$PWD/.cache/huggingface"
.venv/bin/python setup.py
.venv/bin/python -m unittest discover -s .
