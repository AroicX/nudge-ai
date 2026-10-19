# Contributing

Nudge is a public alpha. Changes should keep the local OpenAI and Ollama paths working, and should not add a way around a provider’s published limits.

## Setup

Use Node.js 22.13 or newer and pnpm 11.1 or newer.

```sh
pnpm install
cp .env.example .env
```

Set `NUDGE_PAIRING_SECRET` and `WXT_PUBLIC_NUDGE_PAIRING_SECRET` to the same random value of at least 16 characters. Add an OpenAI key only if you are testing that provider. Then:

```sh
pnpm start:server
pnpm --filter @nudge/extension build
```

Load `apps/extension/.output/chrome-mv3` as an unpacked extension. Reload that card after each production rebuild.

`pnpm dev:extension` and `pnpm dev:server` are for active editing. The server watcher restarts the process and can drop an in-flight browser task.

## Repository map

- `apps/extension` — Chrome Manifest V3 extension (WXT): side panel, background task controller, content script.
- `apps/server` — Fastify backend on `127.0.0.1:4317`: planner proxy, memory, document text, provider settings.
- `apps/fixtures` — local pages used by unit and browser tests.
- `packages/core` — policy, authorization, verification, redaction.
- `packages/contracts` — shared Zod schemas.
- `packages/chatgpt-host` — optional native-messaging companion for Sign in with ChatGPT.
- `services/local-voice` — optional Whisper, Qwen, and Kokoro stack.
- `tests/browser` — Playwright acceptance tests with the scripted planner.

## Tests

```sh
pnpm typecheck
pnpm test
```

Browser acceptance tests build a separate extension and do not call OpenAI:

```sh
pnpm test:accept
```

Prefer a fixture or a fake browser in unit tests over a live account. Do not add a test that needs a real API key, ChatGPT session, or personal inbox.

## Pull requests

- Describe the user-visible change and how you tested it.
- Keep unrelated edits out of the diff.
- Do not commit `.env`, SQLite files, `release/`, extension build output, or ChatGPT account files.
- If you change planner instructions, say that the local server must be restarted.
- If you change the extension, say that Chrome must be reloaded.

## Reporting a browser failure

Open a bug report with:

- Chrome version and operating system
- Nudge version from `apps/extension/package.json` (`0.1.0` in this alpha)
- Provider in use (OpenAI, Ollama model name, or ChatGPT plan), not the key or token
- The instruction you sent, rewritten if the original contains private data
- What the page was (site type is enough: “a spreadsheet”, “a job form”)
- What Nudge did, and the task status (completed, partial, failed, stopped)

Do not attach API keys, cookies, password fields, one-time codes, full page dumps, CVs, or screenshots that show an account. Crop or redact anything that identifies you. The fixture site at `http://127.0.0.1:4173` is a safe place to reproduce shopping and form behavior.

## Private reports

Security issues should not go in a public issue. Email [aroicx@gmail.com](mailto:aroicx@gmail.com). See [SECURITY.md](SECURITY.md).
