# Architecture

Nudge is a Chrome extension plus a Fastify process on `127.0.0.1:4317`. The extension decides and performs browser actions. The server calls the selected model and stores local memory. Neither piece is a hosted service.

```
Side panel / full page
        │  Port "nudge-panel"
Background task controller
        │  observe, policy, execute, verify
Content script (DOM)  and  debugger (trusted input, screenshots)
        │
Local server ── OpenAI API, Ollama, or (via the companion) ChatGPT plan tokens
```

The task loop is: scope the instruction from your words, then observe, plan one tool call, check policy, execute, verify, and repeat. Stop, pause, and confirmation are handled in the controller, not by asking the model to ignore the next action.

Shared rules live in `packages/core` (policy, redaction, verification) and `packages/contracts` (Zod schemas). The server and the extension both validate tool calls.

There is no tool that evaluates model-written JavaScript. Debugger use is limited to mouse, keyboard, text insertion, and a screenshot on the attached tab.

The optional ChatGPT companion (`packages/chatgpt-host`) is a native-messaging host. It performs the open-source Sign in with ChatGPT exchange and calls the Responses API. The extension sends proposed actions and receives results. It does not receive OAuth tokens.

A longer tool list and the safety notes are in [browser-agent.md](browser-agent.md).
