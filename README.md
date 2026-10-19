<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/png/nudge-logo-on-dark.png">
    <img src="assets/brand/png/nudge-logo-840x224.png" alt="Nudge" width="320">
  </picture>
</p>

# Nudge

Nudge is an open-source browser companion for Chrome. You describe an outcome in text, dictation, or a voice call. Nudge reads the page, plans one browser action at a time, checks that action against your instruction, runs it, and checks the result. It stops when the task is done, when it needs you, or when you stop it.

**Public alpha (0.1.0-alpha.1).** The extension is loaded unpacked from a local build. It is not a Chrome Web Store install. A local backend on your computer is required. Browser tasks on real websites depend on the model you select, and that quality is not guaranteed.

## What works

- Text instructions that observe a page and take typed browser actions: click, type, choose options, scroll, navigate, switch tabs, and read text.
- Cross-tab work on ordinary `http` and `https` pages, including opening a link Nudge has already seen.
- Confirmation before bulk or consequential actions such as moving several messages or submitting a form.
- A full-page chat with saved chats, profile facts, and uploaded documents (PDF, DOCX, TXT, Markdown) stored in a local SQLite file.
- OpenAI API models for planning, chat, dictation, and realtime voice, billed to the API key you configure.
- Ollama on `127.0.0.1:11434` for browser planning and, with the separate local voice stack, for calls and dictation.
- An optional ChatGPT plan connection for full-screen text and browser planning. It uses OpenAI’s documented [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) flow for open-source, locally hosted apps. Voice stays on the API key or on local models. See [docs/chatgpt-plan.md](docs/chatgpt-plan.md).
- Direct Chrome commands that do not call a model, such as zoom, fullscreen, pin, and mute.
- Scheduled one-shot tasks (“in 10 minutes, check this page”). Recurring jobs are not supported.
- A local fixture site for trying a shop, mail, and form flow without a live provider.

## Known limits

- Live planning quality on real sites (including Gmail, Google Sheets, and Google Calendar) is not part of the automated acceptance suite.
- Google Sheets and Excel are ordinary web pages. Nudge is instructed to type a cell, then Tab across columns or Enter down a row. Complex sheets can still fail.
- Calendar changes go through Google Calendar’s own page. There is no Google API integration.
- Passwords cannot be read or typed. A password field can be focused so Chrome Autofill can respond.
- One-time codes can be transferred only through an explicit, single-use in-memory handoff. Nudge does not submit that form.
- Scanned PDFs are not read. Uploads are limited to 5 MB and 30 PDF pages.
- Screenshots of pages that ignore synthetic clicks use Chrome’s debugger on that tab. Chrome shows a debugging bar until Nudge detaches.
- Closed shadow roots and cross-origin iframes are not readable.
- The ChatGPT plan path is a preview. It is for this open-source, locally hosted app. A paid or remotely hosted product needs OpenAI’s separate program. Audio is not sent on that path.
- This repository does not ship a hosted backend. The extension archive alone does not run tasks.

## Quick start

Requirements: Node.js 22.13 or newer, pnpm 11.1 or newer, and Chrome 114 or newer (side panel). macOS and Linux are the documented local-data paths. Windows paths for the SQLite file are not documented here.

```sh
pnpm install
cp .env.example .env
# Put the same 16+ character random value in NUDGE_PAIRING_SECRET and WXT_PUBLIC_NUDGE_PAIRING_SECRET.
# openssl rand -hex 24
pnpm start:server
pnpm --filter @nudge/extension build
```

