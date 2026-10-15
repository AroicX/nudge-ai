# Browser-wide Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nudge a persistent, browser-wide assistant with linked history, reliable microphone onboarding, OpenAI/Ollama switching, observable action timelines, and an explicit cross-tab OTP-transfer workflow.

**Architecture:** Keep the side panel as the coordinator, introduce focused tab/history/provider/secret-transfer modules, and preserve the existing page adapter and independent action policy. The Fastify backend selects a validated OpenAI or Ollama decision provider; the extension owns Chrome tabs, durable UI state, and short-lived sensitive transfers.

**Tech Stack:** TypeScript, React, WXT Manifest V3, Zustand, Zod, Fastify, OpenAI SDK, Ollama HTTP API, Nexus UI, Chrome Tabs/Storage/Permissions APIs, Vitest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-browser-wide-nudge-design.md`

## Global Constraints

- Never persist or log OTPs, passwords, passkeys, recovery codes, payment data, API keys, raw page snapshots, or full email bodies.
- Never send an OTP to OpenAI or Ollama when deterministic extraction can complete the transfer.
- Never fall back from Ollama to OpenAI without task-scoped user approval.
- Only operate ordinary HTTP/HTTPS tabs with granted host access; exclude restricted pages and incognito unless separately enabled.
- Every browser mutation remains bound to an exact tab ID, document ID, and cancellation generation.
- General `type_text` remains blocked for password, one-time-code, and payment fields.
- Nexus Chain of Thought renders trusted action events and verification evidence, never hidden model reasoning.
- Full Realtime voice is OpenAI-only; dictation remains an independent composer capability.
- Do not download an Ollama model automatically.
- Preserve all unrelated user changes in the dirty worktree.

## Review Focus

- A stored source points to a closed or reused tab: reopen the safe HTTP/HTTPS URL only after a user click and never address the reused tab silently (Task 4 tests).
- Chrome reports a stale microphone setup marker after permission is revoked: runtime capture must detect revocation and return to setup-required state (Task 3 tests).
- Ollama returns syntactically valid JSON that violates Nudge contracts: reject it, stop the task, and offer approved OpenAI fallback without executing an action (Task 7 tests).
- The user changes or closes the OTP destination while Gmail is being searched: destroy the envelope and paste nothing (Task 11 tests).
- History reaches storage quota or contains an oversized source URL/title: sanitize, bound, and prune oldest records without breaking current conversation state (Task 5 tests).

---

### Task 1: Stabilize and commit the current UI and Realtime corrections

**Files:**
- Modify: `apps/extension/src/components/Composer.tsx`
- Modify: `apps/extension/src/components/ProviderSettings.tsx`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`
- Modify: `apps/extension/src/styles/app.css`
- Modify: `apps/server/src/routes/realtime-session.ts`
- Modify: `apps/server/src/routes/realtime-session.test.ts`
- Modify: `apps/extension/src/content/snapshot.ts`
- Modify: `apps/extension/src/content/page-adapter.test.ts`
- Modify: `apps/server/src/providers/openai-provider.ts`

**Interfaces:**
- Consumes: existing `VoiceSessionState`, session-key routes, and page snapshot contracts.
- Produces: compact `Composer`, modal `ProviderSettings`, redacted password focus targets, and valid OpenAI Realtime session requests using `session.audio.output.voice`.

- [ ] **Step 1: Review the existing uncommitted diff against the approved spec**

Confirm the composer is single-line, settings is modal, action accordion is absent, copy controls exist, password values remain excluded, and Realtime uses `audio.output.voice`.

- [ ] **Step 2: Run the focused regression tests**

Run: `pnpm --filter @nudge/extension test -- SidePanel.test.tsx page-adapter.test.ts && pnpm --filter @nudge/server test -- realtime-session.test.ts`

Expected: all selected tests pass.

- [ ] **Step 3: Run type checking and lint**

Run: `pnpm typecheck && pnpm lint`

Expected: exit 0.

- [ ] **Step 4: Commit the current correction set**

```bash
git add apps/extension/src/components apps/extension/src/content apps/extension/src/styles/app.css apps/server/src/providers
git add apps/server/src/routes/realtime-session.ts apps/server/src/routes/realtime-session.test.ts
git commit -m "fix: repair voice and compact side panel controls"
```

