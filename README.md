# Nudge

Nudge is a Chrome extension that operates your browser on your behalf through text and live voice. You state an outcome; Nudge observes the page, keeps a short plan, performs validated browser actions, verifies progress, and adapts until the task is done — or tells you precisely what remains.

See [docs/browser-agent.md](docs/browser-agent.md) for the architecture, tool vocabulary, permissions and what is (and is not) verified.

## Local setup

1. Copy `.env.example` to `.env`, add your OpenAI API key, set `OPENAI_AGENT_MODEL` (the live test uses `gpt-4.1-mini`), and choose a pairing secret of at least 16 characters. Copy that same value into `WXT_PUBLIC_NUDGE_PAIRING_SECRET` before building the extension.
2. Run `pnpm install`, then start the backend with `pnpm dev:server`.
3. Build the extension with `pnpm --filter @nudge/extension build`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`.
5. Open a normal HTTP(S) page and click the Nudge toolbar icon. Nudge requests browser-wide HTTP(S) and tab access at installation so cross-tab tasks do not repeatedly interrupt you with permission prompts. It also requests the `debugger` permission (Chrome does not allow it to be optional), used only to send real mouse and keyboard input to the task's own tab when a page needs it (for example a canvas editor) and for screenshots. While it is attached Chrome shows a “Nudge started debugging this browser” bar; Nudge detaches when the step is done.

Tasks run in the extension's background service worker, so closing or reloading the side panel does not stop them. Reopening the panel shows the current task.

The backend listens only on `127.0.0.1:4317`. The environment OpenAI key is the default. A user can replace it from **Provider settings**; the replacement stays only in backend memory and is cleared when that process restarts.

## Voice and microphone

The first dictation or voice call opens Nudge's dedicated microphone setup page. Chrome requires a direct click on **Allow microphone**; this cannot be silently auto-approved. Nudge verifies the audio track and stops it immediately. If Chrome permission is later revoked, Nudge detects that and reopens setup. OpenAI supports realtime calls and dictation. Ollama mode hides realtime-call controls but keeps dictation for reviewed text entry.

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
