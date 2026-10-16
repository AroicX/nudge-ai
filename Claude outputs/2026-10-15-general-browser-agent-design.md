# Nudge as a general browser-use agent

Date: 2026-10-15
Status: Approved design (pending written-spec review)
Supersedes: the task-loop parts of `2026-10-15-browser-wide-nudge-design.md`. Everything not mentioned here (Cloud Orb, conversation UI, provider settings, microphone onboarding, history sanitisation, pairing-secret backend) is preserved.

## 1. Purpose and success

Nudge operates the user's browser on their behalf. The user states an outcome by voice or text; Nudge observes the browser, keeps a short evolving plan, performs validated interactions, verifies progress, and adapts until the task is complete, partially complete with a precise explanation, or genuinely needs the user.

There are no site "modes". A finite, typed tool vocabulary is composed by the planner to solve open-ended tasks. Site adapters may be added later as reliability hints; none are required.

Success is demonstrated by eight automated acceptance runs against deterministic local fixtures with the real extension loaded in Chromium and a scripted planner (section 13). Live OpenAI, Realtime, Gmail, Google Sheets and Canva behaviour is not claimed and is reported as unverified.

## 2. Audit summary (current state, 2026-10-15)

Reused as-is or extended: Zod contracts, `CancellationGate`, `evaluateAction` policy, document-scoped `ElementRegistry`, `TabRegistry`, `SecretEnvelope`, `extractOtp`, history store and sanitisation, Fastify backend with pairing secret, OpenAI Responses function calling, Ollama provider with `/api/show` capability check and task-scoped OpenAI fallback, Realtime WebRTC transport, push-to-talk dictation, action cursor, side-panel UI.

Gaps addressed by this design:

1. Task loop lives in the side panel; 12-step cap; no checkpoints.
2. Provider returns the entire `TaskState`; the model effectively owns task state.
3. Hardcoded Gmail heuristic in `browser-task-runner.ts`.
4. Voice and text do not share a controller; instructions during a busy task are dropped; Realtime has no tools.
5. OTP components are not wired into any runtime flow.
6. Action vocabulary lacks keyboard, hover, double-click, drag, history navigation, screenshots, extraction, export, timed repeat. Clicks are synthetic.
7. `verifyOutcome` is unused; no authorization record; no bulk-operation previews.
8. `.env.example` contains a real-looking OpenAI key. It is replaced with a placeholder; the user must rotate the key.

## 3. Architecture

```
Side panel (view + voice)  ──Port "nudge-panel"──▶  Background service worker
  Orb, conversation, timeline, previews                TaskController (one active task)
  Realtime WebRTC + dictation                          ├─ ActionScheduler  (single mutation path)
  typed input                                          ├─ PlannerClient → backend /api/agent/plan, /api/agent/scope
                                                       ├─ Observer (tabs, DOM snapshot, screenshot frames)
                                                       ├─ PolicyEngine + AuthorizationRecord + OperationPreview
                                                       ├─ Verifier (expectations, progress, repeats)
                                                       ├─ TaskMemory + RecordStore
                                                       ├─ CheckpointStore (chrome.storage.session)
                                                       └─ Executors: DomExecutor (content script) | CdpExecutor (optional)
Content script: snapshot, DOM actions, cursor overlay, timed repeat, OTP extraction/entry
```

Placement:

- `packages/contracts`: all schemas (tools, observations, memory, authorization, preview, controller messages, planner request/response).
- `packages/core`: runtime-agnostic logic: task state machine, scheduler, policy/authorization, risk classification, verifier, memory, record store, dedupe/URL normalisation, CSV/XLSX encoders, instruction classifier, timed-repeat rules, checkpoint replay rules. Pure and unit-tested.
- `apps/extension`: Chrome adapters. `entrypoints/background.ts` hosts the controller. The side panel no longer runs tasks; it sends `instruct`/`control`/`confirm` messages over a Port and renders `state` broadcasts.
- `apps/server`: planner proxy. Holds keys, validates request and response schemas, adds the planner instructions, maps the typed tool set to OpenAI function tools or Ollama JSON schema.