### Task 2: Add shared source, timeline, provider, and tab contracts

**Files:**
- Create: `packages/contracts/src/browser-context.ts`
- Create: `packages/contracts/src/history.ts`
- Create: `packages/contracts/src/provider-settings.ts`
- Modify: `packages/contracts/src/provider.ts`
- Modify: `packages/contracts/src/task.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Consumes: existing `ConversationTurnSchema`, `TaskStateSchema`, `AgentDecisionSchema`.
- Produces: `TabReference`, `SourceReference`, `TimelineStep`, `PersistedConversation`, `ProviderSelection`, `ProviderCapabilities`, `BrowserContext`, and `SwitchTabDecision` schemas and inferred types.

- [ ] **Step 1: Write failing contract tests**

Add tests that assert:

- source URLs accept only HTTP/HTTPS and bound title/domain/favicon lengths;
- persisted turns reject keys named `otp`, `password`, `apiKey`, or raw snapshots;
- timeline status is exactly `pending | active | completed | error`;
- provider is exactly `openai | ollama`;
- browser context contains bounded eligible tabs and an optional origin tab;
- a switch-tab decision references an inventory tab ID rather than an arbitrary URL.

- [ ] **Step 2: Run the contract tests and verify failure**

Run: `pnpm --filter @nudge/contracts test`

Expected: FAIL because the new exports and schemas do not exist.

- [ ] **Step 3: Implement the schemas and types**

Use strict Zod objects. Bound tab inventories to 100, sources per turn to 10, timeline steps per task to 100, title to 500 characters, and URL to 2,000 characters.

- [ ] **Step 4: Run contract tests**

Run: `pnpm --filter @nudge/contracts test && pnpm --filter @nudge/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat: add browser-wide task contracts"
```

### Task 3: Build durable microphone onboarding and capability separation

**Files:**
- Create: `apps/extension/entrypoints/microphone/index.html`
- Create: `apps/extension/entrypoints/microphone/main.tsx`
- Create: `apps/extension/src/permissions/microphone.ts`
- Create: `apps/extension/src/permissions/microphone.test.ts`
- Modify: `apps/extension/src/components/Composer.tsx`
- Modify: `apps/extension/src/components/ProviderSettings.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`
- Modify: `apps/extension/entrypoints/sidepanel/main.tsx`
- Modify: `apps/extension/src/styles/app.css`

**Interfaces:**
- Consumes: `navigator.mediaDevices.getUserMedia`, `browser.runtime.getURL`, `browser.tabs.create`, and selected provider capabilities from Task 2.
- Produces: `probeMicrophone(): Promise<'granted' | 'denied' | 'dismissed' | 'unavailable'>`, `openMicrophoneSetup(): Promise<void>`, and `Composer({draft, onDraftChange, onDictate})` behavior that inserts transcripts without submitting.

- [ ] **Step 1: Write failing microphone-state tests**

Test granted capture stops every track; `NotAllowedError` distinguishes denied from dismissed where browser state permits; stale stored setup still performs a runtime probe; unavailable media devices return `unavailable`; a completed dictation replaces the composer draft and does not call `onSend`.

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm --filter @nudge/extension test -- microphone.test.ts`

Expected: FAIL because the permission module does not exist.

- [ ] **Step 3: Implement the permission module and onboarding page**

The page requests microphone access only from its explicit button, verifies a live audio track, stops it, stores `microphoneSetupCompleted: true`, and offers a return-to-Nudge action.

- [ ] **Step 4: Update composer and settings capability rules**

Dictation button is always present when microphone APIs exist. Refactor the composer to accept a controlled draft so the existing push-to-talk transcription writes text into the input for review and never submits automatically. Realtime call controls render only when `provider === 'openai' && capabilities.realtimeVoice`. Permission failures link to setup rather than repeatedly calling `getUserMedia` from the side panel.

- [ ] **Step 5: Run component and permission tests**

Run: `pnpm --filter @nudge/extension test -- microphone.test.ts SidePanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/entrypoints/microphone apps/extension/src/permissions apps/extension/src/components apps/extension/entrypoints/sidepanel/main.tsx apps/extension/src/styles/app.css
git commit -m "feat: add reliable microphone onboarding"
```

### Task 4: Add a safe Chrome tab registry

