# Browser-wide Nudge, local providers, and durable permissions

Date: 2026-10-15
Status: Approved design

## Purpose

Extend Nudge from a single-tab OpenAI browser assistant into a browser-wide assistant that can coordinate explicit tasks across ordinary Chrome tabs, retain linked conversation history, use either OpenAI or a local Ollama server, and offer reliable microphone onboarding and dictation.

Success means a user can ask Nudge to find information in one tab and use it in another while seeing a concise, verifiable action timeline. Provider changes must never incur OpenAI usage without approval, and sensitive authentication data must not leak into persistent history, logs, or model context.

This design supersedes the original PRD exclusions for cross-tab orchestration and explicit OTP transfer. It does not permit background autonomy, password extraction, CAPTCHA solving, payment actions, or unrestricted credential access.

## Architectural approach

The Chrome side panel remains the task coordinator. It is already a persistent extension page and can use Chrome extension APIs while the user moves between tabs. A dedicated tab manager will inventory, activate, create, and address tabs. The existing page adapter remains responsible for observing and acting within one document at a time.

The task loop changes from a permanently bound `tabId` to a controlled tab context containing:

- current target tab and document;
- originating tab for return workflows;
- accessible tab metadata;
- visited tab and document revisions;
- explicit cross-tab intent and sensitive-transfer state.

Every page action remains bound to an exact tab, document, and cancellation generation. A tab switch invalidates element references and requires a new observation before further action.

The local Fastify backend gains provider-neutral routing. OpenAI and Ollama implement the same decision-provider contract and return the same Zod-validated task decision. Browser actions still pass through the independent policy and executor; neither provider controls Chrome directly.

## Alternatives considered

### Manifest V3 service-worker coordinator

This could continue tasks after the side panel closes, but service-worker suspension complicates live task state, permissions, voice, and progress streaming. It is deferred until background autonomy becomes an explicit requirement.

### Local desktop browser-control daemon

A daemon using remote debugging would be more powerful, but it would broaden access beyond the extension permission model and introduce unnecessary security risk. It is rejected.

## Tab coordination

Add a tab registry backed by `chrome.tabs` that returns only normal HTTP/HTTPS tabs accessible to the extension. Each entry includes tab ID, window ID, active state, URL, title, domain, favicon URL, discarded state, and last-seen timestamp.

The registry supports:

- listing eligible tabs in the current normal browser profile;
- locating an existing tab by service, title, domain, or URL evidence;
- activating an existing tab;
- opening a new tab only when the task requires it;
- waiting for navigation completion before injection or observation;
- returning to the originating tab;
- detecting closed, discarded, replaced, or inaccessible tabs.

The model does not invent destinations. It may select an existing tab from the supplied inventory or request navigation through an observed URL. Opening a known service home page requires a deterministic allowlisted service resolver or a user-approved URL.

Incognito windows are excluded unless the user separately enables extension access. Chrome-internal pages, browser stores, and other restricted schemes are never treated as ordinary permission failures.

## Cross-tab task flow

For a request such as “Go to Gmail and open the email where Netflix said my payment is about to expire”:

1. Record the current tab as the origin.
2. Inventory eligible tabs.
3. Reuse an existing Gmail tab when possible.
4. If no Gmail tab exists, ask before opening one unless the user explicitly said to go to Gmail.
5. Activate the Gmail tab, wait for readiness, inject the adapter, and observe.
6. Operate Gmail through the visible website interface using the existing action vocabulary and verification loop.
7. Attach the resulting page as a source to the assistant response.
8. Leave the user on the result tab unless the task requires returning elsewhere.

The side panel remains visible across tab switches. Task and conversation state are not reconstructed from the page.

## OTP transfer

OTP transfer is permitted only after an explicit user request that identifies or clearly implies both the source and destination workflow.

The flow is:

1. Record the destination verification tab and its fresh document identity.
2. Locate or open the requested message source, initially Gmail.
3. Find a recent message matching the requested service or verification context.
4. Extract a plausible OTP using deterministic parsing where possible.
5. Store the code in a short-lived in-memory envelope containing source context, destination tab, destination document, creation time, and one-use state.
6. Return to the destination tab and re-observe it.
7. Paste into a matching OTP field through a dedicated sensitive-transfer action.
8. Verify only that the destination accepted the expected length or completion state without reading the value back into a snapshot.
9. Destroy the envelope immediately after success, failure, cancellation, navigation, or timeout.

OTP values must never enter conversation messages, action timelines, page snapshots, model prompts, logs, analytics, clipboard, or `chrome.storage`. Deterministic extraction and transfer should avoid sending the code to either OpenAI or Ollama.

The existing general `type_text` policy continues to block one-time-code fields. Only the dedicated, locally validated OTP-transfer action can fill them. It cannot submit the form. A final “Confirm,” “Sign in,” or equivalent action requires explicit inclusion in the user’s request and remains subject to policy.

Passwords, passkeys, recovery codes, CAPTCHA answers, card data, and browser password-store contents remain inaccessible. Nudge may focus a redacted password field so Chrome Autofill can respond, but it cannot read or type the saved password.

## Conversation and source history

Conversation history persists in `chrome.storage.local` across Chrome restarts. Stored turns include:

- ID, role, text, and timestamp;
- provider and model used;
- zero or more source references containing URL, title, domain, favicon, and last-known tab ID;
- safe task summary and completion state;
- user-visible execution steps and their status.

Sources render as clickable chips beneath messages. Clicking a chip activates the existing tab if it still matches; otherwise it opens the stored HTTP/HTTPS URL in a new tab after user interaction.

History excludes raw snapshots, full email bodies, form values, API keys, OTPs, passwords, payment data, cookies, private model reasoning, and unbounded page content. Retention is bounded by turn count and serialized size. Settings include clear history, and removal clears both persisted and in-memory task history.

## Action feedback UI

Use Nexus UI’s Chain of Thought component as a structured execution timeline, not as a display of hidden model reasoning.

Timeline entries are derived from trusted orchestrator events such as:

- “Checking open tabs”;
- “Opened Gmail”;
- “Searching recent Netflix messages”;
- “Returned to verification page”;
- “Pasted verification code”;
- “Verified the field accepted the code.”

Each step has pending, active, completed, or error status and may include safe source links or verification evidence. Active timelines stay open, completed timelines auto-collapse, and errors remain expanded. Generic “Working” text is replaced by this timeline while the compact status remains available for accessibility announcements.

## Provider architecture

Add a persisted provider configuration:

- selected provider: `openai` or `ollama`;
- selected OpenAI configuration, without persisting API key material in extension storage;
- Ollama base URL, defaulting to `http://127.0.0.1:11434`;
- selected Ollama model;
- last capability check and health state.

The backend exposes provider settings and health endpoints. Ollama model discovery uses its local tags endpoint. The current local server is reachable but has no installed models, so the UI must show an empty state and installation guidance rather than choosing an invented model or downloading one automatically.

The Ollama adapter uses `/api/chat` with a JSON schema or tool calling and validates all results through the existing shared contracts. Capability probing verifies that the chosen model can produce the required structured decision before enabling browser actions.

If Ollama is unavailable or the model cannot perform the required browser tools, Nudge stops before acting, explains the limitation, and offers an explicit “Use OpenAI for this task” approval. Approval is scoped to the current task and does not silently change the remembered default provider. Without approval, no OpenAI request is made.

## Settings experience

The settings modal contains:

- provider selector;
- OpenAI local-default and session-key replacement controls;
- Ollama server URL;
- refreshable installed-model selector;
- model capability labels;
- provider health and error state;
- microphone permission status and setup action;
- remembered-provider behavior;
- clear-history action.

The selected provider and Ollama model survive Chrome restarts. An absent Ollama model is shown as a blocking configuration state.

