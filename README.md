# Nudge

Nudge is a Chrome extension that operates your browser on your behalf through text and live voice. You state an outcome; Nudge observes the page, keeps a short plan, performs validated browser actions, verifies progress, and adapts until the task is done — or tells you precisely what remains.

See [docs/browser-agent.md](docs/browser-agent.md) for the architecture, tool vocabulary, permissions and what is (and is not) verified.

## Local setup

1. Copy `.env.example` to `.env` and choose a pairing secret of at least 16 characters. Copy that same value into `WXT_PUBLIC_NUDGE_PAIRING_SECRET` before building the extension. An OpenAI key and `OPENAI_AGENT_MODEL` are only needed for the OpenAI option; local Ollama does not require them.
2. Run `pnpm install`, then start the backend with `pnpm start:server`. Use `pnpm dev:server` only while developing; it restarts when source files change and can interrupt a running browser task.
3. Build the extension with `pnpm --filter @nudge/extension build`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`.
5. Open a normal HTTP(S) page and click the Nudge toolbar icon. Nudge requests browser-wide HTTP(S) and tab access at installation so cross-tab tasks do not repeatedly interrupt you with permission prompts. It also requests the `debugger` permission (Chrome does not allow it to be optional), used only to send real mouse and keyboard input to the task's own tab when a page needs it (for example a canvas editor) and for screenshots. While it is attached Chrome shows a “Nudge started debugging this browser” bar; Nudge detaches when the step is done.

Tasks run in the extension's background service worker, so closing or reloading the side panel does not stop them. Reopening the panel shows the current task.

The backend listens only on `127.0.0.1:4317`. The environment OpenAI key is the default. A user can replace it from **Provider settings**; the replacement stays only in backend memory and is cleared when that process restarts.

Eligible full-screen text can instead use a connected ChatGPT plan. That control is not shown in the side panel. Setup, the local companion, and the billing split are in [docs/chatgpt-plan.md](docs/chatgpt-plan.md). Voice and browser actions are not moved onto the plan.

## Full-page chats and local memory

Use **Open full-page chat** in the side-panel header for a separate Nudge tab. The full-page composer has a model menu for the configured OpenAI provider and installed Ollama models. Its attached website remains explicit even while the Nudge tab is active. New chats, saved chats, and Memory/Profile controls are available in the full-page view. Browser actions still have one active task; multiple chats do not imply simultaneous browser control. The light/dark toggle is shared across the compact panel and full-page view. Chat follows incoming text and progress; scrolling upward pauses following until you send a message or choose Jump to latest.

The paired local server stores saved chats, useful first-person profile declarations, and uploaded document text in SQLite. On macOS the default file is `~/Library/Application Support/Nudge/nudge.sqlite`; set `NUDGE_DATA_DIR` before starting the server to choose another directory. Linux uses `~/.local/share/nudge`. The directory and database use private owner permissions. SQLite journal files may sit beside the database. This is local storage, not application-level encryption; use your operating system's disk protection for at-rest protection.

The extension keeps per-chat local browser caches for resilience. SQLite is the shared authority; clear generations and deletion markers prevent stale caches from restoring removed chats. Review, edit, or delete saved profile facts in Memory/Profile. Deleting a saved fact leaves the original conversation searchable; delete or clear that chat to remove its original statements too. Deleting a document removes its stored text and search entry. No model training is performed.

Memory has Profile, Documents, and Settings tabs. Documents accepts drag-and-drop or a file picker. Settings can disable automatic fact extraction and opt into local timing/token diagnostics; no remote analytics are enabled. Older-chat cleanup is manual, lists matches for review, and rechecks age before deletion. It keeps the current chat and uploaded documents.

Upload a text-based PDF (up to 30 pages), DOCX, TXT or Markdown CV, or paste its text. Extraction runs locally; files are limited to 5 MB and extracted text to 100,000 characters. Scanned PDFs need a text-based copy. Relevant saved facts and excerpts help with questions and form filling; absent or conflicting details require clarification. A CV is reference material, not permission to submit an application. With Ollama selected, inference stays local. Choosing OpenAI sends the relevant context included in that request to OpenAI.

## Native browser controls

Nudge accepts direct commands such as “zoom in”, “zoom to 125%”, “reset zoom”, “go fullscreen”, “exit fullscreen”, “maximize window”, “pin this tab”, and “mute this tab”. These run through Chrome's browser APIs without waiting for model inference. Nudge checks the resulting state before reporting success.

“Split two tabs side by side” uses Chrome's native split view when available and eligible; otherwise it arranges two browser windows. “Stack two tabs vertically” uses two windows. Keep exactly two website tabs in the linked window, or select the intended pair, to avoid ambiguity. Screen work-area access (`system.display`) is used to place windows within the display. Browser restrictions and minimum window sizes can prevent a requested layout; Nudge reports that rather than claiming completion. Extra permissions cannot expose browser or operating-system features for which Chrome has no extension API.

When a full-page browser task is sent, Nudge opens its window-wide side panel during that click, so the panel remains available when the task opens a new tab. Voice calls do the same from the call button. Chrome requires this user gesture; if Chrome denies it, use the Nudge toolbar icon on the destination tab. The panel shares the active chat and task progress.

## Voice and microphone

The first dictation or voice call opens Nudge's dedicated microphone setup page. Chrome requires a direct click on **Allow microphone**; this cannot be silently auto-approved. Nudge verifies the audio track and stops it immediately. If Chrome permission is later revoked, Nudge detects that and reopens setup. OpenAI supports cloud realtime calls and dictation. With Ollama selected, calls and dictation use local Whisper, Qwen 3.5:9b, and Kokoro; follow [local voice setup](docs/local-voice.md) first. Calls listen continuously, detect pauses, and allow interruption. Direct browser commands such as “Open YouTube” go to the task controller; ordinary conversation stays in voice chat. “Nudge, …” remains available for other task requests.

## Run browser tasks later

Use text or voice with an execution time first: “in 10 minutes, check this page for updates” or “tomorrow at 9:30 am, summarize this page”. Relative delays accept whole minutes or hours (up to 30 days); tomorrow's time uses your computer's local timezone and requires am/pm. Other execution-time formats prompt for one of these forms. Recurring jobs are not supported yet.

Nudge saves the instruction, source URL, selected provider, and run time on this device. The full-page Scheduled tasks list shows pending work, execution times and outcomes, with Run now, Edit, Cancel, and Delete controls where applicable. These logs and management controls are unavailable in the compact panel; task durations are also full-page only. If you change provider, model, or server settings before a job runs, it asks you to schedule it again instead of silently changing models. At run time it uses the original page, or opens the saved URL if that tab was closed or navigated elsewhere. Jobs wait for an existing task, including a paused task or pending confirmation. Chrome, the Nudge server, and the selected provider must be available. Timing is best effort; jobs more than 15 minutes late are marked missed. Started tasks are never replayed automatically after an uncertain restart. Login prompts and existing action confirmations still require your attention. Scheduled-job data is separate from conversation history.

“Schedule a meeting on my calendar tomorrow at 9 am” remains a normal calendar task: Nudge opens and uses your calendar now. Only an execution-time prefix delays the browser work itself.

## Local Ollama

Run Ollama on its default loopback address (`http://127.0.0.1:11434`) and pull a model that reports tool support, for example with `ollama pull qwen3:8b`. Open **Provider settings**, choose Ollama, refresh models, and select one. Nudge never downloads a model automatically. If Ollama is unavailable, empty, or cannot produce a valid browser decision, the task stops before acting and offers **Use OpenAI for this task**. That approval expires, applies only to the current task, and does not change the remembered provider.

