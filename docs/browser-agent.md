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

Observe: `list_tabs`, `observe_tab {screenshot?}`, `read_text`, `inspect_element` · Navigate: `open_tab`, `activate_tab`, `navigate`, `go_back`, `go_forward`, `reload`, `close_tab` (only tabs Nudge opened) · Interact: `click`, `double_click`, `hover`, `focus`, `type_text`, `press_keys` (allow-listed keys; browser shortcuts blocked), `select_option`, `scroll`, `drag`, `wait_for` · Visual: `click_at`, `double_click_at`, `drag_at`, `type_at` (only against a fresh screenshot frame) · Control: `ask_user`, `request_confirmation`, `record_items`, `export_records`, `start_timed_repeat`, `transfer_code`, `finish`, `report_partial`.

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
| Canvas editor via trusted pointer/keyboard | passes alone; **intermittent in full suite** (see below) |

Not verified: live OpenAI planning quality, live Realtime voice, Ollama planning, Gmail, Google Sheets, Canva and other real sites.

Known limits:

- `chrome.tabs.captureVisibleTab` is refused with HTTP(S) host permissions (needs `<all_urls>` or a user-invoked `activeTab`); screenshots fall back to the debugger on the same tab, which shows Chrome's debugging bar.
- Synthetic DOM events are untrusted; sites that check `isTrusted` need the visual tools (debugger).
- Cross-origin iframes and closed shadow roots are not observable; canvas content is visible only via screenshots.
- Canvas acceptance in the full suite: a second screenshot request is sometimes not delivered to the planner (root cause not yet found).