**Files:**
- Create: `apps/extension/src/tabs/tab-registry.ts`
- Create: `apps/extension/src/tabs/tab-registry.test.ts`
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/wxt.config.test.ts`

**Interfaces:**
- Consumes: `browser.tabs.query`, `browser.tabs.update`, `browser.tabs.create`, `browser.tabs.onRemoved`, and `TabReference` from Task 2.
- Produces: `TabRegistry.list(): Promise<TabReference[]>`, `activate(tabId: number): Promise<TabReference>`, `open(url: string): Promise<TabReference>`, `resolveSource(source: SourceReference): Promise<{kind:'existing'|'open'; tab?:TabReference; url:string}>`.

- [ ] **Step 1: Write failing registry tests**

Cover HTTP/HTTPS filtering, incognito exclusion, title/URL/favicon mapping, closed tabs, discarded tabs, a reused tab ID with a different URL, current-window activation, and safe source reopening.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- tab-registry.test.ts wxt.config.test.ts`

Expected: FAIL because the registry and required `tabs` permission do not exist.

- [ ] **Step 3: Implement registry and manifest permission**

Add `tabs` to manifest permissions. Reject non-HTTP(S) URLs before `tabs.create` or source resolution.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nudge/extension test -- tab-registry.test.ts wxt.config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/tabs apps/extension/wxt.config.ts apps/extension/wxt.config.test.ts
git commit -m "feat: add safe browser tab registry"
```

### Task 5: Persist bounded linked conversation history

**Files:**
- Create: `apps/extension/src/history/history-store.ts`
- Create: `apps/extension/src/history/history-store.test.ts`
- Modify: `apps/extension/src/state/use-nudge-store.ts`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`
- Modify: `apps/extension/src/styles/app.css`

**Interfaces:**
- Consumes: `PersistedConversation`, `SourceReference`, Chrome storage, and `TabRegistry.resolveSource`.
- Produces: `loadHistory(): Promise<PersistedConversation>`, `saveHistory(value): Promise<void>`, `clearHistory(): Promise<void>`, and source chips beneath turns.

- [ ] **Step 1: Write failing persistence tests**

Test restart restoration, source serialization, malicious/non-HTTP URL rejection, oversized title/URL truncation, quota-error pruning of oldest turns, clear behavior, and a deep scan proving forbidden sensitive keys/values are absent.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- history-store.test.ts SidePanel.test.tsx`

Expected: FAIL because persistence and source chips do not exist.

- [ ] **Step 3: Implement bounded history storage**

Store at most 200 turns and 1 MiB serialized data. On overflow, remove oldest completed task groups before retrying once. Do not persist active raw task snapshots.

- [ ] **Step 4: Hydrate Zustand and render source chips**

Add `hydrateHistory`, `addTurn` persistence, async clear, and source-click callback. Show favicon, domain, and title with accessible link labels.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @nudge/extension test -- history-store.test.ts SidePanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/history apps/extension/src/state apps/extension/src/components apps/extension/src/styles/app.css
git commit -m "feat: persist linked conversation history"
```

### Task 6: Replace generic working status with Nexus execution timelines

**Files:**
- Create: `apps/extension/components/nexus-ui/chain-of-thought.tsx`
- Create: `apps/extension/src/components/ExecutionTimeline.tsx`
- Create: `apps/extension/src/components/ExecutionTimeline.test.tsx`
- Create: `apps/extension/src/lib/use-on-change.ts`
- Modify: `apps/extension/src/state/use-nudge-store.ts`
- Modify: `apps/extension/src/orchestration/run-task.ts`
- Modify: `apps/extension/src/orchestration/run-task.test.ts`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `TimelineStep` from Task 2 and trusted orchestrator events.
- Produces: `onTimelineStep(step: TimelineStep): void` dependency in `runTask` and `ExecutionTimeline({steps})`.

- [ ] **Step 1: Add Nexus component dependencies using its documented pnpm installation path**

Install only the required Collapsible, Hugeicons, and shimmer dependencies; preserve current React/Tailwind compatibility.

- [ ] **Step 2: Write failing timeline tests**

