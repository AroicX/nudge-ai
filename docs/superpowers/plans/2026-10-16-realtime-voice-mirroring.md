# Realtime Voice Mirroring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Nudge one continuous, interruptible Realtime voice conversation that speaks verified browser-task results and produces stable transcripts.

**Architecture:** The extension owns one WebRTC voice session and sends all voice events through a typed transport. A dedicated coordinator routes strict Realtime browser-tool calls into the existing guarded browser-task runner, then returns the verified outcome to the same Realtime session for speech. Ordinary voice turns remain in Realtime, eliminating the competing text response path.

**Tech Stack:** TypeScript, React, WXT, Fastify, Zod, OpenAI Realtime WebRTC, Vitest, React Testing Library

**Spec:** `docs/superpowers/specs/2026-10-16-realtime-voice-mirroring-design.md`

## Global Constraints

- Standard OpenAI keys remain on the server; the extension receives only short-lived credentials.
- Browser mutations continue through the existing policy, execution, verification, and cancellation path.
- Realtime session configuration uses `gpt-transcribe`, language `en`, near-field noise reduction, semantic VAD with low eagerness, automatic responses, automatic interruption, and the configured `marin` or `cedar` voice.
- Realtime may request only one strict `run_browser_task` tool; parallel browser mutations remain disabled.
- Ollama remains text-only and typed chat must survive every voice failure.
- No raw microphone or assistant audio is persisted.

## Review Focus

- A duplicate `call_id` must return the cached outcome and never execute the browser task twice; covered in Task 4.
- A late WebRTC track after call shutdown must not recreate playback or microphone state; covered in Task 3.
- An assistant transcript completed before playback stops must remain provisional; covered in Task 2.
- A typed message during an active voice call must enter Realtime without launching a competing text response; covered in Task 5.
- A malformed tool argument or unavailable tab must return a spoken-safe failure and execute no page action; covered in Task 4.

---

### Task 1: Realtime contracts and transport commands

**Files:**
- Modify: `packages/contracts/src/voice.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/core/src/voice/voice-transport.ts`
- Modify: `packages/core/src/voice/voice-transport.test.ts`

**Interfaces:**
- Produces: `VoiceEvent` function intents with `callId`, `name`, and strict argument records.
- Produces: `VoiceTransport.sendToolResult(callId: string, result: VoiceToolResult): void`.
- Produces: `VoiceTransport.sendText(text: string): void` for typed turns in an active call.

- [ ] **Step 1: Write failing contract tests**

Add tests named `accepts a strict run_browser_task intent` and `rejects malformed tool results`. Assert that a function intent requires a non-empty call ID and that `VoiceToolResultSchema` accepts only `{ ok, message }` plus optional verified source summaries.

- [ ] **Step 2: Run the focused contract tests and verify RED**

Run: `pnpm --filter @nudge/contracts test`

Expected: FAIL because `VoiceToolResultSchema` and `sendToolResult` do not exist.

- [ ] **Step 3: Add the minimal schemas and interface method**

Define `VoiceToolResultSchema`, `VoiceToolResult`, and the new transport method. Keep the result bounded to user-facing verified text and source metadata; do not expose DOM snapshots or internal reasoning.

- [ ] **Step 4: Run contracts and core voice tests and verify GREEN**

Run: `pnpm --filter @nudge/contracts test && pnpm --filter @nudge/core test`

Expected: PASS.

- [ ] **Step 5: Commit the contract boundary**

Commit: `feat(voice): add realtime tool result contracts`

### Task 2: Reconcile Realtime event ordering

**Files:**
- Modify: `apps/extension/src/voice/realtime-events.ts`
- Create: `apps/extension/src/voice/realtime-events.test.ts`
- Create: `apps/extension/src/voice/realtime-transcript.ts`
- Create: `apps/extension/src/voice/realtime-transcript.test.ts`

**Interfaces:**
- Consumes: strict `VoiceEvent` from Task 1.
- Produces: `RealtimeTranscriptReducer.apply(event: VoiceEvent): VoiceTranscriptUpdate[]`.
- Produces: parser events containing provider `itemId` and `responseId` when supplied.

