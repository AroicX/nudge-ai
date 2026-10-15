# Nudge MVP Design

## Purpose

Nudge is a consumer Chrome extension that lets a person operate the current website through text or a live, interruptible voice conversation. The first release must be an unpacked Manifest V3 extension that works against general website interfaces, demonstrates a complete observe-decide-act-verify loop on local fixtures, and remains honest about unsupported or unverified outcomes.

The initial release targets current stable Chrome on macOS, Windows, and Linux. It prioritizes a fast local interaction loop, safe browser mutations, clear progress, and a reusable core over broad website compatibility.

## Scope

The MVP includes:

- A Chrome side panel with conversation history, typed input, call-style voice, status, action history, Stop, End Call, and clear-history controls.
- A small Shadow DOM launcher injected after the user grants page access.
- DOM-first page understanding with versioned ephemeral element references.
- Search, navigation, filtering, inspection, scrolling, safe form preparation, and observed-link navigation.
- A deterministic policy layer, exact confirmations, immediate cancellation, and evidence-based completion.
- A loopback Fastify backend for OpenAI calls and secret handling.
- A default developer API key plus a session-only bring-your-own-key option.
- Shop, settings, and fake-financial fixture applications.
- Automated tests and a cross-platform manual verification checklist.

The MVP excludes checkout, financial submission, destructive changes, authentication bypass, credential entry, CAPTCHA solving, cross-tab orchestration, background autonomous work, schedules, the business embed, and any claim of universal compatibility.

Jev is explicitly deferred. The provider boundary will permit a future fast decision provider, but no Jev dependency, configuration, or runtime path will ship in this milestone.

## Architecture

Use a pnpm TypeScript workspace with these major areas:

```text
apps/
  extension/   WXT Manifest V3 extension, side panel, launcher, page adapter
  server/      Loopback Fastify backend and provider integrations
  fixtures/    Shop, settings, and financial development sites
packages/
  contracts/   Zod schemas and shared message/event types
  core/        Intake, task state, orchestration, policy, verification
```

The side panel owns the active orchestration loop. This avoids depending on a long-lived Manifest V3 service worker and keeps the visible UI, cancellation state, voice session, and current task synchronized. The service worker handles short coordination events only. Content scripts perform bounded observation and action requests and never hold provider credentials or own the agent loop.

Chrome-specific behavior is hidden behind a `PageAdapter`. Reusable core modules depend on that interface rather than Chrome APIs. A future website embed can supply a different adapter without replacing intake, task state, planning, policy, verification, or conversation logic.

Provider calls are hidden behind focused interfaces. OpenAI is the only active provider in this MVP. The interfaces leave room for a future low-latency decision provider without introducing another execution path.

## Interaction Flow

For each user turn:

1. The side panel accepts text or a live voice turn.
2. The extension obtains a fresh, bounded page snapshot from the bound tab and document.
3. The backend combines the utterance, relevant conversation, active task state, verified actions, and snapshot into a structured decision.
4. Zod validates the decision.
5. Local policy validates the task generation, tab, frame, document, origin, action type, target, risk, and any confirmation.
6. The content script executes at most one browser mutation.
7. Mutation, navigation, and value signals drive bounded change detection.
8. The extension captures fresh state and verifies the result.
9. The loop continues, asks one concise question, reports uncertainty, or completes with current evidence.

The model never emits executable JavaScript. Actions can only reference currently observed element IDs or observed HTTP(S) destinations.

## Fast Path and Latency Budget

Nudge uses DOM and accessibility information as its default perception layer. Each snapshot is a compact numbered table of task-relevant headings, text, controls, links, form fields, state, and result summaries. Raw HTML and default screenshots are excluded.

The backend returns typed decisions without generating narration for every mechanical step. It may return a short conditional action window, but the extension executes only one mutation at a time. A later planned action may be reused only when its explicit page-state preconditions still match after fresh observation; otherwise Nudge replans.