Assert pending→active→completed/error transitions, completed auto-collapse, error expansion, accessible live status, safe source output, and absence of fields named reasoning/thoughts.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- ExecutionTimeline.test.tsx run-task.test.ts`

Expected: FAIL because timeline events are not emitted or rendered.

- [ ] **Step 4: Add trusted orchestration events and Nexus rendering**

Create labels from deterministic orchestrator state and action results, not provider chain-of-thought text.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @nudge/extension test -- ExecutionTimeline.test.tsx run-task.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/components apps/extension/src apps/extension/package.json pnpm-lock.yaml
git commit -m "feat: show verified action timelines"
```

### Task 7: Add provider settings, Ollama discovery, and validated Ollama decisions

**Files:**
- Create: `apps/server/src/providers/ollama-provider.ts`
- Create: `apps/server/src/providers/ollama-provider.test.ts`
- Create: `apps/server/src/providers/provider-router.ts`
- Create: `apps/server/src/providers/provider-router.test.ts`
- Create: `apps/server/src/routes/provider-health.ts`
- Create: `apps/server/src/routes/provider-health.test.ts`
- Modify: `apps/server/src/providers/decision-provider.ts`
- Modify: `apps/server/src/routes/provider-settings.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/config.ts`
- Modify: `apps/extension/src/api/server-client.ts`
- Modify: `apps/extension/src/components/ProviderSettings.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`

**Interfaces:**
- Consumes: Task 2 provider contracts and existing `DecisionProvider.step`.
- Produces: `OllamaDecisionProvider`, `ProviderRouter.create(selection)`, `GET /api/providers/health`, `PUT /api/settings/provider`, and extension methods `getProviderHealth()` and `setProviderSelection()`.

- [ ] **Step 1: Write failing server tests**

Cover local tags discovery, no-model state, unreachable server, valid structured decision, malformed JSON, contract-invalid JSON, model without tools, URL restricted to loopback by default, and request cancellation.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/server test -- ollama-provider.test.ts provider-router.test.ts provider-health.test.ts`

Expected: FAIL because the provider modules and routes do not exist.

- [ ] **Step 3: Implement Ollama provider and router**

Use native `fetch` to `/api/tags`, `/api/show`, and `/api/chat`; use `stream: false`, a JSON schema matching `AgentStepResponseSchema`, and final Zod validation. Do not add an SDK unless native HTTP proves insufficient.

- [ ] **Step 4: Implement provider routes and settings UI**

Remember provider, Ollama URL, and model in extension storage. Keep OpenAI session key only in backend memory. Display empty-model guidance and a manual refresh button.

- [ ] **Step 5: Run server and component tests**

Run: `pnpm --filter @nudge/server test && pnpm --filter @nudge/extension test -- SidePanel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server apps/extension/src/api apps/extension/src/components
git commit -m "feat: add local Ollama provider selection"
```

### Task 8: Add explicit task-scoped OpenAI fallback approval

**Files:**
- Create: `apps/extension/src/orchestration/provider-fallback.ts`
- Create: `apps/extension/src/orchestration/provider-fallback.test.ts`
- Modify: `apps/extension/src/orchestration/run-task.ts`
- Modify: `apps/extension/src/orchestration/run-task.test.ts`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`

**Interfaces:**
- Consumes: provider capability errors from Task 7.
- Produces: `ProviderFallbackRequest { taskId, from:'ollama', to:'openai', reason, expiresAt }` and `approveFallback(requestId): void` scoped to one task run.

- [ ] **Step 1: Write failing approval tests**

Assert Ollama failure executes zero browser actions and zero OpenAI calls; approval retries only the current step with OpenAI; decline stops; expired approval cannot be reused; a new task requires new approval.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- provider-fallback.test.ts run-task.test.ts SidePanel.test.tsx`

Expected: FAIL because fallback requests do not exist.

- [ ] **Step 3: Implement the task-scoped approval state machine and UI**

Render “Use OpenAI for this task” and “Stop” actions inside the error timeline step. Do not mutate remembered provider selection.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @nudge/extension test -- provider-fallback.test.ts run-task.test.ts SidePanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/orchestration apps/extension/src/components
git commit -m "feat: require approval for OpenAI fallback"
```

### Task 9: Extend orchestration across tabs

**Files:**
- Create: `apps/extension/src/orchestration/browser-task-runner.ts`
- Create: `apps/extension/src/orchestration/browser-task-runner.test.ts`
- Modify: `apps/extension/src/orchestration/run-task.ts`
- Modify: `apps/extension/entrypoints/sidepanel/main.tsx`
- Modify: `apps/server/src/providers/openai-provider.ts`
- Modify: `apps/server/src/providers/ollama-provider.ts`

