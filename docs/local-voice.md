# Local voice on Apple Silicon

Nudge can listen with Whisper small.en, converse through Ollama's `qwen3.5:9b`, and speak with Kokoro. Speech runs in a separate loopback service on `127.0.0.1:4318`. Audio and conversation text stay on your Mac during local inference. Model installation needs internet access.

## Setup

Requirements: Apple Silicon macOS, `ffmpeg` (`brew install ffmpeg`), and either `uv` or Python 3.12. From the project directory:

```sh
./services/local-voice/setup.sh
ollama pull qwen3.5:9b
./services/local-voice/start.sh
```

The startup script reads `NUDGE_PAIRING_SECRET` from the environment, `apps/server/.env`, or the root `.env`. It must match the backend secret. Do not share it. Keep the speech service running alongside the Nudge backend and Ollama. Select Local voice in Nudge's voice settings.

Setup installs an isolated Python environment and explicitly downloads approximately 1.1 GB of speech weights. The environment, cache, and models are ignored by Git. No automatic model downloads occur during inference. If installation stops, rerun setup.

## M2 / 24 GB defaults

- Whisper small.en uses MLX / Metal and retains its model after the first utterance.
- Kokoro uses ONNX on two CPU threads, leaving the GPU available to Qwen and Whisper. Its model is loaded once on the first reply.
- Only one speech inference runs at a time. Busy requests receive HTTP 429 instead of starting another heavy inference.
- Utterances are limited to 30 seconds and 8 MB. Synthesis accepts at most 2,000 characters. WebM audio is decoded locally through ffmpeg to mono 16 kHz PCM.
- The first reply is slower because speech models need loading. Later replies reuse them.
- Keep Ollama at one parallel request and one loaded model. Prefer the 9B Qwen model; the 27B model leaves too little memory for comfortable multitasking.

This is a hands-free turn-taking conversation, not simultaneous full-duplex speech generation. The browser detects pauses and sends each utterance automatically. Interrupting playback cancels the client response; an already running local inference may finish before the service accepts another request. Headphones help prevent speaker audio from being picked up as new speech.

## Checks and troubleshooting

```sh
services/local-voice/.venv/bin/python -m unittest discover -s services/local-voice
curl http://127.0.0.1:4318/health
```

`available: true` means model files and ffmpeg are present and pairing is configured. It does not benchmark model inference. HTTP 503 means setup/configuration is missing or inference failed; inspect the service terminal. HTTP 422 means invalid audio/text or an utterance longer than 30 seconds. Stop the speech service when not using voice to reclaim its model memory.

The service does not enable cross-origin browser access: the Nudge backend proxies authenticated requests. Speech synthesis and transcription require `x-nudge-pairing-secret`. Temporary recordings are removed after transcription; the service does not keep conversation history.

Primary implementation references: [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), [Whisper small.en weights](https://huggingface.co/mlx-community/whisper-small.en-mlx), [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx).
