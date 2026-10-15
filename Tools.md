Implement the Nudge MVP using the following technical stack. This supplements the existing product and architecture requirements.

Nudge is a consumer Chrome extension that accepts voice or text, understands the current website, performs permitted browser actions, and verifies the results. The business website embed comes after this MVP.

## 1. Stack and dependency rules

Use:

- TypeScript throughout.
- pnpm workspaces for the repository.
- WXT for the Manifest V3 extension.
- React and React DOM for the side panel and floating launcher.
- `@wxt-dev/module-react` for React integration.
- Tailwind CSS for UI styling.
- `lucide-react` for icons.
- Zustand for UI and active-task state.
- Zod for runtime validation and shared contracts.
- Fastify for the local backend.
- The official `openai` JavaScript SDK for OpenAI API calls.
- Vitest for unit and integration tests.
- React Testing Library for component behavior.
- Playwright for fixture-site browser tests and extension testing where supported.
- ESLint and Prettier for code consistency.

Verify current package names, supported versions, peer dependencies, and official installation instructions before installing. Use mutually compatible stable versions and commit the lockfile.

Do not install dependencies merely because they appear in this prompt. Each dependency must have a working role.

Do not introduce LangChain, a vector database, Redis, a hosted workflow engine, or multiple agent frameworks for this MVP.

## 2. Repository layout

Use a small workspace with approximately:

apps/
  extension/
  server/
  fixtures/

packages/
  core/
  contracts/

Core responsibilities:

- Intake and task state.
- Agent orchestration.
- Action policy.
- Verification.
- Provider-independent interfaces.

Contracts responsibilities:

- Zod schemas.
- Typed extension messages.
- Page snapshots.
- Actions and results.
- Task events.

Keep Chrome APIs out of the reusable core.

## 3. OpenAI integration

Use the official `openai` package on the backend.

Use the Responses API for intake, planning, and interpreting fresh page observations.

Use function calling with explicit strict schemas for browser actions. Validate every returned action again with Zod before dispatch.

Disable parallel browser mutations. Execute one action, inspect the result, and then decide the next action.

Do not assume schema validation makes an action safe. Apply independent policy and target checks.

Use a currently supported model with function calling and adequate reasoning. Select and document the exact model after checking official documentation and account availability.

Keep it configurable:

OPENAI_AGENT_MODEL=

Do not hardcode an unverified model ID or silently substitute one.

Do not use hosted web search to control the user’s active tab. The extension’s page adapter supplies the actual page state.

Do not assume OpenAI function calling operates the browser automatically. Our code implements every tool and executes approved actions.

## 4. Voice: initial MVP

Use this pipeline:

Microphone → recorded audio → backend transcription → intake and agent loop → verified response text → optional generated speech.

Use native browser APIs:

- `navigator.mediaDevices.getUserMedia`.
- `MediaRecorder`.
- `MediaRecorder.isTypeSupported`.
- HTML audio playback.
- `AbortController`.

Choose the recording MIME type dynamically. Verify that the selected format is accepted by the transcription endpoint.

Capture microphone audio in the extension’s side-panel document, not a content script or service worker.

Implement and test the actual extension microphone-permission flow. If Chrome requires a dedicated extension onboarding page to obtain permission reliably, provide it.

Use the OpenAI Audio API through the backend:

- Transcription: `gpt-4o-mini-transcribe`.
- Speech synthesis: `gpt-4o-mini-tts`.

Verify these model IDs remain supported before implementation, and expose configuration overrides:

OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts

For speech output:

- Let the user mute it.
- Keep responses short.
- Play only user-facing text, never internal planning.
- Clearly identify the voice as AI-generated.
- Stop playback on cancellation.
- Release object URLs and media resources.
- Avoid microphone feedback by not recording during playback.

Provide text input even when microphone access or transcription fails.

Do not use browser SpeechRecognition as the primary transcription dependency.

Do not add separate Deepgram, ElevenLabs, or other speech providers to the initial build.

## 5. Realtime voice: prepared boundary, later implementation

Design a VoiceTransport interface so the push-to-talk implementation can later be replaced or supplemented by OpenAI Realtime.

Do not build two complete voice systems in the initial MVP.

The future Realtime option should use:

- OpenAI Realtime API.
- WebRTC in the extension’s browser document.
- The official OpenAI Agents SDK where appropriate.
- `RealtimeAgent` and `RealtimeSession` from the documented `@openai/agents/realtime` import path.
- Server-created short-lived client secrets.

Verify the package installation instructions separately from the import path. Do not assume every import path is a separately installable npm package.

Standard OpenAI API keys stay on the server. A future Realtime client receives only the required short-lived credential.

Realtime voice must send browser operations through the same action policy and executor as text input. It must not create another execution path that bypasses validation or cancellation.

For now, document this interface and extension point. Do not install the Agents SDK until this transport is implemented.

## 6. Chrome capabilities

Use native Chrome extension APIs:

- `chrome.sidePanel` for the main conversation interface.
- `chrome.scripting` for content-script injection.
- `chrome.runtime` for extension messaging.
- `chrome.tabs` for tab identity, navigation events, and permitted screenshot capture.
- `chrome.storage.local` for minimal settings and recoverable state.
- `chrome.permissions` for optional site access.

Start with `activeTab`, `scripting`, `sidePanel`, and `storage` where actually needed.

Define optional host permissions for explicit “Enable on this site” requests. Verify exact manifest and runtime request requirements against current documentation.

Request screenshot or broader tab capabilities only when required. Do not add `debugger` permission for the initial MVP.

Use content scripts to inspect and interact with website DOM elements.

Do not use Puppeteer, Playwright, or Selenium as the production browser-control engine. Playwright is a development and testing dependency.