**Interfaces:**
- Consumes: `TabRegistry`, `BrowserContext`, existing per-tab `runTask`, and page messaging.
- Produces: `runBrowserTask(input, {tabs, observeTab, executeOnTab, step, ...}): TaskRunHandle` with explicit switch, open, and return decisions.

- [ ] **Step 1: Write failing orchestration tests**

Cover reuse of an existing Gmail tab, explicit opening when none exists, re-observation after every switch, return to origin, closed target, navigation changing document identity, cancellation during switch, and restricted page rejection.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- browser-task-runner.test.ts run-task.test.ts`

Expected: FAIL because browser-wide orchestration does not exist.

- [ ] **Step 3: Implement browser task runner**

Keep one active mutation at a time. Clear element IDs on every switch. Reuse `sendToPage(tabId, message)` with injection fallback only after the target tab is ready.

- [ ] **Step 4: Extend provider instructions with supplied tab inventory**

Providers may choose only supplied tab IDs. They cannot invent URLs or report a switch complete without a fresh target observation.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @nudge/extension test -- browser-task-runner.test.ts run-task.test.ts && pnpm --filter @nudge/server test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/orchestration apps/extension/entrypoints/sidepanel/main.tsx apps/server/src/providers
git commit -m "feat: orchestrate tasks across browser tabs"
```

### Task 10: Attach verified page sources to messages and timelines

**Files:**
- Modify: `apps/extension/src/orchestration/browser-task-runner.ts`
- Modify: `apps/extension/src/history/history-store.ts`
- Modify: `apps/extension/src/state/use-nudge-store.ts`
- Modify: `apps/extension/src/components/SidePanel.tsx`
- Modify: `apps/extension/src/components/ExecutionTimeline.tsx`
- Modify: `apps/extension/src/components/SidePanel.test.tsx`

**Interfaces:**
- Consumes: fresh tab/page observations and Task 5 source chips.
- Produces: assistant turns and completed timeline steps with deduplicated `SourceReference[]`.

- [ ] **Step 1: Write failing source-attribution tests**

Assert only visited, freshly observed pages attach; duplicates collapse by normalized URL; source clicks reuse matching tabs; stale tab IDs open the stored safe URL; user messages retain their originating page.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/extension test -- SidePanel.test.tsx browser-task-runner.test.ts history-store.test.ts`

Expected: FAIL because orchestrator results do not carry sources.

- [ ] **Step 3: Implement source collection and rendering**

Never attach restricted URLs or raw query parameters explicitly marked sensitive by the page workflow.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @nudge/extension test`

Expected: PASS.

```bash
git add apps/extension/src
git commit -m "feat: link chat history to browser sources"
```

### Task 11: Add one-use cross-tab OTP transfer

**Files:**
- Modify: `packages/contracts/src/action.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `packages/core/src/policy/otp-transfer.ts`
- Create: `packages/core/src/policy/otp-transfer.test.ts`
- Modify: `packages/core/src/policy/evaluate-action.ts`
- Modify: `packages/core/src/policy/evaluate-action.test.ts`
- Create: `apps/extension/src/security/secret-envelope.ts`
- Create: `apps/extension/src/security/secret-envelope.test.ts`
- Create: `apps/extension/src/content/otp-extractor.ts`
- Create: `apps/extension/src/content/otp-extractor.test.ts`
- Modify: `apps/extension/src/content/executor.ts`
- Modify: `apps/extension/src/content/executor.test.ts`
- Modify: `apps/extension/src/orchestration/browser-task-runner.ts`
- Modify: `apps/extension/src/orchestration/browser-task-runner.test.ts`

**Interfaces:**
- Consumes: explicit OTP intent, source/destination tab contexts, and redacted OTP field metadata.
- Produces: a separate `SensitiveTransferActionSchema` that is never added to `BrowserActionSchema` or provider tools; `SecretEnvelope.create/readOnce/destroy`; deterministic `extractOtp({text, service, now})`; and `executeOtpTransfer(target, envelope, guard)`.

- [ ] **Step 1: Write failing security tests**

Cover 4–8 digit candidate extraction, recency/context matching, ambiguous candidates, one-use read, 2-minute expiry, cancellation, destination tab/document mismatch, navigation during transfer, no clipboard use, no serialization, no provider payload inclusion, and no final form submission.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @nudge/core test -- otp-transfer.test.ts evaluate-action.test.ts && pnpm --filter @nudge/extension test -- secret-envelope.test.ts otp-extractor.test.ts browser-task-runner.test.ts executor.test.ts`

