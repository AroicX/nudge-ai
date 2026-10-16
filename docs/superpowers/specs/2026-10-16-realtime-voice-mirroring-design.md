# Nudge Realtime Voice Mirroring Design

## Goal

Make Nudge voice behave like the working Atlast conversation: one continuous OpenAI Realtime call that listens, speaks, preserves conversational context, supports natural pauses, and stops its current reply immediately when the user begins speaking. Browser actions must continue to use Nudge's existing guarded executor and verified page evidence.

## Current failure

Nudge currently splits one spoken turn across two independent response paths. The Realtime session may generate audio, while the final user transcript is also submitted to the text browser agent. Browser-agent results are added to chat but are never returned to the Realtime session for speech. In addition, input transcription and noise reduction are not configured, volume-based VAD ends turns too aggressively, and the browser audio element is paused on interruption without being resumed for the next assistant response.

## Target architecture

The browser side panel keeps one WebRTC Realtime session for the duration of a voice call. OpenAI owns audio input, turn detection, conversational response generation, and audio output. Nudge keeps the existing text browser-agent loop as the authority for page operations.

When the Realtime model requests a browser task, Nudge runs that request through the existing intake, policy, action, verification, cancellation, and tab orchestration path. The verified result is then inserted into the same Realtime conversation as trusted tool output or a system result, followed by `response.create`. The model speaks that verified result. It must not claim an operation succeeded before that result is returned.

Ordinary conversational turns stay inside Realtime and are not also submitted to the text pipeline. This removes duplicate replies. Voice transcripts continue to appear in the existing chat history.

## Session configuration

The server-created Realtime session mirrors Atlast's proven settings:

- Configurable Realtime model and `marin` voice.
- Audio output modality.
- `gpt-transcribe` input transcription with language `en`.
- Near-field input noise reduction.
- Semantic VAD with low eagerness.
- Automatic response creation and interruption enabled.
- Concise conversational instructions that require tools for browser facts and actions.
- Strict browser-task tool schema with no parallel mutations.

The API key remains server-side. The extension receives only a short-lived client secret.

## Browser audio lifecycle

The side panel creates one hidden, inline, autoplay audio element for the remote WebRTC stream. It starts playback when the remote track arrives and explicitly resumes playback on every `output_audio_buffer.started` event. A user interruption cancels the active response and clears buffered remote audio. The remote track remains attached so the following response can play.

Microphone capture requests echo cancellation, noise suppression, automatic gain control, and mono input. Closing the panel or ending the call stops every local track, detaches and removes the audio element, closes the data channel and peer connection, and prevents late async setup from reviving the call.

## Browser task bridge

The Realtime session exposes one strict `run_browser_task` function containing the user's requested goal. Function calls are deduplicated by call ID. Each call enters the existing `runBrowserTask` flow; no direct DOM execution is added.

While a browser task is running, the current Nudge Stop behavior remains authoritative. On completion, the bridge returns a compact, verified outcome to Realtime and requests a spoken response. On failure, cancellation, permission denial, or required confirmation, the bridge returns that exact state so the voice response asks for the appropriate next step.

Text messages continue to use the normal text path. If text is submitted during an active voice call, Nudge inserts it into the Realtime conversation rather than creating a competing assistant response.

## Transcript and interruption behavior

Final user transcription creates one user chat turn. Assistant transcript deltas may update the live transcript, but an assistant chat turn is committed only when the corresponding audio playback completes. Interrupted assistant output is marked as interrupted rather than storing words the user may never have heard.

Speech-start events immediately update the UI to user-speaking and stop the assistant audio. Speech-stop transitions to thinking. Output-audio start transitions to assistant-speaking and resumes playback. Output-audio stop returns to listening.

## Error handling

- Microphone denial keeps text input available and opens the existing setup flow.
- Autoplay failure shows an actionable voice error without breaking typed chat.
- Realtime disconnect ends the call cleanly and retains completed chat turns.
- Invalid or duplicate function calls never execute browser actions.
- Provider errors surface a concise message and allow a fresh call.
- Ollama remains text-only; Realtime controls stay hidden while it is selected.

## Verification

Automated tests will cover session configuration, microphone constraints, playback resumption, interruption ordering, cleanup, transcript commitment, duplicate tool calls, verified result return, and prevention of duplicate text-agent responses. Existing extension, server, contracts, and core suites must remain green, followed by type-checking and a production extension build.

Manual Chrome acceptance will cover a multi-turn conversation, natural mid-sentence pauses, a browser action with spoken verified output, interruption during a long reply, a second reply after interruption, and ending/restarting the call.