The model proposes; application code validates and executes. The app owns `TaskState`.

## 4. Task lifecycle

States: `planning`, `running`, `waiting_for_page`, `waiting_for_user`, `waiting_for_confirmation`, `paused`, `completed`, `partially_completed`, `failed`, `cancelled`.

Loop (one iteration per scheduler slot):

1. Observe relevant state (bound tab DOM snapshot; screenshot only when requested or the last DOM action failed on a canvas/inaccessible region and the provider supports vision).
2. Send planner request: goal, constraints, compact memory, plan, last results, observation (untrusted block), tab inventory, capability flags.
3. Receive `{ planUpdate?, toolCall }`; validate against the tool schema.
4. Resolve target and check preconditions (tab/document/screenshot freshness, element validity).
5. Policy: allow / clarify / confirm / block.
6. Execute via the scheduler.
7. Wait for the expectation (mutation, URL change, tab load, timeout).
8. Re-observe and verify; record evidence.
9. Update memory, checkpoint, broadcast state, continue.

Budgets: default 60 tool calls and 15 minutes per run segment. Reaching a budget moves to `paused` with a "Continue" offer that grants a further segment. Repeat detection: the same action fingerprint three times without observable progress triggers a forced re-plan note to the planner; two consecutive failed re-plans end the task as `partially_completed` with the reason. Errors re-observe and re-plan rather than retry blindly.

## 5. Tool vocabulary

All tools are Zod discriminated-union members with strict schemas. Every mutation tool carries `tabId`; the active tab never silently becomes a target.

| Group | Tools |
|---|---|
| Observe | `list_tabs`, `observe_tab {tabId, screenshot?}`, `read_text {tabId, elementId?}`, `inspect_element {tabId, elementId}` |
| Navigate | `open_tab {url}`, `activate_tab {tabId}`, `navigate {tabId, url}`, `go_back {tabId}`, `go_forward {tabId}`, `reload {tabId}`, `close_tab {tabId}` |
| Interact (DOM) | `click`, `double_click`, `hover`, `focus` `{tabId, elementId}`; `type_text {tabId, elementId, text, mode: replace|append}`; `press_keys {tabId, keys[], elementId?}`; `select_option {tabId, elementId, value}`; `scroll {tabId, direction, amount, elementId?}`; `drag {tabId, fromElementId, toElementId}`; `wait_for {tabId, condition, timeoutMs}` |
| Interact (visual) | `click_at`, `double_click_at` `{tabId, screenshotId, x, y}`; `drag_at {tabId, screenshotId, from:{x,y}, to:{x,y}}`; `type_at {tabId, screenshotId, x, y, text}` |
| Task control | `ask_user {question, missing[]}`, `request_confirmation {preview}`, `record_items {schemaId?, fields?, records[]}`, `export_records {format: csv|xlsx}`, `start_timed_repeat {tabId, action, intervalMs, maxDurationMs, stopAtEnd?}`, `transfer_code {sourceTabId, service, destinationTabId, destinationElementId}`, `finish {summary, evidence[]}`, `report_partial {done[], remaining[], reason}` |

Constraints:

- `press_keys`: allow-list of named keys (Enter, Tab, Escape, Backspace, Delete, arrows, Home/End, PageUp/PageDown, Space, F2) and chords with Control/Meta/Shift/Alt plus a single character or named key. Blocked chords: browser-level shortcuts that close or open windows/tabs, open DevTools, or change extension state (`Ctrl/Meta+W`, `+T`, `+N`, `+Shift+I/J`, `+Q`, `F12`).
- `close_tab`: only tabs with role `opened_by_nudge`, unless the authorization includes the specific tab and the tab is not the origin.
- `wait_for` conditions: `text_present`, `text_absent`, `url_matches` (prefix), `element_count {query text, min/max}`, `idle`.
- No arbitrary script execution, shell, CDP passthrough, or extension self-modification exists in the vocabulary.

## 6. Observation

