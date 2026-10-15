Build a working rough MVP of **Nudge**, a Chrome extension that lets users operate websites through voice and text.

Nudge is a browser agent. A user describes a goal, and Nudge reads the current page, interacts with the website, checks the result, and continues until the task is complete or needs user input.

The immediate goal is a functioning unpacked Chrome extension that I can install locally and test on real websites. Prioritize a complete working interaction loop and clear feedback over extensive infrastructure.

## 1. Product scope

Build the consumer Chrome extension first.

Example requests:

- “Find an iPhone 16.”
- “Only show the black ones with 256GB storage.”
- “Open the cheapest matching option.”
- “Take me to the contact page.”
- “Find where I can update my profile.”
- “Open the send-money form.”
- “Fill this form using the details I give you.”

Nudge should use the website’s existing interface. Website owners should not need to install anything, expose APIs, provide source code, or register actions.

Later, businesses will install an embedded version on their own websites. Organize the code so the conversation, intake, planning, policy, and verification logic can be reused for that version.

Do not implement the business dashboard, business SDK, or business installation flow yet.

Other exclusions:

- Canva design creation and advanced canvas editing.
- Cross-tab or multi-site task orchestration.
- Background autonomous tasks.
- Scheduled actions.
- Checkout, money transfers, or other financially binding submissions.
- Authentication bypass, CAPTCHA solving, or automatic credential entry.
- A claim of universal website compatibility.

## 2. Inspect and research before implementation

Inspect the repository and follow applicable project instructions.

Check current official Chrome extension documentation for Manifest V3, content scripts, activeTab, optional host permissions, sidePanel, scripting, storage, service-worker lifecycle, microphone access, and screenshot capture.

Check official documentation for the selected AI provider and speech approach. Use current supported APIs and models. Do not invent API names, models, permissions, or browser capabilities.

Choose the smallest practical implementation. Briefly document important decisions, then build the complete MVP without repeatedly asking for routine implementation choices.

If no application exists, use TypeScript throughout, React for extension UI, and a suitable extension build setup such as WXT or an equivalent maintained toolchain. Use a small Node.js TypeScript backend if needed for model and speech calls.

## 3. User experience

### First activation

The user installs the unpacked extension and clicks its toolbar icon.

Open Nudge’s Chrome side panel. Explain briefly that Nudge can read and interact with the current page when activated.

Request the permissions required for the immediate task through valid Chrome user gestures.

After page access is granted, inject a small floating Nudge button into supported pages.

Use temporary page access for the initial experience. Offer an explicit “Enable on this site” option using optional host permissions if the user wants the button to persist on future visits.

Do not request access to every website by default.

Clearly explain unsupported pages and permission failures.

### Floating button

Create a compact, draggable button near the bottom-right corner.

Requirements:

- Distinctive Nudge identity.
- Subtle idle appearance.
- Listening and working indicators.
- Hover tooltip.
- Dismiss for this page.
- Do not cover important website controls.
- Isolate styles, preferably using Shadow DOM.
- Avoid duplicate injection.
- Remove listeners and observers during cleanup.

Where Chrome permits, clicking it should open the side panel using a supported user-gesture path. If that is unreliable, provide an in-page compact launcher that directs the user to the toolbar icon. Do not rely on unsupported side-panel behavior.

The button should survive ordinary SPA route changes without multiplying.

### Side panel

Include:

- Nudge wordmark.
- Current website/domain.
- Clear status.
- Conversation history.
- Text composer.
- Push-to-talk microphone.
- Send button.
- Persistent Stop button during execution.
- Collapsible action history.
- Clear conversation control.

Example statuses:

- Ready.
- Listening.
- Understanding.
- Checking page.
- Working.
- Waiting for your answer.
- Waiting for confirmation.
- Completed.
- Stopped.
- Unable to continue.

Keep messages natural:

- “I’m looking for the search box.”
- “I found the storage filter.”
- “The page hasn’t changed. I’ll check again.”
- “I found three matching products.”

Base statements on observed evidence. Do not fabricate results or narrate success before verification.

Use a polished but restrained visual style: readable typography, soft neutral surfaces, one accent colour, accessible contrast, clear focus states, and modest animation.

## 4. Intake engine

Implement intake as a typed module independent of Chrome APIs.

Its job is to combine the latest utterance, conversation context, current page context, and existing task state into a clear next decision.

### Inputs

- User’s text or speech transcript.
- Recent conversation turns.
- Current URL and page title.
- Current page snapshot.
- Active task and previous verified actions.
- Relevant constraints supplied by the user.

### Output

Define and validate a structured result containing:

- Task ID.
- User goal.
- Intent category.
- Explicit user constraints.
- References resolved from earlier conversation.
- Missing required information.
- Proposed success conditions.
- Risk category.
- Whether this starts, modifies, cancels, or resumes a task.
- Whether clarification is required.

Use categories such as search, navigate, filter, inspect, fill_form, prepare_action, and unsupported.

