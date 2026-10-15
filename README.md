# Nudge

Nudge is a Chrome extension that operates the current website through text and live voice while validating each browser action and verifying its result.

## Local setup

1. Copy `.env.example` to `.env`, add your OpenAI API key, set `OPENAI_AGENT_MODEL` (the live test uses `gpt-4.1-mini`), and choose a pairing secret of at least 16 characters. Copy that same value into `WXT_PUBLIC_NUDGE_PAIRING_SECRET` before building the extension.
2. Run `pnpm install`, then start the backend with `pnpm dev:server`.
3. Build the extension with `pnpm --filter @nudge/extension build`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3`.
5. Open a normal HTTP(S) page and click the Nudge toolbar icon. Chrome grants temporary access to that tab; persistent per-site access remains optional.

The backend listens only on `127.0.0.1:4317`. The environment OpenAI key is the default. A user can replace it from **OpenAI connection** in the side panel; the replacement stays only in backend memory and is cleared when that process restarts.

## Test shop

Run `pnpm dev:fixtures`, then open `http://127.0.0.1:4173`. The fixture supports searching for an iPhone 16, filtering to Black and 256 GB, and opening the cheapest matching result. It also includes hostile page text to verify that website content never becomes an instruction to Nudge.

## Verification

- `pnpm test` runs contracts, policy, backend, DOM adapter, launcher, orchestration, and component tests.
- `pnpm typecheck` checks every workspace package.
- `pnpm build` produces the Chrome Manifest V3 bundle and fixture build.
- `pnpm test:browser` exercises the shop flow in Chromium.

Local DOM snapshots and ordinary mutations are designed to complete inside 150 ms on a responsive page. Live OpenAI latency depends on network and model response time; live-provider latency has not yet been benchmarked in this repository.
