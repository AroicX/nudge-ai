# Privacy

This describes what the current alpha does with data. It is not a promise that information never leaves your computer.

## In the browser

The extension reads pages you can already open, runs actions in those tabs, and stores a bounded chat and task history in `chrome.storage.local` (up to about 1 MB and 200 turns). History is sanitized before it is saved. Clearing history removes the persisted copy and the in-memory copy.

Screenshots used for a visual step are sent to the planner for that step when the selected model can accept images. Chat images are downscaled before they are sent. Saved chat history keeps a small thumbnail, not the full image.

Microphone audio is captured only after you allow it on Nudge’s setup page. The track is stopped after the permission check. Later dictation or calls capture audio again while they are active.

Scheduled tasks store the instruction, source URL, provider name, and run time on this device.

## On the local backend

The Fastify server binds to `127.0.0.1:4317`. The extension authenticates with the pairing secret.

SQLite holds saved chats, profile facts you keep, and text extracted from documents you upload. On macOS the default file is `~/Library/Application Support/Nudge/nudge.sqlite`. On Linux it is `~/.local/share/nudge`. Set `NUDGE_DATA_DIR` to move it. The database is local and is not application-level encrypted.

Document parsing (PDF, DOCX, TXT, Markdown) runs in that local process. Original upload bytes are kept when a file must be attached to a form later.

Server logs, when enabled, redact the pairing header, the Authorization header, and request bodies. Logging is off unless the process is started with logging turned on.

Deleting a profile fact does not delete the chat message it came from. Delete or clear that chat as well. Deleting a document removes its stored text and search entry.

## At an AI provider

- **OpenAI API:** planning, chat, transcription, speech, and realtime voice send the content of that request to OpenAI. You pay API rates. Page excerpts, profile facts, and document excerpts included in the request are part of it.
- **Ollama:** requests go to the base URL you set, default `http://127.0.0.1:11434`. A local daemon keeps inference on this computer. If you point Ollama at another machine, data goes there.
- **Local voice:** with the optional local stack, dictation and calls use local Whisper, a local chat model, and Kokoro. They do not use the ChatGPT plan token.
- **ChatGPT plan:** after you connect, eligible full-screen text and browser-planning requests go to `https://api.openai.com/v1/responses` with `store: false` and `stream: true`. The companion holds the tokens. Nudge does not import ChatGPT conversation history. Usage limits are ChatGPT’s; Nudge does not invent a remaining quota. Voice is not sent on this path.

If an Ollama browser step fails, Nudge can ask to use OpenAI for that task. It does not switch a ChatGPT-plan request onto API billing by itself.

## Telemetry

There is no remote analytics product in this alpha. Settings can opt into local timing and token diagnostics on this computer. Those diagnostics are not shipped to a Nudge server, because there is no Nudge server beyond the process you start.

## Retention

Data remains until you delete the chat, fact, document, or scheduled job, clear extension history, or delete the SQLite directory and the extension’s Chrome storage. Uninstalling the extension does not delete the SQLite file.