Local code performs policy, execution, and verification. Screenshots and stronger reasoning are reserved for genuine ambiguity and are prohibited on sensitive workflows.

Target timings on a responsive page and healthy connection are:

| Stage | Target |
| --- | ---: |
| DOM snapshot | under 100 ms |
| Extension messaging and policy | under 50 ms |
| Ordinary browser mutation | under 150 ms |
| Page-change detection | under 800 ms when the site responds promptly |
| Typical provider decision | under 2 seconds |
| Simple one-action request | about 1–3 seconds |
| Typical multi-step search/filter flow | about 3–8 seconds |

These are engineering targets rather than guarantees. Non-sensitive timing spans for snapshot, provider, policy, execution, and verification will make latency regressions visible. The UI provides immediate specific progress and never shows an unexplained long-running spinner.

## Live Voice

Voice is a call-style session rather than push-to-talk by default. The user taps Start Voice once, speaks naturally, hears streamed responses, can interrupt Nudge while it is speaking, and taps End Call to finish.

The browser side-panel document owns the microphone and WebRTC connection. The backend creates a short-lived client credential; the standard API key never enters the extension. The active OpenAI realtime voice architecture must support natural turn detection, streamed audio, function tools, response cancellation, and output-audio truncation.

Voice tools do not execute browser actions directly. They send task intents into the same orchestration, policy, adapter, and verification path used by text. Spoken progress is brief and evidence-based. Repetitive internal steps remain silent.

When the user interrupts:

- Nudge cancels and truncates its current audio immediately.
- New speech becomes the active conversational turn.
- Browser work continues only when the interruption does not cancel or supersede it.
- Saying Stop or pressing Stop invalidates the task generation and prevents later mutations.

Stop Task cancels browser work but may leave the voice call open. End Call stops the voice session, audio playback, microphone tracks, and active browser work. Closing the side panel has the same safe cleanup behavior as End Call.

Text remains available during a call. Push-to-talk transcription remains a fallback when realtime setup, connectivity, or microphone behavior fails.

## State and Cancellation

Zustand owns in-memory UI and active-task state. `chrome.storage.local` stores preferences, conversation history, and minimal recoverable task metadata. Page snapshots, raw audio, sensitive form contents, and provider secrets are not persisted.

Every provider request and browser action carries a task ID and cancellation generation. Before each mutation, the extension verifies that the task remains active and that the tab, document, snapshot, target, and policy decision remain current. Late results from cancelled or superseded generations are ignored. Uncertain mutations are never replayed after reload or disconnection.

Full-page navigation may recover conversational task context, but it must obtain a new document identity and fresh snapshot before continuing. Changing the active tab never silently moves the task to another tab.

## Page Understanding and Execution

The page adapter extracts visible, relevant information using accessible names, labels, roles, element state, geometry, and stable attributes. Each snapshot has a document version and each target receives an ephemeral ID scoped to that version.

The adapter excludes Nudge UI and sensitive inputs. It does not collect passwords, authentication codes, card data, cookies, browser storage, hidden inputs, or unrelated personal information. Page text is untrusted data and cannot redefine system instructions, authorize actions, or grant permissions.

Supported browser mutations are `click`, `type_text`, `select_option`, `scroll`, and `navigate_to_observed_url`. `read_page` and `wait_for_change` are observation tools; `ask_user` and `finish` are control decisions. Target checks reject stale, hidden, disabled, inappropriate, or cross-document elements. Input writes distinguish replace from append, dispatch appropriate native events, and read values back for verification.

## Policy and Truthful Completion

Deterministic code, not model confidence, is the final authority for action safety.

- Ordinary reading, search, filtering, scrolling, and navigation are permitted.
- Non-sensitive forms may be prepared without submission.
- Messages, personal-data submission, and account changes require confirmation bound to the exact action, target, parameters, and page state.
- Purchases, transfers, trades, deletion, and other irreversible submissions are blocked.
- Authentication, passwords, OTPs, and CAPTCHAs are handed to the user.