In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`. Open an `http` or `https` page and click the Nudge toolbar icon.

Use `pnpm dev:server` only while editing the server. It restarts on file changes and can interrupt a running task. `pnpm dev:extension` rebuilds the extension during UI work; reload the extension card after a production rebuild.

The pairing value is compiled into the extension. It is not an API key. It lets the extension call the backend on `127.0.0.1:4317`. Anyone with that value can call the backend from this computer. Generate a new value before you share a build.

## Providers

| Path | What it is for | What leaves the machine |
|---|---|---|
| OpenAI API key | Planning, chat, dictation, realtime voice | The request you send, including page text the planner needs and any attached chat images |
| Ollama | Planning and chat on a local model | Stays on this computer when the model is local. Browser actions still run in Chrome |
| Local voice stack | Calls and dictation while Ollama is selected | Audio stays local only when [local voice](docs/local-voice.md) is installed. Otherwise voice uses OpenAI |
| ChatGPT plan | Full-screen text and browser planning after you connect | Requests go to `api.openai.com` with your plan token. Tokens stay in the local companion, not in the extension |

An OpenAI key in `.env` is the server default. A key entered in Provider settings is kept in the server process memory and cleared when that process stops. The extension bundle does not contain the API key.

Ollama must already be running at `http://127.0.0.1:11434` with a model you have pulled that can call tools. Nudge does not download models. If Ollama cannot produce a valid browser decision, the task stops and can offer **Use OpenAI for this task**. That choice is for the current task only.

## Voice and microphone

Chrome asks for the microphone only after you open Nudge’s setup page and choose **Allow microphone**. Dictation and realtime calls with an OpenAI key send audio to OpenAI and are billed as API usage.

Local calls stay on this computer only when the [local voice stack](docs/local-voice.md) is installed and Ollama is selected. That stack is documented for Apple Silicon. It uses Whisper, Qwen, and Kokoro on `127.0.0.1:4318`, separate from the main backend. Without it, voice uses the OpenAI key.

## Example requests

On the fixture site (`pnpm dev:fixtures`, then `http://127.0.0.1:4173`):

- “Find the cheapest black 256 GB option.”
- “Summarize this page.”
- “Fill this form from my saved profile and do not submit it.”

On a normal page:

- “Open the pull requests page.”
- “In 10 minutes, check this page for updates.”
- “Zoom to 125%.”

## Permissions

The unpacked extension requests:

- `http://*/*` and `https://*/*`, plus `tabs` and `scripting`, so a task can continue across ordinary websites without a permission prompt on every site.
- `sidePanel`, `storage`, and `alarms` for the panel, local history, and scheduled tasks.
- `debugger`, which Chrome will not make optional. Nudge attaches it to the task’s own tab for real pointer and keyboard input and for screenshots, then detaches.
- `system.display` to place windows for split or stacked layouts.
- `nativeMessaging` for the optional ChatGPT companion. The companion accepts only the extension ID recorded when you install it.
- Microphone access is requested later, from Nudge’s setup page, and only after you click **Allow microphone**.

Page text is treated as data. It does not grant permission to send, pay, delete, or ignore your instruction.

## Development and tests

```sh
pnpm typecheck   # generates .wxt types; uses a placeholder pairing value if none is set
pnpm test
pnpm dev:fixtures
pnpm test:browser   # needs a Chromium binary; set NUDGE_CHROMIUM_PATH if required
pnpm test:accept    # scripted planner, no live provider calls
```

`pnpm test:accept` uses `NUDGE_PLANNER=scripted`, which the server refuses when `NODE_ENV=production`.

`./scripts/package-alpha.sh` writes a gitignored unpacked build and zip under `release/`. That archive still needs this server. It is not a Chrome Web Store package.

## More documentation

- [Architecture](docs/architecture.md)
- [Browser agent](docs/browser-agent.md)
- [ChatGPT plan](docs/chatgpt-plan.md)
- [Local voice](docs/local-voice.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Roadmap](docs/roadmap.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Draft release notes](docs/release/0.1.0-alpha.1.md)

## License

[MIT](LICENSE). Copyright (c) 2026 Nudge by AroicX Labs Ltd.

Security and conduct reports: [aroicx@gmail.com](mailto:aroicx@gmail.com).
