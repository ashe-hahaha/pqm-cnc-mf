#!/usr/bin/env bash
# Starts the Whisper STT sidecar on 127.0.0.1:8765 using the venv in ~/pdm-cnc-voice.
set -euo pipefail
V="${PDM_VOICE_HOME:-$HOME/pdm-cnc-voice}"
SP="$V/venv/lib/python3.12/site-packages/nvidia"
export LD_LIBRARY_PATH="$SP/cublas/lib:$SP/cudnn/lib:$SP/cuda_nvrtc/lib:${LD_LIBRARY_PATH:-}"
cd "$(dirname "$0")"
exec "$V/venv/bin/python" -m uvicorn stt_server:app --host 127.0.0.1 --port "${STT_PORT:-8765}"
