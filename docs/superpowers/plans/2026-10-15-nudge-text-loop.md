# Nudge Text Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable Chrome extension, paired local backend, and shop fixture that complete the verified text-driven iPhone search and filter flow.

**Architecture:** A React side panel owns orchestration and talks through typed Chrome messages to a content-script `PageAdapter`; a loopback Fastify server makes one structured OpenAI decision at a time. Reusable contracts, task state, policy, and verification live outside Chrome-specific code.

**Tech Stack:** TypeScript, pnpm workspaces, WXT, React, Tailwind CSS, Zustand, Zod, Fastify, OpenAI JavaScript SDK, Vitest, React Testing Library, Playwright, ESLint, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-15-nudge-mvp-design.md`

## Global Constraints

- Target current stable Chrome on macOS, Windows, and Linux.
- Use Manifest V3 and keep the side panel as orchestration owner.
- Keep Chrome APIs out of `packages/core` and provider secrets out of the extension.
- Bind the backend to loopback and require a pairing secret for every non-health API request.
- Execute one browser mutation at a time and re-observe before continuing.
- Never serialize full HTML or collect passwords, OTPs, payment-card fields, hidden inputs, cookies, or browser storage.
- Block purchases, transfers, trading, deletion, credential entry, CAPTCHA handling, and other irreversible actions.
- Use exact dependency versions verified from official documentation and package metadata before installation; commit `pnpm-lock.yaml`.
- Target under 100 ms for local snapshots, under 50 ms for messaging and policy, and under 150 ms for ordinary DOM mutations.

## Review Focus

- A page containing instructions aimed at Nudge must remain untrusted text; `packages/core/src/policy/prompt-injection.test.ts` pins this behavior.
- A valid element ID from an earlier document must fail after navigation; `apps/extension/src/content/page-adapter.test.ts` pins document-version rejection.
- Switching the active tab mid-task must not retarget execution; `apps/extension/src/orchestration/tab-binding.test.ts` pins the bound-tab invariant.
- A late provider response after Stop must not produce a mutation; `packages/core/src/orchestration/cancellation.test.ts` pins generation invalidation.
- A click that produces no relevant change must not become a success claim; `packages/core/src/verification/verify.test.ts` pins evidence requirements.

---

### Task 1: Workspace and verified toolchain

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/extension/package.json`
- Create: `apps/server/package.json`
- Create: `apps/fixtures/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/core/package.json`
- Create: `README.md`

**Interfaces:**
- Consumes: Node and pnpm installed on the development machine.
- Produces: workspace scripts `dev:extension`, `dev:server`, `dev:fixtures`, `build`, `typecheck`, `test`, and `test:browser`.

- [ ] **Step 1: Verify current stable package names, versions, peer requirements, Node support, WXT Manifest V3 guidance, and OpenAI SDK installation using official sources and package metadata; record the chosen versions in the task notes.**
- [ ] **Step 2: Create the root workspace manifests and package manifests with only dependencies assigned a concrete role in the spec.**
- [ ] **Step 3: Add shared TypeScript, ESLint, Prettier, ignore, and environment configuration; `.env.example` must contain `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `NUDGE_PAIRING_SECRET`, and `NUDGE_SERVER_URL`.**
- [ ] **Step 4: Install with `pnpm install`; expect a successful resolution and a new `pnpm-lock.yaml`.**
- [ ] **Step 5: Run `pnpm typecheck`; expect all empty package entry points to compile.**
- [ ] **Step 6: Commit with `git commit -m "chore: initialize Nudge workspace"`.**

### Task 2: Shared contracts

**Files:**
- Create: `packages/contracts/src/page.ts`
- Create: `packages/contracts/src/action.ts`
- Create: `packages/contracts/src/task.ts`
- Create: `packages/contracts/src/messages.ts`
- Create: `packages/contracts/src/provider.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Consumes: Zod.
- Produces: `PageSnapshotSchema`, `AgentDecisionSchema`, `BrowserActionSchema`, `TaskStateSchema`, `TaskEventSchema`, `ExtensionMessageSchema`, `AgentStepRequestSchema`, and `AgentStepResponseSchema`, plus inferred TypeScript types.