Do not attach a remote debugging port to the user’s browser.

## 7. DOM observation and actions

Use native browser primitives:

- `querySelectorAll`.
- Element labels and ARIA attributes.
- `getBoundingClientRect`.
- `getComputedStyle`.
- `MutationObserver`.
- `ResizeObserver` when useful.
- Native DOM events.
- Native form element value setters where necessary.
- `URL` for destination validation.
- `crypto.randomUUID` for task and message identifiers.

Consider `dom-accessibility-api` for computing accessible names and descriptions. If used, verify it behaves correctly in a browser bundle.

Use a bounded, task-relevant snapshot. Do not serialize the entire DOM.

Track element references with ephemeral IDs and document versions.

Support these tools:

- read_page
- click
- type_text
- select_option
- scroll
- navigate_to_observed_url
- wait_for_change

Handle ask_user and finish as agent control decisions.

The model provides structured arguments. It never supplies executable JavaScript.

Website content is untrusted data. Do not render it as unsanitized HTML or treat it as system instructions.

## 8. Floating launcher and isolation

Use WXT’s documented content-script UI utilities if suitable.

Mount the floating button in Shadow DOM to isolate styles.

Keep the side panel as the long-lived visible interaction surface. Closing it must stop recording and safely stop or pause the task; clearly document the behavior.

Use typed `chrome.runtime` messages validated with shared Zod schemas.

A third-party messaging library is unnecessary unless native messaging becomes demonstrably inadequate.

Content scripts should perform short observation and action requests. They should not own model credentials or the entire agent loop.

## 9. Backend packages

Use:

- `fastify`.
- `@fastify/cors`.
- `@fastify/rate-limit`.
- `@fastify/multipart` for audio uploads.
- `openai`.
- `zod`.
- `dotenv` if required by the runtime.
- `tsx` for local TypeScript development.

Use Fastify’s built-in logging, with sensitive payload logging disabled.

Implement endpoints approximately equivalent to:

- GET /health
- POST /api/agent/step
- POST /api/audio/transcribe
- POST /api/audio/speech

The agent-step request includes a bounded task context and fresh page snapshot. It returns one validated decision.

Do not create a new model conversation from scratch without preserving the task’s relevant history. Follow the selected API’s documented handling of tool outputs and response state.

Bind the development server to loopback.

Implement pairing authentication or an equivalent local access guard. Restrict callers, enforce payload limits, and validate all input. Do not rely solely on CORS or an Origin header as authentication.

Enforce audio duration, upload size, model request timeout, and request-rate limits.

Never put OPENAI_API_KEY in the extension bundle.

## 10. Cancellation and task coordination

Use AbortController for network cancellation.

Use a task ID plus cancellation generation/version on every request and browser action.

The side panel owns the active orchestration loop for the MVP. The service worker handles short extension coordination events and must not be assumed to stay alive.

Before every mutation, confirm:

- Task is still active.
- Tab and document match.
- Element target is current.
- Policy permits the action.
- Required confirmation is still valid.

Ignore late responses from stopped or superseded tasks.

Do not replay actions whose outcome is uncertain after a reload or disconnection.

## 11. State and persistence

Use Zustand for in-memory UI state.

Use `chrome.storage.local` for selected preferences and minimal recoverable task metadata.

Do not add a database for this rough MVP.

Keep raw audio transient and discard it after transcription.

Provide a clear-history control.

Do not persist page snapshots or sensitive form contents by default.

## 12. Tests and development tools

Use:

- Vitest for intake, schemas, policy, cancellation, and task transitions.
- React Testing Library for composer, microphone states, confirmations, and Stop behavior.
- Playwright for DOM fixtures, navigation, and execution verification.
- A real unpacked Chrome extension manual check for microphone, permissions, side panel, and service-worker behavior.

Verify current Playwright extension-testing support and use a supported persistent browser context where appropriate.

Mock provider responses for deterministic automated tests. Keep live-provider mode real and separate.

Do not treat mocked tests as evidence that live voice or live agent execution works.

## 13. MCP, WebMCP, and plugins

No MCP server is required for the consumer MVP.

No website owner needs to install a plugin.

Do not introduce Chrome DevTools MCP as a runtime dependency. It may help developers test the project if available, but end users must not need it.

Do not require a WebMCP browser flag.

Define a future capability-provider interface so website-exposed tools can later supplement DOM actions.

The later business embed should reuse:

- Intake.
- Task contracts.
- Conversation state.
- Action policy.
- Planning.
- Verification.
- Voice interface.

Its page adapter may invoke registered frontend actions instead of generic DOM interactions.

Do not implement that adapter now.

## 14. Configuration and scripts

Provide an .env.example containing:

OPENAI_API_KEY=
OPENAI_AGENT_MODEL=
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
NUDGE_PAIRING_SECRET=

Include a public extension configuration value for the local backend URL. Clearly distinguish public configuration from secrets.

Provide working scripts for:

- Extension development.
- Server development.
- Fixture startup.
- Production extension build.
- Type checking.
- Unit tests.
- Browser tests.

Write exact setup and unpacked-extension loading instructions.

## 15. Finish criteria

Deliver a real working vertical slice:

1. Load Nudge into Chrome.
2. Activate it on the local shop fixture.
3. Speak “Find an iPhone 16.”
4. Transcribe using the real OpenAI Audio API.
5. Plan using the real OpenAI Responses API.
6. Execute through content-script tools.
7. Observe and verify the changed page.
8. Show the result and optionally speak it.
9. Accept “Only the black ones.”
10. Apply the follow-up while retaining the original goal.
11. Stop immediately when requested.

Report installed versions, chosen model, checks performed, and any live functionality that remains unverified.

Prioritize this complete flow before expanding capabilities.