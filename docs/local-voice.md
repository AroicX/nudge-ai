# Local voice on Apple Silicon

Nudge can listen with Whisper small.en, converse through Ollama's `qwen3.5:9b`, and speak with Kokoro. Speech runs in a separate loopback service on `127.0.0.1:4318`. Audio and conversation text stay on your Mac during local inference. Model installation needs internet access.

## Setup

Requirements: Apple Silicon macOS, `ffmpeg` (`brew install ffmpeg`), and either `uv` or Python 3.12. From the project directory:

```sh
./services/local-voice/setup.sh
ollama pull qwen3.5:9b
./services/local-voice/start.sh
```

The startup script reads `NUDGE_PAIRING_SECRET` from the environment, `apps/server/.env`, or the root `.env`. It must match the backend secret. Keep the speech service running alongside the Nudge backend and Ollama. Reload the built extension in Chrome, choose **Ollama** in Nudge's **Provider settings**, select `qwen3.5:9b`, then press **Start voice call**. No OpenAI key is required for the local path.

Speak naturally; no per-turn record or send button is needed. The call uses adaptive pauses: about 1.1 seconds for longer speech, 1.8 seconds for short speech, and 2.2 seconds after an unfinished phrase. Speak over a reply to interrupt it; mute and end-call controls are also available. Give direct browser commands naturally, such as **“Open YouTube”**, **“Go to github.com”**, or **“Scroll down”**. No wake word is required for those commands. **“Nudge, …”** remains available for other task requests (for example, “Nudge, find a kettle”); “Notch” is also accepted as a transcription variant. Questions about commands and ordinary conversation remain in voice chat. During an active browser task, exact “stop”, “pause”, and “resume” commands control that task. Browser actions retain Nudge's existing validation and approval rules.

Setup installs an isolated Python environment and explicitly downloads approximately 835 MB of speech weights (plus Python dependencies). The environment, cache, and models are ignored by Git. No automatic model downloads occur during inference. If installation stops, rerun setup.

## M2 / 24 GB defaults

- Whisper small.en uses MLX / Metal and retains its model after the first utterance.
- Kokoro uses ONNX on two CPU threads, leaving the GPU available to Qwen and Whisper. Its model is loaded once on the first reply.
- Only one speech inference runs at a time. Busy requests receive HTTP 429 instead of starting another heavy inference.
- After an interruption, the backend waits up to 30 seconds for an already-running speech inference to release the engine. A newer utterance cancels that wait.
- Qwen conversation uses no thinking, a 4,096-token context, a 160-token reply limit, and at most 12 history messages totaling 10,000 characters. It unloads after two idle minutes.
- Utterances are limited to 30 seconds and 8 MB. Synthesis accepts at most 2,000 characters. WebM audio is decoded locally through ffmpeg to mono 16 kHz PCM.
- The first reply is slower because speech models need loading and MLX may compile kernels. Later replies reuse them.
- Keep Ollama at one parallel request and one loaded model. Prefer the 9B Qwen model; the 27B model leaves too little memory for comfortable multitasking.

This is a hands-free turn-taking conversation, not simultaneous full-duplex speech generation. The browser detects pauses and sends each utterance automatically. Interrupting playback cancels the client response; an already running local inference may finish before the service accepts another request. Headphones help prevent speaker audio from being picked up as new speech.

## Checks and troubleshooting

```sh
services/local-voice/.venv/bin/python -m unittest discover -s services/local-voice
curl http://127.0.0.1:4318/health
pnpm --filter @nudge/server exec tsx src/voice/local-voice.smoke.ts
```

`available: true` means model files and ffmpeg are present and pairing is configured. It does not benchmark model inference. HTTP 503 means setup/configuration is missing or inference failed; inspect the service terminal. HTTP 422 means invalid audio/text or an utterance longer than 30 seconds. Stop the speech service when not using voice to reclaim its model memory.

The service does not enable cross-origin browser access: the Nudge backend proxies authenticated requests. Speech synthesis and transcription require `x-nudge-pairing-secret`. Temporary recordings are removed after transcription; the service does not keep conversation history.

