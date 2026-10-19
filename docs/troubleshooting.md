# Troubleshooting

## The toolbar icon does nothing

Open an `http` or `https` page first. Chrome will not open the side panel from a `chrome://` page. Then reload the extension at `chrome://extensions` and click the icon again.

## The extension cannot reach the backend

The server must be running with `pnpm start:server`, and both pairing variables in `.env` must match the values used at build time. Rebuild the extension after changing `WXT_PUBLIC_NUDGE_PAIRING_SECRET`. The server only accepts `127.0.0.1` or `localhost`.

## A task keeps running after I close the panel

The task lives in the background service worker. Open the panel and press Stop, or click the toolbar icon and stop it there.

## Planner changes do not show up

Restart `pnpm start:server`. A dev server restart also drops the current task. Reload the extension after an extension rebuild.

## OpenAI requests fail immediately

`OPENAI_API_KEY` is empty or rejected. The key is read by the server, not by the extension. Provider settings can replace it until the process exits.

## Ollama is selected and the task stops

Ollama must already be running at `http://127.0.0.1:11434` with a pulled model that supports tools. Nudge does not download one. Refresh models in Provider settings. If the model returns an invalid decision, the task stops before it acts.

## Voice does not start

The first use opens a microphone setup page. Chrome requires a click on **Allow microphone**. With Ollama selected, install the [local voice stack](local-voice.md) first. With OpenAI selected, voice is billed as API usage, including when ChatGPT plan text is selected.

## ChatGPT plan does not appear

The control is only in full-screen chat, under Account → ChatGPT. Install the companion for this extension ID, as described in [chatgpt-plan.md](chatgpt-plan.md). The side panel does not show it.

## Chrome says Nudge is debugging the browser

A visual or trusted-input step attached the debugger to that tab. It should detach when the step finishes. If a task crashed, dismiss Chrome’s bar or reload the extension.

## Spreadsheet cells keep changing in one cell

Reload the extension and restart the server so the spreadsheet instruction is loaded. Nudge should type once, then Tab to the next column or Enter to the next row. The name box (A1) is not a place to type values. This is still best-effort on Google Sheets.

## Where data is

macOS: `~/Library/Application Support/Nudge/nudge.sqlite`. Linux: `~/.local/share/nudge`. ChatGPT companion files, if installed, are under `~/Library/Application Support/Nudge/chatgpt/` on macOS.