- [ ] **Step 1: Write failing parser and transcript tests**

Cover input transcription completion, assistant transcript delta/done, output playback start/stop, interruption clearing, late final transcripts, and duplicate event IDs. Assert that assistant text is committed only after matching output playback stops and interrupted output becomes `Reply interrupted`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --filter @nudge/extension test -- realtime-events realtime-transcript`

Expected: FAIL because provider IDs and transcript reconciliation are missing.

- [ ] **Step 3: Implement event metadata parsing and the reducer**

Add provider IDs without loosening schema validation. Keep bounded duplicate bookkeeping and never infer which unplayed words were heard.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm --filter @nudge/extension test -- realtime-events realtime-transcript`

Expected: PASS.

- [ ] **Step 5: Commit transcript reconciliation**

Commit: `fix(voice): reconcile realtime transcripts and interruptions`

### Task 3: Stable microphone capture and remote playback

**Files:**
- Modify: `apps/extension/src/voice/realtime-transport.ts`
- Modify: `apps/extension/src/voice/realtime-transport.test.ts`

**Interfaces:**
- Consumes: `VoiceTransport.sendToolResult` from Task 1.
- Produces: WebRTC playback that resumes on `output_audio_buffer.started`.
- Produces: microphone constraints with echo cancellation, noise suppression, automatic gain control, and mono capture.

- [ ] **Step 1: Write failing transport tests**

Add tests named `resumes remote playback for the next reply`, `uses conversational microphone constraints`, `sends function output then requests speech`, and `ignores a late track after disconnect`. Preserve existing interruption-order assertions: `response.cancel` precedes `output_audio_buffer.clear`.

- [ ] **Step 2: Run the transport tests and verify RED**

Run: `pnpm --filter @nudge/extension test -- realtime-transport`

Expected: FAIL because playback is not resumed, constraints are incomplete, tool output is unsupported, and late tracks are not guarded.

- [ ] **Step 3: Implement the minimal lifecycle changes**

Set `autoplay` and `playsInline`, attach the remote stream once, call `play()` on both track arrival and assistant playback start, and guard callbacks with a connection epoch. Implement `sendToolResult` as `conversation.item.create` with `function_call_output`, followed by `response.create`.

- [ ] **Step 4: Run the transport tests and verify GREEN**

Run: `pnpm --filter @nudge/extension test -- realtime-transport`

Expected: PASS with no unhandled playback rejection.

- [ ] **Step 5: Commit the browser audio lifecycle**

Commit: `fix(voice): stabilize realtime capture and playback`

### Task 4: Mirror Atlast session configuration and browser-tool bridge

**Files:**
- Modify: `apps/server/src/routes/realtime-session.ts`
- Modify: `apps/server/src/routes/realtime-session.test.ts`
- Replace: `apps/extension/src/voice/voice-task-bridge.ts`
- Modify: `apps/extension/src/voice/voice-task-bridge.test.ts`

**Interfaces:**
- Consumes: `VoiceToolResult` and `VoiceTransport.sendToolResult` from Task 1.
- Produces: `createVoiceTaskBridge({ runBrowserTask, returnResult, stopTask })` with call-ID deduplication.
- Produces: one strict provider tool named `run_browser_task` with `{ goal: string }`.

- [ ] **Step 1: Write failing server configuration tests**

Assert the issued session includes `gpt-transcribe`, `language: "en"`, `{ type: "near_field" }`, semantic VAD with `eagerness: "low"`, `create_response: true`, `interrupt_response: true`, the configured voice, and the strict `run_browser_task` tool schema.

- [ ] **Step 2: Run the server route test and verify RED**

Run: `pnpm --filter @nudge/server test -- realtime-session`

Expected: FAIL against the current server-VAD configuration.

- [ ] **Step 3: Implement the mirrored Realtime session configuration**

Keep browser-operation claims prohibited until verified tool output returns. Set `tool_choice: "auto"` and a single strict function tool.