Primary implementation references: [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), [Whisper small.en weights](https://huggingface.co/mlx-community/whisper-small.en-mlx), [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx).

## Verified on this Mac

The offline model smoke test generated a valid Kokoro WAV and Whisper transcribed it as “Hello, I am Nudge. Please open my calendar.” Initial synthesis took 6.51 seconds, first transcription including imports/initialization took 35.59 seconds, and a warm Kokoro reply took 0.81 seconds. These are one-run measurements, not guaranteed conversational latency. Run the same check with:

```sh
services/local-voice/.venv/bin/python services/local-voice/smoke_test.py
```

The complete authenticated Nudge pipeline also passed on October 17, 2026: synthesized “What is two plus two?”, transcribed “What is 2 plus 2?”, obtained the correct Qwen answer, and returned a valid spoken WAV. A repeated warm run measured 0.54 s transcription, 1.09 s Qwen generation, and 1.36 s reply synthesis: approximately 3.0 s processing plus pause detection and transport/playback startup. These short synthetic samples are not a general latency guarantee.

375 application tests, 14 speech-service tests, type checks, production build, and a Chrome test using a synthetic microphone passed. The browser test covers automatic segmentation, playback interruption, and microphone cleanup; it does not test your microphone, room acoustics, or accent. About 6.7 GB of system swap was observed during the integration run, so memory pressure from the complete running workload remains relevant. Prefer headphones and avoid running the 27B model alongside local calls.

### Faster local calls and Nigerian English

Calls now prepare Whisper, Kokoro and Qwen before opening the microphone. The initial Connecting phase can take a few seconds (longer after a cold start). Qwen streams its reply, and Kokoro starts on the first complete sentence or bounded first clause instead of waiting for the whole answer. At most one phrase is prepared ahead of playback; interrupting or ending the call cancels queued playback. Responses favour one short sentence, with a 96-token ceiling, 4096-token context and two-minute Ollama keep-alive. Kokoro remains limited to two CPU threads. No additional model or cloud service is used.

Whisper remains small.en on Apple MLX. Recognition uses English with a short Nigerian English/local vocabulary hint, preserves the original transcript, rejects near-silent clips, and avoids a redundant audio decode. This is vocabulary conditioning, **not accent training**: it cannot guarantee recognition of every Nigerian accent or name. The endpoint detector retains 300ms of pre-roll and allows 1.8 seconds of silence for short speech, 1.1 seconds for longer speech, and 2.2 seconds when an interim transcript ends with an unfinished phrase such as “Can you”. These are pause heuristics, not a guarantee that every hesitation will be recognized. If recognition is wrong, compare an actual short recording and its expected words; synthetic TTS is not an accent-accuracy test.

For a repeatable local latency check, run `pnpm --filter @nudge/server exec tsx src/voice/local-voice.latency.ts`. It uses synthetic audio, measures transcription through the first generated audio phrase, and excludes adaptive end-of-speech detection and browser playback startup. Results depend on other apps and memory pressure.

### Browser requests and task progress

Direct shopping/search requests (for example, “find me a black iPhone 16”) and questions about the current page go to the browser task controller. The tab is captured when the final voice transcript arrives, and the same tab supplies the website chip beneath that request. The conversational channel has no live page observations and must not guess the current site or current product availability.

The Nexus Reasoning display shows measured task and step durations, attached to the original request and retained in chat history. “Task complete” comes from the controller's terminal state, never from a finished understanding/planning step. Model-authored plan flags are not spoken as verified completions. Navigation completion requires observed destination evidence or a verified navigation action.

Local browser planning uses an 8K context, bounded output, and a maximum 18,000 UTF-8 bytes of serialized page/task data. On dense pages, the adapter prioritizes relevant products and controls, marks omitted content, and preserves authorization and safety context. This avoids sending huge page snapshots into Ollama. The opt-in `pnpm --filter @nudge/server exec tsx ../../scripts/local-browser-smoke.ts` checks the local planner (including the exact-navigation fast path) against a simulated browser and verifies navigation and completion; it does not change your actual tabs.

Exact requests to open a known website or an explicit HTTP(S) URL bypass language-model inference, while still using the controller’s authorization checks, navigation tool, and post-action verification. Compound or ambiguous requests continue through the model.

### Interim transcripts and incremental replies

During a local call, bounded audio snapshots are sent to local Whisper approximately every two seconds while speech continues. Only one transcription request runs at a time, with one replaceable pending snapshot; final utterance audio takes priority. Interim words appear in a temporary user bubble and may be revised. Only the final transcription is saved or routed to browser actions. Ending or muting the call cancels pending previews, and stale recognition results are ignored.

Qwen reply text updates a temporary assistant bubble as tokens arrive. Kokoro synthesizes bounded phrases serially, preparing at most one phrase ahead of playback. This is incremental transcription and phrase-based playback: Whisper does not stream word tokens and Kokoro does not stream PCM audio through this implementation. No extra conversational model request is used to create the first audio phrase.

### October 18 interface and regression checks

Both the compact panel and dashboard now share Nudge branding and a persisted light/dark theme. Streaming messages, status changes and interim speech follow the bottom of the conversation; scrolling up pauses following until you send a message or choose Jump to latest. Task timings and scheduled-task management are available only in the full-page dashboard. Historical interrupted tasks no longer keep a live timer running.

Memory is organized into Profile, Documents and Settings tabs, with local document extraction, upload validation, automatic-memory and local-diagnostics controls, and a reviewed cleanup action for older chats. Cleanup is manual, not automatic expiry. Local API deletion requests no longer send an empty JSON body header.

The synthetic microphone regression includes a 900 ms mid-sentence pause, interim transcription, a single final request, interruption and microphone cleanup. Offline Kokoro/Whisper also completed an actual synthesis/transcription check. These checks do not establish recognition accuracy for a person's microphone or Nigerian English accent. Production build, type checking, lint and focused regression tests passed after these changes. The installed Chrome panel/dashboard were reloaded and their shared theme and memory tabs checked visually.

Multi-step local browser latency remains a separate limitation. See [the browser validation record](benchmarks/ollama-browser-2026-10-18.md) for measured results and failures; do not interpret interface or synthetic speech checks as ten passing Ollama browser scenarios.
