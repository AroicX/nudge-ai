# Continue with ChatGPT

Nudge can send eligible full-screen text chats through a connected ChatGPT Plus or Pro plan. Browser tasks use the same connected plan through custom function tools executed by the extension. Realtime voice, dictation, and speech stay on the existing OpenAI API or local voice path.

This uses the open-source, locally hosted Sign in with ChatGPT flow. It is not the commercial website client-ID program. A paid or remotely hosted product would need separate approval and is not enabled here.

## Why a companion is required

The documented callback is `http://127.0.0.1:<port>/auth/callback`. Chrome extensions cannot listen on that address, and `chrome.identity.launchWebAuthFlow` uses an extension redirect that this flow does not accept. Nudge therefore keeps registration, tokens, refresh, and Responses API calls in a local native-messaging companion. The extension never receives access tokens, refresh tokens, or the ID token.

## Install

1. Build or run the repo so dependencies are installed: `pnpm install`.
2. Load the unpacked extension and copy its 32-character ID from `chrome://extensions`.
3. Register the companion for that ID:

```sh
pnpm --filter @nudge/chatgpt-host install-host -- --extension-id YOUR_EXTENSION_ID
```

On macOS this writes:

- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.nudge.chatgpt.json`
- `~/Library/Application Support/Nudge/chatgpt/nudge-chatgpt-host` (launcher pinned to the installing Node executable and chosen data directory)
- `~/Library/Application Support/Nudge/chatgpt/native-host.json` (extension allowlist, mode 0600)

Credentials, when you later connect, are stored in `~/Library/Application Support/Nudge/chatgpt/accounts.json` with owner-only permissions. Set `NUDGE_DATA_DIR` or `NUDGE_CHATGPT_DIR` before installing if you want a different directory. The host ID is created before the first sign-in and reused.

4. Reload the extension. Open **full-screen chat**. The side panel does not show Continue with ChatGPT.
5. Open **Account → ChatGPT**, choose **Continue with ChatGPT**, approve ChatGPT plan access, then pick a model from the list returned for that account.

Run setup again after moving the repository or changing the Node installation. Full-screen settings include the setup command for the current extension ID.

Chrome starts the companion when the extension connects. The companion accepts only the extension ID recorded by the installer and rejects every other message.

## What to expect

- Eligible text uses `POST https://api.openai.com/v1/responses` with the plan access token, `store: false`, and `stream: true`.
- Nudge sends its own conversation and local reference notes. It does not import ChatGPT history or memory.
- If plan permission was declined, sign-in can remain connected while plan usage stays off. Enable it from the full-screen card. Nudge will not send those requests to the API key instead.
- A usage-limit response stops plan requests and links to ChatGPT settings → Usage (`https://chatgpt.com/settings/usage`). Nudge does not invent a remaining allowance or reset time.
- Browser tasks use Nudge’s existing `emit_scope` and `emit_step` custom functions in a `nudge` namespace. The extension validates proposed actions and enforces its existing permissions, then returns execution results as `function_call_output`. This does not use the unsupported hosted computer-use tool. Plan failures never switch to API billing.
- Voice calls and dictation still use the OpenAI API when ChatGPT plan text is selected, or the local voice stack when Ollama is selected. Plan tokens are not sent to Realtime, transcription, or speech.

## Manual check

1. In the side panel, confirm there is no Continue with ChatGPT button.
2. Open full-screen chat, then Account → ChatGPT, and connect an eligible Plus or Pro account.
3. Send a normal question and confirm the reply streams.
4. Stop a reply and confirm it does not continue.
5. Disconnect and confirm the next plan request asks you to connect again instead of using the API key.
6. Ask Nudge to open https://example.com and read its page title. Confirm it uses the ChatGPT plan and retains normal action confirmations.
7. Start a voice call and confirm the billing note still says voice uses separate API requests.

Live sign-in and a real plan-backed response require your ChatGPT account and the installed companion. Automated tests do not perform that live exchange.

## Browser tools support

Verified against the official preview limitations on 2026-10-18: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations. Namespaced function/custom tools are supported; native computer use, hosted MCP, and tool search are not. HTTP requests use `store: false`, `stream: true`, and explicit input history. Nudge reuses its API planner tool schemas and instructions; credentials remain in the companion, while execution remains in the extension.

Live verification on 2026-10-18 with the connected plan: the scope tool returned `origins: ["https://example.com"]` and `categories: ["read", "navigate"]`. Nudge opened a new tab and reported “The page title is ‘Example Domain.’” A subsequent text request returned “Text still works.” The first tool probe exposed a stream parser bug: tool items arrived in `response.output_item.done` while the terminal response had an empty output list. The parser now retains those items through `response.completed`; the regression test covers that exact event sequence.
