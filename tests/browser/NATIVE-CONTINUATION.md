# Native side-panel continuation regression

Run explicitly after building the extension:

```sh
pnpm --filter @nudge/extension build
node tests/browser/native-continuation.mjs
```

Requires Playwright Chromium with extension/side-panel support (`pnpm exec playwright install chromium`). Set `CHROME_EXECUTABLE` to use another compatible Chromium binary.

The check launches a disposable browser profile and copies the production build to a temporary directory. Only the copied backend URL changes to an ephemeral localhost mock server. No existing profile, SQLite database, provider setting, or model server is used. The destination is a local fixture. Model endpoints reject requests and the check asserts zero inference requests. This is a browser/UI regression, not an Ollama or SQLite integration test.

It exercises a real full-page Send with no linked source, deterministic destination navigation, Chrome's actual native side panel, shared chat/history, follow-up composer requests for zoom/reset and pin/unpin, shared light/dark appearance, and follow-latest scrolling with a manual-reading escape and jump button. If Chrome exposes native split view, it creates exactly two fixture tabs and verifies their shared split ID. The browser is headless; fullscreen and screen/window placement are not checked.

The native panel is absent from Playwright's page list. The check discovers its CDP target, verifies Chrome reports a `SIDE_PANEL` context, and interacts with the actual panel through CDP input events. Desktop/mobile empty-state and full-page/native-panel light/dark screenshots are saved under `test-results/native-continuation/`. Temporary build, profile, and mock server are cleaned up when the run ends.