- [ ] **Step 1: Write failing schema tests for bounded snapshots, version-scoped element IDs, strict action variants, task generations, finish evidence, and rejection of unknown fields.**
- [ ] **Step 2: Run `pnpm --filter @nudge/contracts test`; expect failures because the schemas are absent.**
- [ ] **Step 3: Implement the schemas and exports with discriminated unions for `read_page`, `click`, `type_text`, `select_option`, `scroll`, `navigate_to_observed_url`, `wait_for_change`, `ask_user`, and `finish`.**
- [ ] **Step 4: Run the contracts tests and `pnpm typecheck`; expect both to pass.**
- [ ] **Step 5: Commit with `git commit -m "feat: define shared Nudge contracts"`.**

### Task 3: Core task state, policy, and verification

**Files:**
- Create: `packages/core/src/task/reducer.ts`
- Create: `packages/core/src/task/reducer.test.ts`
- Create: `packages/core/src/policy/evaluate-action.ts`
- Create: `packages/core/src/policy/evaluate-action.test.ts`
- Create: `packages/core/src/policy/prompt-injection.test.ts`
- Create: `packages/core/src/verification/verify.ts`
- Create: `packages/core/src/verification/verify.test.ts`
- Create: `packages/core/src/orchestration/cancellation.ts`
- Create: `packages/core/src/orchestration/cancellation.test.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: contracts from Task 2.
- Produces: `reduceTask(state, event): TaskState`, `evaluateAction(context, action): PolicyDecision`, `verifyOutcome(expectation, before, after, result): VerificationResult`, and `CancellationGate` with `generation`, `stop()`, and `assertActive(generation)`.

- [ ] **Step 1: Write failing reducer tests for start, modify-with-retained-constraints, clarify, cancel, resume, and navigation recovery.**
- [ ] **Step 2: Write failing policy tests for safe browsing, exact confirmation binding, stale confirmation, sensitive fields, observed URL enforcement, prompt injection, and blocked financial submission.**
- [ ] **Step 3: Write failing verification and cancellation tests covering no-effect clicks, read-back values, current evidence, repeated no-progress, and late results after Stop.**
- [ ] **Step 4: Run `pnpm --filter @nudge/core test`; expect failures for missing implementations.**
- [ ] **Step 5: Implement the minimal pure functions and cancellation gate; keep model output advisory and policy deterministic.**
- [ ] **Step 6: Run core tests and `pnpm typecheck`; expect all checks to pass.**
- [ ] **Step 7: Commit with `git commit -m "feat: add task policy and verification core"`.**

### Task 4: Paired loopback backend and provider settings

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/auth/pairing.ts`
- Create: `apps/server/src/providers/decision-provider.ts`
- Create: `apps/server/src/providers/openai-provider.ts`
- Create: `apps/server/src/providers/deterministic-provider.ts`
- Create: `apps/server/src/routes/health.ts`
- Create: `apps/server/src/routes/agent-step.ts`
- Create: `apps/server/src/routes/provider-settings.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: `AgentStepRequest` and `AgentStepResponse` from Task 2.
- Produces: `DecisionProvider.step(request, signal): Promise<AgentStepResponse>`, `GET /health`, `POST /api/agent/step`, `PUT /api/settings/provider-key`, and `DELETE /api/settings/provider-key`.

- [ ] **Step 1: Write failing Fastify injection tests for health, missing or invalid pairing secret, payload limits, rate limiting, schema errors, provider timeout, and redacted logs.**
- [ ] **Step 2: Write failing tests proving a session key overrides `OPENAI_API_KEY`, is never returned, and disappears with a new app instance.**
- [ ] **Step 3: Run `pnpm --filter @nudge/server test`; expect failures because routes and providers are absent.**
- [ ] **Step 4: Implement configuration, in-memory session-key storage, pairing guard, provider interface, and deterministic provider.**
- [ ] **Step 5: Implement the OpenAI Responses provider with strict tool schemas, Zod revalidation, configurable `OPENAI_AGENT_MODEL`, abort handling, and no silent model substitution.**
- [ ] **Step 6: Implement routes and bind production startup to `127.0.0.1`; disable sensitive body logging.**
- [ ] **Step 7: Run server tests and type checking; expect all checks to pass.**
- [ ] **Step 8: Commit with `git commit -m "feat: add paired local agent backend"`.**

### Task 5: DOM page adapter and executor

**Files:**
- Create: `apps/extension/src/content/document-version.ts`
- Create: `apps/extension/src/content/accessible-name.ts`
- Create: `apps/extension/src/content/snapshot.ts`
- Create: `apps/extension/src/content/element-registry.ts`
- Create: `apps/extension/src/content/executor.ts`
- Create: `apps/extension/src/content/change-observer.ts`
- Create: `apps/extension/src/content/page-adapter.ts`
- Create: `apps/extension/src/content/page-adapter.test.ts`
- Create: `apps/extension/src/content/executor.test.ts`

**Interfaces:**
- Consumes: `PageSnapshot`, `BrowserAction`, and `ActionResult` from Task 2.
- Produces: `PageAdapter.observe(options): Promise<PageSnapshot>`, `PageAdapter.execute(action, guard): Promise<ActionResult>`, and `PageAdapter.waitForChange(baseline, options): Promise<ChangeResult>`.

- [ ] **Step 1: Write failing DOM tests for visibility, accessible names, label association, disabled state, select options, viewport data, bounded truncation, Nudge exclusion, and sensitive-field exclusion.**
- [ ] **Step 2: Write failing executor tests for stale document IDs, removed targets, hidden or disabled targets, replace versus append, framework value setters, native events, observed URLs, and no-effect timeout.**
- [ ] **Step 3: Run the focused extension tests; expect failures because the adapter is absent.**
- [ ] **Step 4: Implement versioned element registration and bounded snapshot extraction.**
- [ ] **Step 5: Implement guarded actions and signal-driven change observation with bounded fallback timeouts.**
- [ ] **Step 6: Run extension unit tests and type checking; expect all checks to pass.**
- [ ] **Step 7: Commit with `git commit -m "feat: add DOM observation and action adapter"`.**

### Task 6: Manifest, permissions, messaging, and launcher

**Files:**
- Create: `apps/extension/wxt.config.ts`
- Create: `apps/extension/entrypoints/background.ts`
- Create: `apps/extension/entrypoints/content.tsx`
- Create: `apps/extension/src/messaging/runtime.ts`
- Create: `apps/extension/src/permissions/site-access.ts`
- Create: `apps/extension/src/launcher/Launcher.tsx`
- Create: `apps/extension/src/launcher/launcher.css`
- Create: `apps/extension/src/launcher/Launcher.test.tsx`

**Interfaces:**
- Consumes: `ExtensionMessageSchema` and `PageAdapter`.
- Produces: validated `sendExtensionMessage(message)` and launcher lifecycle `mountLauncher()` / `unmountLauncher()`.

- [ ] **Step 1: Verify current official Chrome documentation for `sidePanel`, `activeTab`, `scripting`, optional host permissions, content scripts, service-worker lifetime, and side-panel opening from user gestures.**
- [ ] **Step 2: Write failing tests for invalid messages, denied access, duplicate launcher prevention, SPA survival, dismiss-for-page, drag bounds, and cleanup.**
- [ ] **Step 3: Configure the minimal manifest and optional host permissions; do not request global host access.**
- [ ] **Step 4: Implement validated runtime messaging, temporary activation, explicit enable-on-site, and unsupported-page errors.**
- [ ] **Step 5: Implement the Shadow DOM launcher with supported side-panel behavior and toolbar fallback.**
- [ ] **Step 6: Run extension tests, type checking, and `pnpm --filter @nudge/extension build`; expect success.**
- [ ] **Step 7: Commit with `git commit -m "feat: add extension permissions and launcher"`.**

### Task 7: Side panel and orchestration loop

**Files:**
- Create: `apps/extension/entrypoints/sidepanel/index.html`
- Create: `apps/extension/entrypoints/sidepanel/main.tsx`
- Create: `apps/extension/src/state/use-nudge-store.ts`
- Create: `apps/extension/src/api/server-client.ts`
- Create: `apps/extension/src/orchestration/run-task.ts`
- Create: `apps/extension/src/orchestration/tab-binding.ts`
- Create: `apps/extension/src/orchestration/tab-binding.test.ts`
- Create: `apps/extension/src/orchestration/run-task.test.ts`
- Create: `apps/extension/src/components/SidePanel.tsx`
- Create: `apps/extension/src/components/Composer.tsx`
- Create: `apps/extension/src/components/Status.tsx`
- Create: `apps/extension/src/components/ActionHistory.tsx`
- Create: `apps/extension/src/components/ProviderSettings.tsx`
- Create: `apps/extension/src/components/SidePanel.test.tsx`
- Create: `apps/extension/src/styles/app.css`

**Interfaces:**
- Consumes: server endpoints from Task 4, messages from Task 6, and core functions from Task 3.
- Produces: `runTask(input, dependencies): TaskRunHandle`, whose handle exposes `stop()` and `done`; Zustand actions for send, stop, clear history, and session-key replacement.

- [ ] **Step 1: Write failing component tests for text send, natural statuses, persistent Stop during work, action-history collapse, clear history, provider-key replacement, and usable UI after provider failure.**
- [ ] **Step 2: Write failing orchestration tests for one mutation per observation, tab binding, stale document recovery, conditional-action invalidation, limits, AbortController cancellation, and late-response rejection.**
- [ ] **Step 3: Run focused tests; expect failures because the store, UI, and loop are absent.**
- [ ] **Step 4: Implement the server client, tab binding, Zustand store, and cancellation-aware orchestration loop.**
- [ ] **Step 5: Implement the accessible side-panel UI and provider settings; persist only allowed preferences and history.**
- [ ] **Step 6: Run component tests, orchestration tests, type checking, and extension build; expect success.**
- [ ] **Step 7: Commit with `git commit -m "feat: add text agent side panel"`.**

### Task 8: Shop fixture and complete text vertical slice

**Files:**
- Create: `apps/fixtures/src/shop/data.ts`
- Create: `apps/fixtures/src/shop/ShopApp.tsx`
- Create: `apps/fixtures/src/shop/ProductPage.tsx`
- Create: `apps/fixtures/src/main.tsx`
- Create: `apps/fixtures/index.html`
- Create: `apps/fixtures/vite.config.ts`
- Create: `tests/browser/fixtures.ts`
- Create: `tests/browser/nudge-shop.spec.ts`
- Create: `playwright.config.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the built extension, deterministic provider, and actual page adapter.
- Produces: shop routes with search, black and 256 GB filters, SPA result navigation, and one full-document product navigation.

- [ ] **Step 1: Write the failing Playwright flow for “Find an iPhone 16,” “Only black ones with 256GB,” opening the cheapest matching result, and retaining context across full navigation.**
- [ ] **Step 2: Add failure assertions for no-effect controls, cancellation before a delayed action, and a page prompt-injection string that cannot alter policy.**
- [ ] **Step 3: Run `pnpm test:browser`; expect failure because the fixture and integrated flow are incomplete.**
- [ ] **Step 4: Implement the general-purpose shop fixture without hidden automation commands.**
- [ ] **Step 5: Complete deterministic provider fixtures and integration wiring until the browser test uses the production snapshot, policy, executor, and verifier path.**
- [ ] **Step 6: Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:browser`; expect all checks to pass.**
- [ ] **Step 7: Perform a manual unpacked-extension text run against the shop fixture and record observed latency plus any unverified live-provider behavior in `README.md`.**
- [ ] **Step 8: Commit with `git commit -m "feat: complete verified text browsing loop"`.**

