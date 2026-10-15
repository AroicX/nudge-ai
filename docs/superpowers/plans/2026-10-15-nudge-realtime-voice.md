# Nudge Realtime Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a call-style, full-duplex, interruptible voice experience to the verified Nudge text loop without creating a separate browser-action path.

**Architecture:** The side-panel document owns microphone capture and a browser WebRTC session authenticated by a short-lived credential minted by the loopback backend. Voice turns enter the existing task loop; function requests are treated as intents and remain subject to the same policy, tab binding, execution, verification, and cancellation rules as text.

**Tech Stack:** TypeScript, React, Zustand, OpenAI Realtime or GPT-Live over WebRTC as supported by the verified current API, native MediaDevices and WebRTC APIs, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-nudge-mvp-design.md`

## Global Constraints

- Start Voice opens one ongoing conversation; End Call closes it.
- The user can interrupt Nudge speech immediately through barge-in.
- Stop Task cancels browser work without necessarily ending the call; End Call stops both.
- The standard OpenAI API key never reaches the extension; only short-lived client credentials may enter the browser.
- Closing the side panel stops microphone tracks, playback, the realtime connection, and active browser work.
- Text remains usable during calls, and push-to-talk remains a fallback.
- Voice function requests never bypass the existing deterministic policy and verified executor.

## Review Focus

- Starting a second call while one is connecting must not leak two microphone streams; `voice-session-controller.test.ts` pins single ownership.
- Barge-in must stop buffered audio as well as future generation; `realtime-transport.test.ts` pins response cancellation and output clearing.
- A spoken Stop received during a pending provider call must invalidate later actions; `voice-task-bridge.test.ts` pins shared cancellation.
- Closing the panel during connection setup must still release late-arriving tracks and peer connections; `voice-session-controller.test.ts` pins teardown races.
- Realtime failure must preserve the active task and typed composer; `VoiceControls.test.tsx` pins graceful fallback.

---

### Task 1: Voice contracts and transport boundary

**Files:**
- Create: `packages/contracts/src/voice.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/core/src/voice/voice-transport.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/voice/voice-transport.test.ts`

**Interfaces:**
- Consumes: task IDs and cancellation generations from the text loop.
- Produces: `VoiceTransport` with `connect(config)`, `disconnect(reason)`, `interrupt()`, `setMuted(muted)`, `sendText(text)`, and typed `VoiceEvent` subscription.

- [ ] **Step 1: Write failing contract tests for idle, connecting, listening, user-speaking, assistant-speaking, interrupted, reconnecting, failed, and ended states.**
- [ ] **Step 2: Run focused tests; expect failures because voice contracts are absent.**
- [ ] **Step 3: Implement voice schemas and a provider-independent transport interface with idempotent cleanup requirements.**
- [ ] **Step 4: Run core and contracts tests plus type checking; expect success.**
- [ ] **Step 5: Commit with `git commit -m "feat: define realtime voice boundary"`.**

### Task 2: Short-lived realtime session endpoint

**Files:**
- Create: `apps/server/src/routes/realtime-session.ts`
- Create: `apps/server/src/routes/realtime-session.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/config.ts`

**Interfaces:**
- Consumes: paired backend authentication and current OpenAI server credential.
- Produces: `POST /api/realtime/session`, returning only the minimum short-lived connection material and non-secret session configuration.

- [ ] **Step 1: Verify the current official OpenAI recommendation for full-duplex browser voice, exact package/import path, session endpoint, supported model ID, ephemeral credential shape, tool events, interruption, and WebRTC cleanup.**
- [ ] **Step 2: Write failing route tests for pairing, missing provider key, bounded session configuration, upstream timeout, sanitized errors, and absence of the standard API key in responses.**
- [ ] **Step 3: Run server tests; expect the new route tests to fail.**
- [ ] **Step 4: Implement the official short-lived session flow behind a `RealtimeSessionIssuer` interface and explicit model configuration.**
- [ ] **Step 5: Run server tests and type checking; expect success.**
- [ ] **Step 6: Commit with `git commit -m "feat: issue short-lived voice sessions"`.**

### Task 3: WebRTC transport and interruption

**Files:**
- Create: `apps/extension/src/voice/realtime-transport.ts`
- Create: `apps/extension/src/voice/realtime-events.ts`
- Create: `apps/extension/src/voice/realtime-transport.test.ts`

**Interfaces:**
- Consumes: `VoiceTransport`, session endpoint, `RTCPeerConnection`, and `getUserMedia`.
- Produces: `createRealtimeVoiceTransport(dependencies): VoiceTransport`.

- [ ] **Step 1: Write failing tests for connection, remote audio attachment, transcript events, voice activity, function intent events, mute, response cancellation, audio-buffer clearing, remote failure, and idempotent disconnect.**
- [ ] **Step 2: Run focused tests; expect failures because the transport is absent.**
- [ ] **Step 3: Implement the WebRTC transport using the verified official connection flow and validated data-channel events.**
- [ ] **Step 4: Implement interruption so local playback stops immediately and remote generation is cancelled and truncated according to the current API.**
- [ ] **Step 5: Run voice transport tests and type checking; expect success.**
- [ ] **Step 6: Commit with `git commit -m "feat: add interruptible WebRTC voice transport"`.**

### Task 4: Session controller and shared task bridge

**Files:**
- Create: `apps/extension/src/voice/voice-session-controller.ts`
- Create: `apps/extension/src/voice/voice-session-controller.test.ts`
- Create: `apps/extension/src/voice/voice-task-bridge.ts`
- Create: `apps/extension/src/voice/voice-task-bridge.test.ts`
- Modify: `apps/extension/src/state/use-nudge-store.ts`
- Modify: `apps/extension/src/orchestration/run-task.ts`

**Interfaces:**
- Consumes: `VoiceTransport`, Zustand task actions, and `runTask`.
- Produces: `VoiceSessionController.start()`, `end()`, `interrupt()`, `setMuted()`, and a bridge mapping voice turns and function intents into the existing task loop.

- [ ] **Step 1: Write failing controller tests for single-session ownership, permission denial, start/end races, close cleanup, reconnect limits, mute, and fallback state.**
- [ ] **Step 2: Write failing bridge tests proving spoken and typed turns share history, Stop shares cancellation generation, and voice tool intents cannot call the page adapter directly.**
- [ ] **Step 3: Run focused tests; expect failures because controller and bridge are absent.**
- [ ] **Step 4: Implement the controller and shared bridge with an explicit lifecycle state machine.**
- [ ] **Step 5: Run voice, orchestration, and store tests; expect success.**
- [ ] **Step 6: Commit with `git commit -m "feat: connect realtime voice to task loop"`.**

### Task 5: Call UI and push-to-talk fallback

**Files:**
- Create: `apps/extension/src/components/VoiceControls.tsx`
- Create: `apps/extension/src/components/VoiceControls.test.tsx`
- Create: `apps/extension/src/components/LiveTranscript.tsx`
- Create: `apps/extension/src/components/VoiceWaveform.tsx`
- Create: `apps/extension/src/voice/push-to-talk-transport.ts`
- Create: `apps/extension/src/voice/push-to-talk-transport.test.ts`
- Create: `apps/server/src/routes/audio-transcribe.ts`
- Create: `apps/server/src/routes/audio-transcribe.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/src/styles/app.css`

**Interfaces:**
- Consumes: `VoiceSessionController` and existing composer/task controls.
- Produces: accessible Start Voice, End Call, mute, interruption, live transcript, waveform, permission recovery, fallback controls, and paired `POST /api/audio/transcribe` with bounded multipart audio.

- [ ] **Step 1: Write failing UI tests for Start Voice, End Call, listening/speaking states, mute, barge-in display, typed input during call, Stop Task distinction, denial recovery, and realtime fallback.**
- [ ] **Step 2: Write failing fallback tests for MIME selection, recording stop, track cleanup, transient audio, abort, silence, and transcription failure.**
- [ ] **Step 3: Run component and fallback tests; expect failures.**
- [ ] **Step 4: Implement call controls, transcript, restrained waveform, and state announcements with accessible motion preferences.**
- [ ] **Step 5: Implement paired `POST /api/audio/transcribe` with `@fastify/multipart`, configured upload and duration limits, abortable OpenAI Audio transcription, transient files or buffers, MIME validation, and sanitized errors.**
- [ ] **Step 6: Implement push-to-talk against that endpoint with dynamic MIME selection and guaranteed track and object-URL cleanup.**
- [ ] **Step 7: Run server tests, extension tests, type checking, and build; expect success.**
- [ ] **Step 8: Commit with `git commit -m "feat: add conversational voice controls"`.**

### Task 6: Live voice verification

**Files:**
- Create: `tests/browser/voice-fallback.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed text loop and voice implementation.
- Produces: deterministic fallback coverage and a manual live-realtime verification record.

- [ ] **Step 1: Add browser tests for fallback recording UI, task continuity after simulated realtime failure, Stop during voice work, and cleanup on panel close.**
- [ ] **Step 2: Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:browser`; expect all automated checks to pass.**
- [ ] **Step 3: With a real provider key, manually start a call, interrupt Nudge speech, issue the shop request and follow-up, type during the call, stop the task, and end the call; record actual results and latency.**
- [ ] **Step 4: Document microphone recovery and platform-specific Chrome permission steps without claiming untested operating systems were verified.**
- [ ] **Step 5: Commit with `git commit -m "test: verify realtime voice workflow"`.**