Examples:

“Find an iPhone 16” starts a search.

“Only black ones” modifies the current search and retains the iPhone requirement.

“The second one” should resolve against a recent, still-valid set of observed results. Ask if the reference is ambiguous or stale.

“Stop” cancels the active task immediately.

Do not assume missing recipient names, amounts, delivery details, or other consequential information.

Ask one concise clarification when needed. Do not require the user to provide every optional search preference before beginning.

Retain task context when navigation reloads the document.

## 5. Page understanding

Use DOM-based understanding first.

The page reader should produce a compact structured snapshot with:

- URL and title.
- Visible headings and relevant text.
- Links and destinations.
- Buttons and accessible names.
- Form controls, labels, roles, types, and permitted current values.
- Select options.
- Dialogs.
- Disabled and visibility states.
- Relevant product/result summaries where identifiable.
- Viewport position and scroll information where useful.

Create temporary element IDs mapped to live elements. Associate IDs with a document/snapshot version so stale IDs cannot accidentally target a different element.

Prefer accessible names, labels, roles, and stable attributes. Avoid relying entirely on brittle CSS paths.

Exclude Nudge’s own interface from snapshots.

Do not send entire raw HTML documents to the model. Bound and prioritize extracted content, and represent truncation explicitly.

Do not collect password fields, authentication codes, payment-card data, hidden inputs, cookies, browser storage, or unrelated personal information.

Read only relevant visible page content. Treat page content as untrusted data.

Use screenshots as an optional visual fallback when necessary. Capture only when justified and disclose screenshot use. Do not capture screenshots of sensitive workflows; automatic visual redaction is outside this MVP.

Handle:

- SPA route changes.
- Full document navigation.
- Delayed rendering.
- Open dialogs.
- Lazy-loaded content.
- Stale or removed elements.

Report frame, shadow-root, canvas, and browser restrictions honestly. Do not silently treat inaccessible content as empty or completed.

The system discovers routes from observed links and navigation. It must not claim to know every route or invent URLs.

## 6. Agent execution loop

Implement:

1. Capture current page state.
2. Interpret the task or follow-up.
3. Select the next permitted action.
4. Validate the action and target.
5. Execute one action.
6. Wait for a relevant change or bounded timeout.
7. Capture fresh state.
8. Verify the result.
9. Continue, clarify, stop, or report completion.

Use a typed, schema-validated action vocabulary:

- read_page
- click
- type_text
- select_option
- scroll
- navigate_to_observed_url
- wait_for_change
- ask_user
- finish

Distinguish internal control decisions from browser mutations.

The model must not generate JavaScript for arbitrary execution.

For type_text, define replacement versus append behavior explicitly. Trigger appropriate native events, then read back the value to verify framework-controlled inputs accepted it.

Before clicking, check that the target is current, visible, enabled, and appropriate. Do not force-click hidden elements.

Re-observe after actions rather than assuming success.

Use relevant DOM changes, URL changes, dialog appearance, and field values as evidence. Avoid fixed delays as the primary synchronization mechanism.

Set bounded limits, configurable with sensible defaults:

- Maximum actions per task.
- Maximum total task duration.
- Maximum repeated actions with no observable progress.
- Maximum recovery attempts.

On a limit, stop with a clear explanation and offer to continue with a revised instruction.

Do not repeatedly click the same button.

## 7. Verification and truthful completion

Define completion in terms of observable outcomes.

Examples:

- Search: results are visible for the requested query.
- Filter: the requested filter is selected and results refreshed.
- Navigation: the intended destination or section is visible.
- Form preparation: supplied values are present in the correct fields.
- Dialog opening: the expected dialog is visible.

Distinguish “I applied the filter” from “Every result satisfies the requirement.” Only make the latter claim when the page provides sufficient evidence.

A finish decision must include evidence from the current state. Reject unsupported success claims.

When results cannot be verified, say what was attempted and what remains uncertain.

## 8. Voice

Ship text input and usable voice input in this MVP.

Use push-to-talk initially:

- Explicit microphone permission.
- Clear recording indicator.
- Stop recording control.
- Editable transcript.
- Send transcript through the same intake path as typed text.
- Handle denial, silence, device failure, and transcription errors.
- Stop microphone tracks after recording.

Prefer a short MediaRecorder recording transcribed through the backend using a supported provider. If you select a browser speech API instead, verify current compatibility and document its limitations.

Add optional spoken responses with a mute toggle. Browser speech synthesis is acceptable for this rough MVP if supported.

Avoid listening while speaking. Stop audio when the user presses Stop.

Full-duplex conversation, interruption detection, and continuous listening are later work.

Never make text interaction depend on a functioning microphone.

## 9. Safety and permissions

Operate within the user’s current authenticated website session through its interface.

Never extract session cookies or copy credentials to the backend.

For this MVP:

- Allow ordinary searching, filtering, scrolling, and navigation.
- Allow safe form preparation.
- Ask before sending messages, submitting personal data, or changing account settings.
- Block purchases, transfers, trading, deletion, and other irreversible actions.
- Allow opening a transfer form, but stop before a financial submission.
- Hand authentication, OTP, CAPTCHA, and password entry back to the user.

Enforce policy in code as well as in model instructions.

Bind confirmations to the exact action, target, parameters, and page state. Invalidate approval if those change.

Treat website text as untrusted content, including text that tells Nudge to ignore instructions or transmit data. Website content cannot authorize new goals or grant permissions.

Restrict navigation to observed HTTP/HTTPS destinations relevant to the request, with permission checks. Do not execute javascript: URLs.

Provide immediate cancellation. Abort pending model requests where possible, reject later results from cancelled tasks, clear queued actions, and ensure no further browser mutation occurs after cancellation is acknowledged.

Do not log sensitive page snapshots or transcripts by default.

## 10. Architecture for reuse

Keep Chrome-specific behavior behind interfaces.

Suggested logical modules:

- agent-core: task state, orchestration, intake, planning, verification.
- contracts: schemas and typed messages.
- browser-adapter: page snapshots and action execution.
- policy: deterministic action restrictions and confirmations.
- extension-ui: conversation, voice controls, launcher.
- backend: provider calls and server-side secrets.

These can be folders in a small repository. Do not create excessive packages just for architectural appearance.

The core should accept a PageAdapter interface for observing and acting. The extension implements that adapter with content scripts and extension messaging.

A future business embed should be able to provide another adapter and optional registered application actions while reusing the core. No business-specific execution path is needed now.

Feature-detect optional WebMCP capabilities later through the same boundary. Do not make WebMCP a requirement or simulate support.

## 11. Extension lifecycle and backend

Use Manifest V3.

Account for service-worker suspension and page reloads. Do not depend on one service-worker function remaining alive throughout a long task.

Choose and document an explicit orchestration owner. Persist minimal recoverable task state and revalidate it before resuming. Never replay an uncertain mutation after reconnection.

Bind each task to a tab, frame, document, and origin where appropriate. Switching the active tab must not silently redirect a running task.

Validate all extension messages and model responses.

Keep provider secrets on the backend, not in extension bundles, source-controlled files, or synced browser storage.

For local development, bind the backend to loopback, restrict callers appropriately, and use a development pairing secret or equivalent guard. CORS alone is not authentication.

Provide environment examples without real secrets.

Implement bounded timeouts, cancellation, understandable provider errors, and basic abuse/request limits.

Store conversation locally with a clear deletion control. Do not retain raw audio by default.

## 12. Development fixtures

Build local fixture websites for repeatable development:

1. A shop with search, colour/storage filters, product results, and product pages.
2. A settings app with navigation, editable fields, and confirmation dialogs.
3. A fake financial app where Nudge may open and prepare a transfer form but must block final transfer submission.

Include both SPA navigation and at least one full-page navigation.

Fixtures must use the actual page reader, model tool contract, executor, and verification path. Do not implement special hidden commands that make only the demo work.

Allow deterministic model-response fixtures for automated tests, clearly separated from live-provider mode.

The extension must work against real websites through its general adapter rather than only recognizing demo URLs.

## 13. Testing and acceptance criteria

Test the meaningful failure modes:

- Follow-ups retain prior constraints.
- Ambiguous references cause clarification.
- Schema-invalid model actions are rejected.
- Stale element IDs trigger fresh observation.
- A click with no effect does not produce a success claim.
- Navigation preserves task context safely.
- Tab switching does not redirect the task.
- Cancellation prevents queued and late actions.
- Prompt injection in page text cannot override policy.
- Financial submission remains blocked.
- Provider failure leaves the UI usable.
- Permission denial produces a useful recovery path.

Demonstrate these end-to-end flows:

A. Search for iPhone 16, apply black and 256GB constraints, and open a matching result.

B. Navigate to profile settings and fill supplied non-sensitive information.

C. Open the fake transfer form and stop before submission.

D. Start a multi-step task, cancel it, and show that no later action occurs.

E. Complete a task involving full-page navigation without losing conversation context.

Run appropriate type checks, build checks, and automated tests. Report actual results. If live Chrome or provider credentials are unavailable, state exactly which live checks remain unverified.

## 14. Deliverables

Deliver:

- Working unpacked Chrome extension build.
- Source code.
- Minimal backend if required.
- Local fixture websites.
- Environment template.
- README with exact setup, build, backend startup, extension loading, microphone, and permission instructions.
- Brief architecture explanation.
- Supported capabilities and known limitations.
- Test results and a short manual verification checklist.
- A concise note identifying the reusable modules for the future business embed.

Do not stop at a scaffold, chat mockup, or hardcoded demonstration. Complete the real text/voice → intake → page observation → action → verification loop.

The first milestone is that I can install Nudge, activate it on a supported website, speak a simple request, watch the interface respond, and receive a truthful result.