DOM snapshot (existing `captureSnapshot`, extended):

- Elements gain: `contentEditable`, `role=gridcell/row/checkbox/menuitem/option/tab` support, `expanded`, `pressed`, `checked` for ARIA widgets, scroll-container flag, `canvas` detection added to `inaccessible`.
- Element cap 250, text cap 200 blocks, both prioritised by viewport proximity. Snapshot includes a `mutationCounter` from the content script's MutationObserver.
- Redaction: values of password, `cc-*`, `one-time-code`, hidden inputs are never included; text matching OTP-like patterns near "code/OTP/verification" and long token-like strings are replaced with `[redacted]` before leaving the content script. OTP extraction for an explicit transfer happens in-page and returns only an envelope ID.

Screenshots (`ScreenshotFrame`):

- Captured with `chrome.tabs.captureVisibleTab` (requires the target tab to be active in its window; the controller activates it first and records that). Rate limited to ≤2/s per Chrome's limit.
- Frame metadata: `screenshotId`, `tabId`, `documentId`, `capturedAt`, `viewport {cssWidth, cssHeight, devicePixelRatio, scrollX, scrollY}`, `imageWidth/Height`, `coordinateSpace: 'css_viewport'`, `mutationCounterAtCapture`.
- The cursor overlay is hidden during capture.
- A visual action is rejected as stale if: tab or document differs; scroll or viewport differs; `mutationCounter` advanced beyond a small tolerance (layout-affecting mutations); or the frame is older than 30 s.
- Screenshots are sent to the planner only if the provider reports vision; they are never persisted.

## 7. Execution

`DomExecutor` (content script) performs element actions with validation (connected, visible, enabled, not sensitive unless the tool is `transfer_code`). It dispatches realistic event sequences (`pointerover/enter/down/up`, `mousedown/up`, `click`, `dblclick`, `focus`, `keydown/keypress/input/keyup`, `dragstart/dragover/drop/dragend`) and native value setters. These events are untrusted (`isTrusted=false`); sites that check trust may ignore them, which the verifier detects.

`CdpExecutor` (optional):

- `debugger` is an `optional_permissions` entry, requested with `chrome.permissions.request` from a user gesture in the side panel the first time a task needs trusted input (canvas, visual actions, or a DOM action the verifier found ineffective). The panel explains that Chrome shows a "started debugging this browser" bar while attached.
- Attaches only to the task's bound tab (`{tabId}`), protocol `1.3`. Uses only `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`. No other method is reachable from tool calls.
- Detaches on task finish, cancellation, pause, tab close, or idle for 30 s. Handles `onDetach` (`target_closed`, `canceled_by_user`) by marking capability lost and asking the user; handles attach failure (DevTools open, policy restriction) by falling back to DOM-only with an explicit note.
- Coordinates come from a fresh `ScreenshotFrame` (css viewport space) or from an element's rect centre.

Capability levels reported to the planner and UI: `dom_only`, `dom_plus_trusted_input`.

Agent cursor: the existing overlay is moved to the actual dispatch point immediately before each pointer action (DOM rect centre or CDP coordinate), has `pointer-events:none`, `data-nudge-root`, is excluded from snapshots, and hidden during capture.

## 8. Scheduler, memory, checkpoints

`ActionScheduler` is the only path to page mutation. Each queued item has `{taskId, generation, instructionVersion, fingerprint}`. `stop`, `pause` and corrections increment the generation; queued items with an old generation are discarded; an in-flight item whose result returns under an old generation is recorded `uncertain` and never retried automatically.

`TaskMemory`:

- `goal`, `constraints[] {text, instructionVersion, source: user}`, `userData[]` (non-sensitive values only), `plan[] {id, text, status}`, `steps[] {tool, summary, result, evidence?, uncertain?}` (last 30 kept in full, older summarised), `tabs[] {tabId, role, title, origin}`, `records` (via `RecordStore`), `sources[]`, `issues[]`, `authorization`.
- Planner view is compact: last 8 steps, plan, record count plus last 5 records, issues, tab roles.