- [ ] **Step 4: Run the server route test and verify GREEN**

Run: `pnpm --filter @nudge/server test -- realtime-session`

Expected: PASS.

- [ ] **Step 5: Write failing bridge tests**

Assert one valid intent runs once and returns its result, duplicate call IDs return the cached result, malformed goals return `{ ok: false }`, unavailable tabs execute nothing, and stop requests cancel the active task.

- [ ] **Step 6: Run the bridge tests and verify RED**

Run: `pnpm --filter @nudge/extension test -- voice-task-bridge`

Expected: FAIL because the existing bridge submits every final transcript to the text agent and does not return tool results.

- [ ] **Step 7: Implement the coordinator-style bridge**

Remove generic user-transcript submission. Execute only validated `run_browser_task` function intents, cache their promises by `callId`, bound the cache for the session lifetime, and always return a compact success/failure result.

- [ ] **Step 8: Run bridge tests and verify GREEN**

Run: `pnpm --filter @nudge/extension test -- voice-task-bridge`

Expected: PASS.

- [ ] **Step 9: Commit session and tool bridging**

Commit: `feat(voice): mirror realtime session and browser tools`

### Task 5: Integrate one conversation into the side panel

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/main.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`
- Modify: `apps/extension/src/voice/voice-session-controller.ts`
- Modify: `apps/extension/src/voice/voice-session-controller.test.ts`

**Interfaces:**
- Consumes: transcript reducer from Task 2, stable transport from Task 3, and task bridge from Task 4.
- Produces: one assistant response path for active voice calls.

- [ ] **Step 1: Write failing controller and side-panel integration tests**

Assert that final user voice transcripts add one chat turn without invoking the text runner, tool intents use the guarded task runner, verified task output returns to Realtime, assistant turns commit after playback completion, and typed input during an active call calls `sendText` instead of starting a competing browser-agent response.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --filter @nudge/extension test -- voice-session-controller SidePanel`

Expected: FAIL because the current bridge submits transcripts to `send()` and assistant transcript completion commits too early.

- [ ] **Step 3: Wire the unified voice conversation**

Extract a small `runVoiceBrowserTask(goal, signal)` adapter around the existing `runBrowserTask`; reuse the same tab registry, page observation, executor, policy, status, action timeline, fallback, and Stop handle. Route verified final messages back through `sendToolResult` and let the transcript reducer own chat commitment.

- [ ] **Step 4: Preserve typed and failure behavior**

When voice is active, typed input uses `controller.sendText`; otherwise it uses the existing text agent. Keep Ollama voice hidden, microphone setup unchanged, and every error recoverable through typed chat.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `pnpm --filter @nudge/extension test -- voice-session-controller SidePanel`

Expected: PASS with one reply per turn.

- [ ] **Step 6: Commit side-panel integration**

Commit: `feat(voice): unify realtime speech and browser results`

### Task 6: Full verification and Chrome acceptance

**Files:**
- Modify if required by observed defects: files owned by Tasks 1–5 only.
- Update: `MVP Brief.txt` with the completed conversational voice capability.

**Interfaces:**
- Consumes: completed unified voice architecture.
- Produces: verified unpacked Chrome build.

- [ ] **Step 1: Run all repository checks**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all suites pass with no TypeScript or build errors.

- [ ] **Step 2: Load the production extension and run manual acceptance**

Verify in Chrome: natural multi-clause speech, a pause without premature cutoff, audible reply, interruption, audible reply after interruption, a browser action with a spoken verified result, typed input during the same call, end, and restart.

- [ ] **Step 3: Update the MVP brief**

Document that OpenAI mode supports continuous interruptible voice, spoken verified browser results, and live transcripts; Ollama remains text plus dictation.

- [ ] **Step 4: Run the final diff and scope review**

Confirm no credentials, raw audio, generated build output, unrelated user changes, or Atlast source files are included.

- [ ] **Step 5: Commit verification documentation**

Commit: `docs: record conversational voice support`
