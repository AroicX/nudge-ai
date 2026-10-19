# Security

Nudge can click, type, and navigate websites in the browser profile where it is installed. Treat a task instruction the way you would treat handing the mouse to another person who can see the page.

## Browser-agent risks

- A model can choose the wrong control. Confirmation covers bulk and consequential actions that the policy classifies that way. It does not review every click.
- Page content is untrusted. Planner instructions say that text on a page, in an email, or in a document is data, not a new command. That is a prompt rule plus policy checks, not a guarantee that a model will ignore a hostile page.
- The extension can read ordinary `http` and `https` pages. That access is required for cross-tab tasks. It is not limited to the tab you clicked.
- `debugger` is attached to the task tab when a page needs real input or a screenshot. Chrome shows a debugging bar while it is attached. Nudge detaches when the step ends. A crash can leave Chrome’s bar up until you close it.
- The local backend listens on `127.0.0.1:4317` and checks a pairing secret sent by the extension. The secret is compiled into the extension build. Other software on this computer that can read the extension files can call the backend.
- An older `.env.example` committed in `a40a7ba` contained a sample pairing value. Deleting it from the current file does not remove it from history. It is not an API key. If you used that sample as your real pairing secret, generate a new one and rebuild. History was not rewritten.
- The scripted planner is for tests. The server refuses it when `NODE_ENV=production`.

## Credentials

- The OpenAI API key stays in `.env` or in the server process. It is not a `WXT_PUBLIC_` variable and is not written into the extension bundle.
- A key typed into Provider settings lives in server memory until that process exits.
- ChatGPT plan tokens, when you connect, stay in the native-messaging companion under your user data directory. The extension does not receive the access token, refresh token, or ID token.
- There is no Google OAuth client in this repository. Calendar work uses the calendar website you are already signed into.
- Passwords and payment fields are blocked. Observation redacts long token-like strings and digit strings near words such as “code” or “otp”. That redaction is heuristic. Do not assume every secret on a page is removed.
- Task history in `chrome.storage.local` is meant to exclude raw snapshots, API keys, passwords, one-time codes, cookies, and payment fields. Clear history in the panel to delete what was stored.

## Reporting a vulnerability

Email [aroicx@gmail.com](mailto:aroicx@gmail.com). Do not open a public GitHub issue for a vulnerability.

Include the Nudge version, the component, and a minimal reproduction. Omit live keys, tokens, and personal page content.
