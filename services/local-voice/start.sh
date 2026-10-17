#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo 'Run services/local-voice/setup.sh first.' >&2
  exit 1
fi
# Read the same backend pairing secret without executing an .env file as code.
exec .venv/bin/python launch.py
