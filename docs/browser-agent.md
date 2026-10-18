# Nudge browser agent

## How a task runs

User goal (voice or text) → **scope** (authorization from the user's words only) → loop of
**observe → plan one tool call → policy → execute → verify → remember** → completed, partially completed, failed or cancelled with a structured report (verified / still to do / done but not verified / skipped).

| Component | Where |
|---|---|
| Task controller, single mutation scheduler, checkpoints | `apps/extension/src/agent/task-controller.ts` (background service worker) |
| Planner proxy (OpenAI Responses, Ollama, test-only scripted) | `apps/server/src/planner/*`, `POST /api/agent/scope`, `POST /api/agent/plan` |
| Policy, authorization, previews, verifier, memory, records, export | `packages/core/src/agent/*` (pure, unit-tested) |
| DOM executor, snapshot, timed repeat, in-page OTP handling, cursor | `apps/extension/src/content/*` |
| Trusted input + screenshot fallback (Chrome DevTools Protocol) | `apps/extension/src/agent/cdp-executor.ts` |
| Side panel (view + voice) | `apps/extension/entrypoints/sidepanel/main.tsx`, Port `nudge-panel` |

## Tools (typed, validated by Zod in both the backend and the extension)

Profile (read-only, the signed-in user's local data): `get_candidate_profile`, `search_cv`, `list_documents` · Forms: `choose_option` (custom dropdowns, comboboxes, autocomplete, radio groups), `attach_document` (CV upload through the file input) · Calendar (Google Calendar's own UI, no API): `calendar_open_event_editor`, `calendar_find_event` · Observe: `list_tabs`, `observe_tab {screenshot?}`, `read_text`, `inspect_element` · Navigate: `open_tab`, `activate_tab`, `navigate`, `go_back`, `go_forward`, `reload`, `close_tab` (only tabs Nudge opened) · Interact: `click`, `double_click`, `hover`, `focus`, `type_text`, `press_keys` (allow-listed keys; browser shortcuts blocked), `select_option`, `scroll`, `drag`, `wait_for` · Visual: `click_at`, `double_click_at`, `drag_at`, `type_at` (only against a fresh screenshot frame) · Control: `ask_user`, `request_confirmation`, `record_items`, `export_records`, `start_timed_repeat`, `transfer_code`, `finish`, `report_partial`.

There is no model-generated JavaScript, shell access, or raw CDP. CDP use is limited to `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Page.captureScreenshot`, each with a 10 s timeout.

## Safety model

- **Authorization:** derived from the instruction (never page content). `delete_permanent`, `send_message`, `submit_form`, `transfer_code` need explicit wording; purchases, payment/password fields and human-verification challenges are always blocked and handed to you.
- **Previews:** bulk or consequential operations show a preview (operation, location, criteria, count, samples, reversible?). Approval is bound to the exact selection; if the selection changes, Nudge re-previews.
- **Corrections:** "stop", "pause", "continue", "skip this", "yes/no", "use the other tab" are handled deterministically; anything else during a task is a correction that invalidates queued actions and re-plans.
- **Sensitive data:** observation never contains password, card or one-time-code values; code-like text and long tokens are redacted; OTPs travel only in a single-use in-memory envelope and are never submitted.
- **Recovery:** a checkpoint is saved before every mutation. After a service-worker restart the task resumes paused, with any in-flight action marked uncertain; nothing is replayed automatically.

## Verification status (2026-10-16)

Automated (fixtures + scripted planner, real extension in Chromium 1194):

| Flow | Result |
|---|---|
| Multi-tab research → sheet rows read back, sources, CSV with `unknown` + formula guard, injected page text ignored | pass |
| Email search summary (no move/delete) | pass |
| Bulk move to Trash with preview, re-preview when a new match arrives | pass |
| Fake OTP transfer to the right field, not submitted, absent from panel/storage/planner traffic | pass |
| Timed scroll every 3 s, stops immediately, one planner call | pass |
| Voice correction mid-task changes the written rows | pass |
| Honest partial completion at a human-verification blocker | pass |
| Canvas editor via trusted pointer/keyboard | pass |

Not verified: live OpenAI planning quality, live Realtime voice, Ollama planning, Gmail, Google Sheets, Canva and other real sites.

Known limits:

- `chrome.tabs.captureVisibleTab` is refused with HTTP(S) host permissions (needs `<all_urls>` or a user-invoked `activeTab`); screenshots fall back to the debugger on the same tab, which shows Chrome's debugging bar.
- Synthetic DOM events are untrusted; sites that check `isTrusted` need the visual tools (debugger).
- Cross-origin iframes and closed shadow roots are not observable; canvas content is visible only via screenshots.


## Candidate profile and job applications (2026-10-18)

- Uploaded CVs (Account → Documents) are parsed locally into a structured profile: name (with first/last split), email, phone, location, LinkedIn, GitHub, portfolio, employment, education and skills. Every value keeps its source (document + excerpt or profile fact). Disagreeing values are marked `conflict`; values you typed in profile settings win but the CV value stays listed.
- PDF extraction now keeps line breaks, so names and contact lines are separable. CVs saved earlier as one long line still parse.
- New uploads keep the original file so `attach_document` can upload it. Documents saved before this change are text-only: re-upload them to attach. Mark one CV as **Default CV** in Account → Documents; with several CVs and no default, Nudge asks which to attach.
- Every provider gets the same context: the OpenAI/Ollama route adds it on the server, the ChatGPT-plan route fetches it from `POST /api/agent/context`. A failed lookup is sent as `retrievalError`, never as "no information".
- Never inferred from a CV: work authorization, visa, salary, availability/notice, demographics, disability/veteran status, legal declarations, relocation. Nudge fills known fields first, then asks for all missing required answers together.
- Submission: "don't submit", "only fill" and "leave as draft" remove submit permission. Submit/Save always shows a confirmation preview. Step buttons (Next, Continue, Save and continue) are not submissions.

## Observation and tool results

- The open dialog's controls are listed first, then form controls anywhere on the page, then what is near the viewport. Unnamed structural roles are skipped, so large pages such as Calendar no longer push new dialogs past the 250-element limit.
- Elements include `required`, `invalid`, `placeholder`, `description` (help/error text, radio group label), `autocomplete`, `files`, `inDialog` and `frame`. Snapshots add `dialog`, `validation`, cross-origin `frames` (address only), `focusedElementId` and a `stateHash`.
- Open shadow roots and same-origin frames are read. Closed shadow roots and cross-origin frames cannot be read by a content script; the frame address is listed so the task can open it directly.
- `type_text` focuses, selects, sends beforeinput/input/change and (except comboboxes) blurs, then reads back what the application kept (`fieldValue`). Reformatting such as phone spacing counts as kept; anything else is `value_rejected` or `validation_error`.
- Tool results are structured: `ok` (executed), `verified` (intended outcome observed), `errorCategory`, `pageChanged`, `recoverable`, and `data` for profile/lookup tools. A click that opens a dialog is verified by comparing observations, not by the executor's guess.
- No-progress: an action that leaves the same page state unchanged twice is refused afterwards; after two refusals, or six stalled steps, the task stops as partially completed with the specific blocker, keeping entered values. Stale references refresh the observation automatically.

## Google Calendar

- `calendar_open_event_editor` resolves the user's date/time words with the current clock and the user's timezone (browser timezone, or `userTimeZone` in extension storage), then opens Calendar's prefilled event editor (`calendar/render?action=TEMPLATE…`). Nothing is saved until Save.
- A title, date, start time or duration that the user did not give is treated as missing; Nudge asks once for all of them. Attendees must appear in the user's words.
- Save requires approval (preview shows title, local date/time with timezone, guests). After any Save attempt, a second Save is refused until `calendar_find_event` checks the day view. A found event blocks re-creation. A finish is rejected until existence is confirmed.

## Image attachments in chat

- Attach by button, paste or drag-and-drop (PNG, JPEG, WebP, GIF; up to 10 MB each, 4 per message). Images are downscaled to 2048 px before sending. Chat history stores only a 160 px thumbnail; full images are sent once and not stored.
- OpenAI receives `input_image` parts; Ollama receives `images` only when the selected model reports the `vision` capability, otherwise the user gets a clear error; ChatGPT plan receives image parts through the companion. No route ever falls back to API billing. Images are used for chat replies only, not browser tasks.

## Verification status (2026-10-18)

| Coverage | Where | Result |
|---|---|---|
| CV → candidate profile → search → attachable file → default selection | server unit + route tests | pass |
| Profile tool use, retrieval failure, multiple CVs, default CV attach | controller tests (fake browser) | pass |
| React-controlled inputs, phone reformatting, autocomplete, custom dropdown, validation, hidden file input, multi-step | `apps/fixtures` `/apply` page rendered in jsdom, real content adapter | pass |
| Calendar-style dialog after a 336-cell grid, time combobox, rejected date, stale references, slow save | `apps/fixtures` `/calendar` page in jsdom | pass |
| Calendar flow with fixed clock/timezone, missing time, approval, uncertain save without duplicate | controller tests (fake calendar URLs) | pass |
| ChatGPT-plan context, invalid-step reply on the same call_id, compact results | extension + companion tests | pass |
| Image composer, provider request builders, non-vision Ollama refusal | component + server tests | pass |

Not verified here: real Chromium runs of the new fixture pages, live Google Calendar (needs your signed-in browser), live ChatGPT-plan/OpenAI/Ollama planning quality and live image replies.
