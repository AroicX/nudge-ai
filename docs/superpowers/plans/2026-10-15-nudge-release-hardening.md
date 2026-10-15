# Nudge Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the settings and financial fixture flows, harden permissions and recovery, enforce latency and safety limits, and produce a reproducible unpacked-extension release.

**Architecture:** Extend the general adapter and orchestration path rather than adding fixture-specific commands. Acceptance tests exercise deterministic provider responses through the same contracts, policy, executor, and verifier used by live mode; release documentation separates automated, live-provider, and operating-system evidence.

**Tech Stack:** Existing Nudge workspace, Vitest, React Testing Library, Playwright, Chrome Manifest V3 build output.

**Spec:** `docs/superpowers/specs/2026-10-15-nudge-mvp-design.md`

## Global Constraints

- No fixture-only automation shortcuts or URL recognition in production code.
- No action may continue after cancellation acknowledgement.
- No uncertain mutation may replay after navigation, reload, disconnection, or service-worker suspension.
- Screenshot capture is optional, disclosed, justified, and disabled for sensitive workflows.
- The release must build from a clean checkout using documented commands.
- Reports must distinguish mocked automation, live-provider checks, and manual platform checks.

## Review Focus

- Very long labels, non-Latin text, emoji, empty results, and huge counts must not break snapshots or UI; fixture edge-case tests pin bounded rendering.
- SPA route churn must not duplicate launchers or reuse stale targets; lifecycle browser tests pin cleanup and versioning.
- A confirmation must expire when target, parameters, document, or task generation changes; policy integration tests pin exact binding.
- Backend restart must clear a session-only user key and produce a recoverable setup state; settings integration tests pin key lifetime.
- Slow or silent pages must terminate within configured no-progress limits without repeated clicks; timeout browser tests pin recovery.

---

### Task 1: Settings fixture and safe form preparation

**Files:**
- Create: `apps/fixtures/src/settings/SettingsApp.tsx`
- Create: `apps/fixtures/src/settings/ProfileForm.tsx`
- Create: `apps/fixtures/src/settings/ConfirmationDialog.tsx`
- Create: `tests/browser/nudge-settings.spec.ts`

**Interfaces:**
- Consumes: production snapshot, action, confirmation, and verification paths.
- Produces: an SPA settings site with navigation, editable non-sensitive fields, account-change confirmation, and hostile/edge-case content.

- [ ] **Step 1: Write the failing browser test for navigating to profile settings, filling supplied non-sensitive information, verifying read-back values, and stopping before an account-changing confirmation.**
- [ ] **Step 2: Add assertions for ambiguous navigation labels, very long content, non-Latin labels, prompt injection, and a confirmation invalidated by route change.**
- [ ] **Step 3: Implement the fixture without hidden automation hooks.**
- [ ] **Step 4: Run the settings browser tests; expect success through the general adapter.**
- [ ] **Step 5: Commit with `git commit -m "test: add settings acceptance fixture"`.**

### Task 2: Financial fixture and irreversible-action block

**Files:**
- Create: `apps/fixtures/src/finance/FinanceApp.tsx`
- Create: `apps/fixtures/src/finance/TransferForm.tsx`
- Create: `tests/browser/nudge-finance.spec.ts`
- Modify: `packages/core/src/policy/evaluate-action.test.ts`

**Interfaces:**
- Consumes: production policy and page adapter.
- Produces: a fake financial site where Nudge may navigate to and prepare a transfer form but cannot submit it.

- [ ] **Step 1: Write failing browser assertions that opening and preparing the transfer form is allowed while every submit path remains blocked.**
- [ ] **Step 2: Add policy tests for misleading button text, Enter-key submission implications, form-associated buttons, and changed amount or recipient invalidating confirmation.**
- [ ] **Step 3: Implement the fixture and any minimal general policy corrections exposed by the tests.**
- [ ] **Step 4: Run core and finance browser tests; expect all submit attempts to be blocked with a truthful explanation.**
- [ ] **Step 5: Commit with `git commit -m "test: enforce financial submission boundary"`.**

### Task 3: Lifecycle, permission, and persistence hardening