## Voice and dictation

Voice is separated into two capabilities.

### Realtime conversation

OpenAI Realtime provides the interruptible phone-call experience. Its controls appear only when OpenAI is selected, a usable OpenAI key is configured, and Realtime capability is available. Ollama selection hides the full voice-call control rather than showing a button that cannot work.

### Dictation

Dictation records a short utterance, transcribes it, and places the resulting text into the composer for review. It does not submit automatically. Dictation remains visible independently of full voice-call availability.

For OpenAI, dictation may use the existing backend transcription endpoint. The provider boundary permits a future local transcription engine, but local speech recognition is not part of this implementation unless an installed compatible service is detected and separately approved.

## Microphone permission onboarding

The recurring “permission dismissed/denied” state is caused by requesting microphone access from a side-panel lifecycle where the browser prompt may be dismissed or previously blocked. Chrome does not allow the extension to auto-approve microphone access.

Add a dedicated extension onboarding page opened by a direct user click. It:

1. Explains why microphone access is needed.
2. Calls `getUserMedia` from the extension page.
3. Verifies a real audio track is live.
4. Stops the test stream immediately.
5. Stores only a successful-setup marker.
6. Returns the user to Nudge.

The runtime still checks actual permission by attempting capture because a stored marker can become stale. A denied or dismissed request presents a durable remediation action that opens the relevant Chrome settings guidance; it does not repeatedly trigger prompts. Microphone and site access are reported separately.

## Composer layout

The composer follows the supplied visual reference while fitting the Chrome side panel:

- one rounded horizontal container;
- a flexible single-line input with full readable placeholder text;
- dictation microphone and send controls aligned on the right;
- full voice-call state represented compactly without squeezing the input;
- minimum touch targets and accessible labels;
- responsive behavior for narrow panel widths.

When space is insufficient, secondary call controls move into a compact call-state row above the composer rather than shrinking the text field.

## Error handling

Errors are categorized and actionable:

- restricted page;
- site access missing;
- tab closed or navigation superseded;
- content script unavailable;
- microphone not configured, denied, or revoked;
- OpenAI key, quota, or Realtime failure;
- Ollama unavailable;
- no Ollama models installed;
- model lacks structured browser-tool capability;
- sensitive transfer expired or destination changed.

Errors update both an accessible status announcement and the relevant execution timeline step. Retry never repeats a consequential action without a fresh observation.

## Testing strategy

Unit and integration coverage includes:

- tab inventory, selection, switching, return, closure, and stale-document handling;
- cross-tab orchestrator cancellation and step limits;
- source-link serialization and safe reopening;
- persistent history restoration, size bounds, and clear-history behavior;
- OTP parsing, one-use transfer, timeout, cancellation, destination binding, and proof that codes never serialize or enter provider requests;
- continued blocking of passwords, passkeys, recovery codes, payment fields, and ordinary typing into OTP fields;
- Ollama discovery, health checks, structured-output validation, incompatible-model handling, and explicit OpenAI fallback approval;
- microphone onboarding for granted, denied, dismissed, and revoked states;
- separation of Realtime voice and dictation visibility;
- Nexus timeline step transitions and safe content;
- narrow side-panel composer layout;
- Chrome fixture flows covering Gmail-like search and cross-tab OTP transfer without real accounts.

Production verification includes full tests, type checking, lint, build, unpacked-extension reload, microphone onboarding, OpenAI Realtime session creation, local Ollama discovery, provider switching, persistent restart recovery, and multi-tab fixture execution.

## Delivery sequence

Implementation should proceed in independently testable stages:

1. repair composer layout and microphone onboarding;
2. add persistent linked history and execution timelines;
3. add provider settings, Ollama discovery, adapter, and fallback approval;
4. add tab registry and cross-tab orchestration;
5. add the volatile OTP-transfer capability and fixture coverage;
6. complete end-to-end Chrome verification and documentation.

The stages share contracts but must not bypass their own verification gates.
