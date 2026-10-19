# Release candidate 0.1.0-alpha.1

Review only. Nothing in this candidate has been published, pushed, or submitted to the Chrome Web Store.

Package and manifest version: `0.1.0`. Release name: `0.1.0-alpha.1`. Chrome’s manifest version must be 1–4 integers, so the prerelease label stays in the release name.

## What changed

Release files added or updated for a public alpha: `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `PRIVACY.md`, `CODE_OF_CONDUCT.md`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `docs/architecture.md`, `docs/troubleshooting.md`, `docs/roadmap.md`, `docs/community/labels.md`, issue and pull-request templates, `.github/workflows/ci.yml`, `.gitleaks.toml`, `.env.example`, `.gitignore`, and `scripts/package-alpha.sh`.

Workspace package versions moved from `0.0.0` to `0.1.0`. The root package stays `private: true`.

Extension typecheck now runs `wxt prepare` first, so a clean checkout can typecheck. When no pairing value is set, that command uses the placeholder `typecheck-loopback-pairing`. It is not an API key and is not the secret in the release zip.

`pnpm test` runs workspace packages one at a time. Parallel Vitest workers were deleting a shared cache directory and failing the run.

Existing uncommitted product work (documents, launcher, task completion, spreadsheet movement, typing policy, history) was left in place.

## Checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` in this checkout | Passed (pnpm 11.1.3, lockfile already satisfied) |
| Clean copy in `/tmp/nudge-alpha-clean` (no `.git`, `.env`, `node_modules`, or `release/`) | `pnpm install --frozen-lockfile`, `pnpm typecheck`, and production extension build passed |
| `pnpm typecheck` in this checkout, before the `wxt prepare` script change | Passed |
| `pnpm test` (serial) | Passed: contracts 36, core 122, extension 468, server 137, chatgpt-host 13. Fixtures package has no test files |
| Gitleaks 8.30.1, `git --config .gitleaks.toml --redact`, 71 commits | `no leaks found` |
| Production extension build | Passed. See artifacts below |
| Live OpenAI, Ollama, ChatGPT sign-in, microphone, or a real website task | Not run. Not passed |

The first parallel `pnpm test` failed with `ENOTEMPTY` on `node_modules/.vitest-cache`. The serial rerun passed. CI uses the serial script.

## Artifacts

Gitignored directory `release/0.1.0-alpha.1/`:

- `unpacked/` — load this in `chrome://extensions`
- `nudge-chrome-0.1.0-alpha.1.zip`
- `SHA256SUMS` — `eb8c3856dde849fe887add38b0dc2ebd01af532d5a668e439b83cf7b8689c0bf`
- `PAIRING.txt` — mode `600`. Not inside the zip. The same value is compiled into the unpacked JavaScript (4 occurrences). It does not match this machine’s `.env`

`apps/extension/.output/chrome-mv3` was rebuilt afterward with the pairing value already in `.env`, so the loaded local extension still matches the local server. That output is not the release zip.

The zip has no `.env`, SQLite files, or `PAIRING.txt`. A scan of the unpacked text found no `sk-` keys, GitHub tokens, private keys, `refresh_token`, `eval(`, or `new Function`.

Regenerate the pairing secret before any public binary. The zip alone does not run tasks.

## Provider paths

Included:

- Server OpenAI API key and a key typed into Provider settings (server memory until the process exits).
- Ollama at `127.0.0.1:11434`.
- ChatGPT plan connection through the documented local open-source Sign in with ChatGPT flow (`docs/chatgpt-plan.md`). Preview only. Not a commercial or hosted deployment. Voice does not use this path.

Not implemented, so not shipped: Google OAuth, session-cookie extraction, and a consumer ChatGPT token copied out of the browser.

Public OAuth client registration for Sign in with ChatGPT is dynamic client registration, not a checked-in client secret.

## Remaining blockers before publication

- Confirm the copyright line. `LICENSE` says `Copyright (c) 2026 Aroicx` because that is the Git author handle. It is not a confirmed legal name.
- No private vulnerability contact. GitHub private vulnerability reporting is not enabled because the repository is not public. `SECURITY.md` says how to turn it on. Do not invent an email.
- `CODE_OF_CONDUCT.md` has no enforcement contact.
- Commit `a40a7ba` still contains the old `.env.example` pairing sample. Removing it from the working tree is not enough. It is not an API key. Rotate it if it was ever used for real, and decide whether to rewrite history. History was not rewritten here.
- Windows SQLite paths are untested.
- Live provider, voice, and website checks were not run.
- `jszip` is `MIT OR GPL-3.0-or-later`. This candidate elects MIT. That is a choice to confirm, not a scanner clearance.
- The Gitleaks GitHub Action is under a commercial EULA, so CI downloads the MIT-licensed Gitleaks 8.30.1 binary and checks the published SHA-256.
- These files are uncommitted. Nothing was pushed.

## Local commands

```sh
pnpm install
cp .env.example .env
# openssl rand -hex 24
# same value in NUDGE_PAIRING_SECRET and WXT_PUBLIC_NUDGE_PAIRING_SECRET
pnpm start:server
pnpm --filter @nudge/extension build
```

Load `apps/extension/.output/chrome-mv3` unpacked. Chrome 114 or newer. Node.js 22.13 or newer. pnpm 11.1 or newer. Backend: `http://127.0.0.1:4317`.

To rebuild the gitignored alpha zip: `./scripts/package-alpha.sh`.

## Draft GitHub release

Title: `Nudge 0.1.0-alpha.1`

Body: `docs/release/0.1.0-alpha.1.md`

## Publication checklist

- Confirm the copyright holder name.
- Add a Code of Conduct contact.
- Enable GitHub private vulnerability reporting and update `SECURITY.md`.
- Decide whether to rewrite history for the old example pairing value in `a40a7ba`.
- Commit the candidate on a review branch. Do not force-push.
- Generate a new pairing secret for any binary you attach to a public release.
- Publish the source and the unpacked zip together, with the server setup in the release notes.
- Do not describe the zip as a Chrome Web Store install.