Expected: FAIL because the sensitive-transfer boundary does not exist.

- [ ] **Step 3: Implement local OTP extraction and envelope**

Keep the secret in a private closure, expose no JSON representation, zero the reference on read/expiry/destroy, and bind it to task, destination tab, document, field ID, and cancellation generation.

- [ ] **Step 4: Implement dedicated OTP field execution**

Keep `SensitiveTransferActionSchema` outside the provider-visible `BrowserActionSchema`. Construct it only in the trusted coordinator after envelope validation. Use the native input setter and events, but verify only accepted length/completion. Do not return the value in `ActionResult` or subsequent snapshots.

- [ ] **Step 5: Integrate explicit OTP workflow into browser task runner**

The provider plans navigation and message discovery but never receives the extracted code. Ambiguity asks the user rather than guessing.

- [ ] **Step 6: Run all security tests**

Run: `pnpm --filter @nudge/contracts test && pnpm --filter @nudge/core test && pnpm --filter @nudge/extension test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/core apps/extension/src/security apps/extension/src/content apps/extension/src/orchestration
git commit -m "feat: add ephemeral cross-tab OTP transfer"
```

### Task 12: Add Chrome fixtures and end-to-end verification

**Files:**
- Create: `apps/fixtures/src/pages/mail.tsx`
- Create: `apps/fixtures/src/pages/verification.tsx`
- Create: `tests/browser-wide-task.spec.ts`
- Create: `tests/provider-switching.spec.ts`
- Create: `tests/microphone-onboarding.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: repeatable local multi-tab, provider, persistence, and OTP verification flows.

- [ ] **Step 1: Create Gmail-like and verification fixtures**

The mail fixture has deterministic Netflix-like messages and timestamps. The verification fixture exposes an OTP input and explicit submit button while recording input and submission separately.

- [ ] **Step 2: Write browser tests**

Cover tab reuse/opening, linked sources, timeline steps, restart history restoration, Ollama no-model state, declined and approved OpenAI fallback, OTP paste without submission, and secret absence from extension storage.

- [ ] **Step 3: Run browser tests and fix only evidenced failures**

Run: `pnpm test:browser`

Expected: PASS.

- [ ] **Step 4: Run the complete verification suite**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:browser && git diff --check`

Expected: every command exits 0.

- [ ] **Step 5: Perform manual Chrome checks**

Reload the unpacked build and verify microphone onboarding, provider/model persistence, Ollama empty state, OpenAI Realtime, cross-tab source chips, Gmail-like lookup, OTP paste, narrow composer layout, and clear history.

- [ ] **Step 6: Update setup documentation and commit**

Document Ollama server/model setup, microphone onboarding, provider fallback semantics, tabs permission, history retention, and sensitive-data exclusions.

```bash
git add apps/fixtures tests README.md .env.example
git commit -m "test: verify browser-wide nudge workflows"
```

### Task 13: Final review and branch handoff

**Files:**
- Review: all files changed since commit `5c75496`

**Interfaces:**
- Consumes: Tasks 1–12.
- Produces: a review-ready branch with verified artifacts and no uncommitted implementation changes.

- [ ] **Step 1: Review security invariants against the spec**

Inspect all logging, persistence, provider requests, action results, and timeline serialization for forbidden sensitive values.

- [ ] **Step 2: Review browser lifecycle behavior**

Check tab closure, navigation, extension reload, side-panel closure, server outage, Ollama outage, microphone revocation, and task cancellation.

- [ ] **Step 3: Run final fresh verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:browser && git status --short`

Expected: all commands pass; status contains no implementation changes.

- [ ] **Step 4: Request whole-branch code review**

Compare the branch against `5c75496`, prioritizing sensitive-data leakage, accidental OpenAI spending, stale-tab actions, and permission regressions.

- [ ] **Step 5: Address findings, rerun affected tests, and prepare user testing notes**

Testing notes must name the Ollama model actually installed during verification and clearly state that Chrome—not Nudge—owns password autofill and microphone consent.
