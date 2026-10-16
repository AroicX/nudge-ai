# Browser Agent Main Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the conversational voice/UI work and the general-browser-agent implementation into `main`, resolve regressions, and produce a verified Chrome extension build.

**Architecture:** Merge `feat/general-browser-agent` into `feat/browser-use` so the background-hosted general agent remains the execution authority while retaining the newer Realtime voice and UI behavior. After resolving conflicts against the approved browser-agent documents, merge the integrated branch into `main` and verify the resulting tree.

**Tech Stack:** TypeScript, React, Chrome Manifest V3/WXT, Fastify, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-15-general-browser-agent-design.md`

## Global Constraints

- Preserve both text and Realtime voice entry into the background `TaskController`.
- Browser mutations remain policy-checked, scheduled, and verified in the service worker.
- Keep API keys server-side and keep sensitive values out of observations, logs, and storage.
- Preserve all user-authored documents and assets from both branches.
- Do not claim live-site behavior beyond the verification evidence.

## Review Focus

- Side-panel voice and text must both reach the background controller after conflict resolution.
- Realtime session creation must use OpenAI-supported fields and the root `.env` development workflow.
- The background/content message bridge must survive navigation and service-worker lifecycle changes.
- Manifest permissions must support browser-wide work without exposing credentials.
- Acceptance tests must not hide intermittent failures or depend on live OpenAI calls.

---

### Task 1: Integrate feature histories

**Files:**
- Merge: `feat/general-browser-agent` into `feat/browser-use`
- Resolve: all overlapping application, test, configuration, and documentation files

**Interfaces:**
- Consumes: general-agent `TaskController`/Port architecture and current Realtime voice/UI implementation.
- Produces: one coherent `feat/browser-use` history containing both feature lines.

- [ ] **Step 1:** Merge `feat/general-browser-agent` into `feat/browser-use` and inventory every conflict.
- [ ] **Step 2:** Resolve conflicts using the approved general-browser-agent spec as authority while retaining supported Realtime behavior.
- [ ] **Step 3:** Run focused tests for every conflicted subsystem.
- [ ] **Step 4:** Commit the merge resolution.

### Task 2: Diagnose and repair integrated regressions

**Files:**
- Modify/Test: only files implicated by failing lint, type-check, unit, build, or acceptance evidence.

**Interfaces:**
- Consumes: integrated feature tree from Task 1.
- Produces: green unit/type/build checks and the strongest available browser acceptance evidence.

- [ ] **Step 1:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and capture exact failures.
- [ ] **Step 2:** For each failure, add or identify a reproducing test, fix the root cause, and rerun the focused test.
- [ ] **Step 3:** Run `pnpm test:accept`; diagnose and fix reproducible integration bugs.
- [ ] **Step 4:** Re-run the full verification suite and commit fixes.

### Task 3: Update main and produce the plugin

**Files:**
- Merge: integrated `feat/browser-use` into `main`
- Build output: `apps/extension/.output/chrome-mv3`

**Interfaces:**
- Consumes: verified integrated branch.
- Produces: updated local `main` and load-unpacked Chrome extension bundle.

- [ ] **Step 1:** Merge the verified integrated branch into `main`.
- [ ] **Step 2:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` on `main`.
- [ ] **Step 3:** Inspect the generated manifest and bundle contents.
- [ ] **Step 4:** Report verification counts, acceptance limitations, branch state, and the extension output path.