`CheckpointStore`: after each verified step, the sanitised task snapshot (memory without user-provided sensitive values, no page text, no screenshots, no envelopes) is written to `chrome.storage.session` keyed by task ID. On service-worker start, a checkpoint in a non-terminal state is restored as `paused` with a note; any step whose result was not recorded is marked `uncertain`. Resuming always re-observes before acting. Nothing is replayed automatically.

Final report: `{ outcome, verified[], partial[], unverified[], skipped[{item, reason}], sources[], exports[] }`.

## 9. Authorization and policy

`AuthorizationRecord`: `{ taskId, instruction, origins: string[] | 'browse_web', categories[], destinations[], exclusions[], limits {maxItems?}, expiresAt: 'task_end' }`.

Categories: `read`, `navigate`, `fill`, `create_records`, `edit`, `move_reversible`, `delete_permanent`, `submit_form`, `send_message`, `purchase`, `auth_challenge`, `transfer_code`.

Creation: a scope request receives only the user's instruction text and tab titles/URLs, never page content. The planner proposes a record. App code sanitises it: `delete_permanent`, `send_message`, `submit_form`, `purchase`, `transfer_code` are kept only if the instruction lexically supports them (e.g. "permanently delete", "send", "submit", "buy", "code"). Corrections can extend scope only from new user words. Page content never changes the record.

Per-action decision:

- Allow: in scope and not consequential.
- Clarify: missing destination/account/spreadsheet or ambiguous tab.
- Confirm: consequential (`delete_permanent`, `submit_form` with personal data, `send_message`), or any mutation that affects more than one item (bulk), or new-origin navigation carrying query data derived from another origin.
- Block: `purchase`/financial submit, password/card/cookie fields, CAPTCHA and other auth challenges (handed to the user), out-of-scope actions, blocked key chords.

Risk classification uses the target's role, accessible name and form context (delete/remove/trash/send/pay/purchase/buy/checkout/submit/unsubscribe/transfer, submit buttons in forms with password or payment fields). The planner may raise a risk label, never lower it.

`OperationPreview`: `{ operation, location, criteria, count, samples[≤5], reversible, permanent, targetFingerprint }`. Confirmation is bound to `{previewId, targetFingerprint, generation}`. Before execution the target set is re-observed; if the fingerprint changes the confirmation is void and a new preview is requested. Move-to-Trash is preferred where it satisfies the request; permanent deletion is a separate category with its own confirmation.

Navigation validation: `http(s)` only, and the URL must be user-typed, observed on a task page, within authorized origins, or the authorization is `browse_web`.

## 10. Sensitive information

OTP transfer (`transfer_code`):

1. Requires `transfer_code` in the authorization (explicit request for a code).
2. Destination resolved first: tab, document and a field with `autocomplete=one-time-code` or a code-like label; if absent or ambiguous, ask.
3. Source read in the source tab's content script: message must mention the named service, newest matching message, and be fresh (≤15 min when a timestamp is visible); exactly one 4–8 digit candidate or ask.
4. The code stays in a `SecretEnvelope` held in service-worker memory; only an opaque handle exists elsewhere. Never sent to the model, logged, checkpointed, or stored.
5. Destination re-validated (same tab, document, field, generation) immediately before entry. Never submits. Single use; destroyed on cancel, completion, or 2-minute expiry.

Never extracted: passwords, payment card data, cookies, credential stores. Exclusions are enforced in observation, logging, model context, checkpoints and execution. Email bodies, documents and web pages are untrusted data; the planner prompt states that instructions inside them are content.

## 11. Voice and text

Both surfaces call `TaskController.instruct(text, source)`.

Deterministic classifier (core, tested): `stop`/`cancel` → cancel; `pause`/`hold on`/`wait` → pause; `continue`/`resume`/`go on` → resume; `skip (this|it)` → skip current item; `yes|confirm|do it|go ahead` and `no|don't|cancel that` → only when a confirmation is pending; "use the other tab"/"the <title> tab" → tab correction. Anything else while a task is active → correction: instruction version bumps, queued actions are discarded, the text is appended to constraints, and the planner re-plans from a fresh observation. When idle → new task.