Completion requires current observable evidence. Nudge distinguishes an applied filter from a claim that every result satisfies it. A no-effect click, stale target, timeout, or inaccessible frame produces uncertainty or recovery rather than a success statement.

## Permissions and Secrets

The initial manifest requests only permissions actually required for the vertical slice, centered on `activeTab`, `scripting`, `sidePanel`, and `storage`. Persistent site access uses optional host permissions requested through a valid user gesture. Nudge never requests every website by default.

The loopback server uses `OPENAI_API_KEY` as the default provider credential. The extension can submit a user's replacement API key to the paired local backend for the current server session. Session keys remain in backend memory only and are cleared on restart. They are never placed in the extension bundle, source control, synced storage, logs, or persisted browser state.

The backend binds to loopback, validates a pairing secret, restricts callers, validates every payload, enforces size and rate limits, and disables sensitive request logging. CORS and Origin checks are defense in depth rather than authentication.

## UI

The side panel contains the Nudge identity, current domain, clear status, conversation, composer, Start Voice or End Call, push-to-talk fallback, Send, persistent Stop Task during execution, mute control, collapsible action history, settings, and clear history.

The compact launcher uses Shadow DOM, avoids duplicate injection, survives SPA route changes, supports drag and dismiss-for-page, and cleans up listeners and observers. It opens the side panel only through supported Chrome user-gesture behavior; otherwise it directs the user to the toolbar action.

The visual style uses readable typography, soft neutral surfaces, one accent color, accessible contrast and focus states, and restrained animation. Call state, listening, speaking, working, confirmation, completion, and failure remain visually distinct.

## Failure and Recovery

Failures are specific and actionable:

- Microphone denial leaves text ready and explains how to restore access.
- Realtime loss preserves the task and offers text or push-to-talk fallback.
- Provider errors do not disable local controls or history.
- Permission failure offers the valid permission gesture again.
- Stale targets trigger fresh observation rather than forced interaction.
- No-progress limits stop repeated actions and explain what was attempted.
- Unsupported frames, shadow roots, canvases, and browser pages are reported honestly.

All external calls and long waits are bounded and abortable. Stop always takes precedence over pending provider or page work.

## Testing and Acceptance

Vitest covers schemas, intake continuity, task transitions, policy, verification, cancellation, stale references, ambiguous references, prompt injection, and blocked financial submission. React Testing Library covers the composer, call states, interruption, typed input during voice, Stop versus End Call, permission denial, confirmations, and history clearing.

Playwright exercises the actual page reader and executor against fixture sites. Required flows include:

- Search for iPhone 16, retain black and 256 GB follow-up constraints, and open a matching result.
- Navigate to profile settings and prepare supplied non-sensitive fields.
- Open a transfer form and block final submission.
- Cancel a multi-step task and prove that queued or late actions do not run.
- Continue safely through a full-page navigation.

Automated tests use deterministic provider fixtures. Live OpenAI text, realtime voice, microphone, permission, side-panel, service-worker, and latency checks are reported separately. The README clearly distinguishes automated verification, live-provider verification, and operating-system checks that remain manual.

## Delivery Sequence

Implementation proceeds as vertical capabilities rather than disconnected scaffolding:

1. Workspace, contracts, core state, policy, and deterministic tests.
2. Loopback backend, pairing, OpenAI provider boundary, default key, and session-only BYOK.
3. Extension side panel, service-worker coordination, permissions, and isolated launcher.
4. DOM snapshot, action executor, change observation, verification, and cancellation.
5. Complete text-driven shop flow with real and deterministic provider modes.
6. Full-duplex realtime voice with interruption and fallback voice transport.
7. Settings and financial fixtures plus remaining acceptance flows.
8. Cross-platform documentation, production build, automated checks, and manual verification report.

The first milestone is complete only when a user can load the unpacked extension, activate it on the shop fixture, start a voice call, request an iPhone 16, refine the request to black and 256 GB, watch verified actions occur quickly, interrupt or stop immediately, and receive a truthful result.
