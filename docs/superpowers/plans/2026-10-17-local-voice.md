# Local Voice Implementation Plan

> **For agentic workers:** Use test-first implementation and verification-before-completion. Independent frontend and speech-service work may run in parallel.

**Goal:** Hands-free local calls using Whisper, Qwen 3.5:9b, and Kokoro.

**Architecture:** Browser VAD segments continuous microphone input and cancels playback/generation on barge-in. Authenticated Fastify endpoints proxy a loopback speech runtime and bounded Ollama chat; existing browser-task authorization remains the action boundary.

**Tech Stack:** TypeScript, React, Web Audio, Fastify, Python speech service, Ollama.

**Spec:** ../specs/2026-10-17-local-voice.md

## Global Constraints
- Apple M2, 24 GB shared RAM; model qwen3.5:9b, thinking disabled, short responses.
- Local inference only; explicit model installation; preserve unrelated user edits.
- Continuous call controls, automatic speech segmentation, interruption, cancellation.

## Review Focus
- Stale audio or chat after end/mute/provider switch: frontend lifecycle tests.
- Silence/noise and short utterances: VAD tests and empty transcription handling.
- Missing models: readiness tests and actionable errors.
- Unpaired or oversized input: backend/sidecar rejection tests.
- Concurrent requests and stalled engines: busy/timeout tests, bounded memory.

## Tasks
1. Speech service (`services/local-voice`, `docs/local-voice.md`): write tests, implement authenticated `/health`, `/transcribe`, `/speech`; setup isolated dependencies and models; verify fake-engine tests plus real synthesis/transcription.
2. Nudge backend (`apps/server/src/voice`, `routes/local-voice*`, `app.ts`): write failing tests, implement paired GET `/api/local-voice/health`, POST `/transcribe` multipart -> `{text}`, POST `/chat` `{messages:[{role,content}]}` -> `{text}`, POST `/speech` `{text}` -> WAV. Limit history/reply/context; cancel disconnected requests; verify tests.
3. Frontend (`apps/extension`): write VAD/lifecycle tests, implement local VoiceTransport, local client endpoints and provider selection. Continuous call UI; local dictation for Ollama; verify tests.
4. Integration: review interfaces and privacy/cancellation; run full tests, types, build, synthetic local round trip; document measured limits and setup.

## Execution notes
- The user's follow-up explicitly replaced manual turn-by-turn input with hands-free calls.
- Work remains in the shared checkout so existing uncommitted functionality is preserved and tested together. No commits or branch changes are required.