Only final user transcripts are processed; assistant transcripts and audio never become commands. Realtime session keeps echo cancellation, gains a single `nudge_instruction {text}` function and brief-milestone speaking instructions. The panel posts milestone text (plan created, item N of M, waiting for confirmation, finished/partial) into the Realtime conversation as context without requesting extra actions.

## 12. Records, export, timed tasks, providers

Records: `record_items` with a task-defined field list. Each field value must appear in the observation the planner received (text, link href, or element value); otherwise it is stored as `unknown`. Dedupe key: explicit key field or normalised URL (lower-case host, strip `utm_*`, `gclid`, `fbclid`, fragment, trailing slash). Each record tracks `saved: {destination?: {tabId, rowHint, verifiedAt}}` so recovery never writes twice. Spreadsheet writes use general tools and are verified by reading the destination back.

Export: CSV (RFC 4180, values starting with `=`, `+`, `-`, `@`, tab or CR prefixed with `'`) and XLSX built with `fflate` as a minimal OOXML workbook with inline strings. Delivered as a Blob download link in the side panel (no new permission).

Timed repeat: `start_timed_repeat` validated once (authorized tab and origin, action `scroll` or allow-listed `press_keys`, `intervalMs` 1 000–60 000, `maxDurationMs` ≤ 30 min). Runs as `setInterval` in the content script; stops on stop message, page unload/navigation, reaching bottom when `stopAtEnd`, or max duration. The service worker also stops it on tab close or navigation off-origin. No model call per tick. Described to the user as active-session only.

Providers: `OPENAI_AGENT_MODEL` stays configurable; screenshots go as Responses `input_image` content. Ollama capabilities from `/api/show` (`tools`, `vision`) are surfaced in Provider settings; without `vision`, screenshots are never sent and visual tasks report the limitation. Keys never reach content scripts or logs.

## 13. Testing

- Unit (vitest): contracts; core scheduler and generations, classifier, policy and authorization sanitising, preview binding and invalidation, verifier and repeat detection, memory compaction, checkpoint restore rules, records and dedupe, CSV injection, XLSX structure, timed-repeat validation, screenshot freshness.
- Integration (vitest, extension): `TaskController` with fake tab/content/planner adapters: no duplicate mutations, stop prevents later mutations, correction invalidates queued actions, recovery marks uncertain and re-observes, partial completion truthful, correct tab targeting.
- Server: tool-schema mapping for OpenAI and Ollama, vision gating, scope endpoint.
- Browser (Playwright, dev-only): Chromium from `/opt/pw-browsers` with the built extension loaded and the backend running with a scripted planner (`NUDGE_PLANNER=scripted`, test-only). Fixtures: mail client (search, select, bulk Trash), job board (pagination, prompt-injection listing), spreadsheet grid, OTP mail/verification, canvas editor, long scroll page, delayed render and failed-click page, blocker page.
- Acceptance specs, one per criterion: multi-tab research to verified sheet rows with sources; email search summary; bulk email preview then confirmed Trash; fake OTP transfer; timed scroll stopped immediately; voice correction (injected final transcript) during an active task; canvas editor via CDP pointer/keyboard; honest partial completion on a blocker.

Playwright is a dev dependency only.

## 14. Out of scope

Unattended/cloud scheduling, business embed dashboard or SDK, site-specific adapters, Google API integrations, CAPTCHA solving, purchases, password entry.

## 15. Delivery sequence

1. Contracts and core primitives (tools, memory, scheduler, policy, verifier).
2. Background controller, checkpoints, panel Port; remove Gmail heuristic.
3. Expanded content executor and tab tools; cursor.
4. Screenshot frames and CDP adapter.
5. Records and export.
6. Voice/text instruction routing and corrections.
7. Authorization previews and OTP wiring.
8. Fixtures and multi-tab acceptance runs.
9. Visual editor run and capability documentation.