## Browser-wide history and security

Nudge can reuse safe HTTP(S) tabs and keeps up to 200 sanitized conversation turns in `chrome.storage.local`. Source chips reopen the exact verified page. Clear history removes persisted and in-memory history. Stored data excludes raw page snapshots, API keys, passwords, OTPs, cookies, payment fields, and private model reasoning.

Chrome does not expose saved passwords to extensions. For an explicit sign-in request, Nudge can focus a password field so Chrome Autofill can respond, but it cannot read or type the password. Explicit OTP transfer uses a one-use, two-minute in-memory envelope bound to the destination tab, document, field, task, and cancellation generation. It never submits the form.

## Test shop

Run `pnpm dev:fixtures`, then open `http://127.0.0.1:4173`. The fixture supports searching for an iPhone 16, filtering to Black and 256 GB, and opening the cheapest matching result. It also includes hostile page text to verify that website content never becomes an instruction to Nudge.

## Verification

- `pnpm test` runs contracts, policy, backend, DOM adapter, launcher, orchestration, and component tests.
- `pnpm typecheck` checks every workspace package.
- `pnpm build` produces the Chrome Manifest V3 bundle and fixture build.
- `pnpm test:browser` exercises the shop, mail, verification, manifest, and onboarding fixtures in Chrome (set `NUDGE_CHROMIUM_PATH` to use a specific Chromium build).
- `pnpm test:accept` builds an e2e copy of the extension (`apps/extension/.output-e2e`), starts the fixtures and a backend with the **test-only scripted planner** (`NUDGE_PLANNER=scripted`, refused when `NODE_ENV=production`), loads the real extension in Chromium, and runs the acceptance flows. No OpenAI calls are made.

Local DOM snapshots and ordinary mutations are designed to complete inside 150 ms on a responsive page. Live OpenAI latency depends on network and model response time; live-provider latency has not yet been benchmarked in this repository.