**Files:**
- Create: `apps/extension/src/lifecycle/recovery.ts`
- Create: `apps/extension/src/lifecycle/recovery.test.ts`
- Create: `apps/extension/src/storage/persistence.ts`
- Create: `apps/extension/src/storage/persistence.test.ts`
- Create: `tests/browser/nudge-lifecycle.spec.ts`
- Modify: `apps/extension/src/permissions/site-access.ts`
- Modify: `apps/extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: task metadata, document identity, cancellation generation, optional host permission state.
- Produces: `loadRecoverableTask()`, `persistRecoverableTask(metadata)`, `validateRecovery(snapshot, metadata)`, and explicit permission recovery states.

- [ ] **Step 1: Write failing unit tests proving only minimal metadata persists and uncertain mutations never replay.**
- [ ] **Step 2: Write failing browser tests for SPA route churn, full reload, service-worker restart simulation, access revocation, active-tab switch, and duplicate-launcher prevention.**
- [ ] **Step 3: Implement bounded persistence, recovery validation, permission-state reconciliation, and lifecycle cleanup.**
- [ ] **Step 4: Run lifecycle tests, type checking, and extension build; expect success.**
- [ ] **Step 5: Commit with `git commit -m "feat: harden extension lifecycle recovery"`.**

### Task 4: Limits, performance instrumentation, and optional visual fallback

**Files:**
- Create: `packages/core/src/orchestration/limits.ts`
- Create: `packages/core/src/orchestration/limits.test.ts`
- Create: `packages/core/src/telemetry/timing.ts`
- Create: `packages/core/src/telemetry/timing.test.ts`
- Create: `apps/extension/src/observation/screenshot-fallback.ts`
- Create: `apps/extension/src/observation/screenshot-fallback.test.ts`
- Modify: `apps/extension/src/orchestration/run-task.ts`
- Modify: `apps/extension/src/components/ActionHistory.tsx`

**Interfaces:**
- Consumes: task events and orchestration steps.
- Produces: configurable action, duration, repeated-action, no-progress, and recovery limits; `TimingSpan` records without sensitive payloads; disclosed screenshot fallback eligibility.

- [ ] **Step 1: Write failing tests for maximum actions, total duration, repeated actions, no-progress, recovery attempts, and a useful limit explanation.**
- [ ] **Step 2: Write failing timing tests for snapshot, provider, policy, execution, and verification spans without transcript or snapshot content.**
- [ ] **Step 3: Write failing screenshot tests for explicit justification, sensitive-workflow denial, permission denial, cancellation, and disclosure event.**
- [ ] **Step 4: Implement limits, timing instrumentation, action-history latency display, and the optional guarded fallback.**
- [ ] **Step 5: Run all affected tests and record fixture latency against the approved targets.**
- [ ] **Step 6: Commit with `git commit -m "feat: add execution limits and latency tracing"`.**

### Task 5: Full acceptance suite and release documentation

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/manual-verification.md`
- Create: `docs/known-limitations.md`
- Create: `docs/future-embed.md`
- Create: `docs/test-results.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all implemented applications, packages, fixtures, and tests.
- Produces: reproducible setup/build scripts, unpacked-extension instructions, architecture and reuse notes, platform checklist, and truthful test report.

- [ ] **Step 1: Run formatting and linting across the workspace; fix only reported project issues.**
- [ ] **Step 2: Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:browser`; record exact command results in `docs/test-results.md`.**
- [ ] **Step 3: Run live OpenAI text and realtime voice flows with configured credentials; record exact successes, failures, timings, model IDs, and unverified behavior.**
- [ ] **Step 4: Complete available Chrome manual checks and mark macOS, Windows, and Linux rows individually as verified or pending—never infer one platform from another.**
- [ ] **Step 5: Document setup, backend pairing, default key, session-only BYOK, microphone recovery, permissions, unpacked loading, supported capabilities, limitations, and troubleshooting.**
- [ ] **Step 6: Document core reuse boundaries for the future business embed and the deferred `DecisionProvider` slot for possible Jev evaluation.**
- [ ] **Step 7: From a clean checkout, repeat install, test, build, server startup, fixture startup, and unpacked-extension loading instructions; correct any mismatch.**
- [ ] **Step 8: Commit with `git commit -m "docs: prepare Nudge MVP release"`.**

