# Local hands-free voice

User-authorized stack: Whisper, Qwen 3.5:9b, Kokoro on Apple M2 with 24 GB unified memory.

The call listens continuously, automatically detects speech boundaries, transcribes locally, generates a concise answer, and plays synthesized speech. Speaking again interrupts pending generation/playback. Start, end, and mute are call controls; no per-turn send button. This is a staged speech pipeline with conversational pauses, not a native simultaneous speech model.

Use the existing pairing-authenticated Nudge backend, a loopback speech service on port 4318, and Ollama on port 11434. Never fall back to cloud for local speech or chat. Local conversation does not execute tools; final user transcripts continue through Nudge's existing authorization and browser-task controller. Speak verified progress without inventing completed actions.

Bound audio segments, upload size, reply length, history, concurrency, and context. Cancel stale work on interruption/end/provider switch; release microphone, audio nodes, temporary files, and playback URLs. Install models explicitly, not during inference. Health errors must explain missing dependencies/models. Keep existing user changes intact.

Verify automated backend security/validation/timeout tests, frontend VAD and cancellation tests, speech runtime tests, full project tests/types/build, and a local synthetic-audio round trip if downloads complete. Report any untested real-microphone/acoustic behavior.
