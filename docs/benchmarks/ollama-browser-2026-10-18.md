# Local Ollama browser workflow validation — 18 October 2026

Status: partial validation completed for this run. **2 of the 10 required scenarios passed strict isolated Ollama validation (correction and calendar); the bonus saved-profile recall also passed.** Seven earlier browser passes remain provisional for provider isolation, and comparison is incomplete. This is not a ten-of-ten result. Ordinary requests in earlier builds did not pin their provider; their observed browser assertions and matching local inference timings remain useful but do not prove the entire workflow stayed local.

The suite uses a real loaded Nudge extension in a separate Chromium profile, its authenticated backend, and local Ollama `qwen3.5:9b` at `127.0.0.1:11434`. Model decisions and browser actions are not mocked. Controlled pages are served through browser routing at `https://nudge-ollama.test`; public navigation uses the real `https://example.com`. No messages or forms are sent. No OpenAI fallback was accepted by the harness. A shared-provider contamination was detected during the earlier comparison attempt, which was stopped and excluded. Final strict runs used explicit Ollama headers and a separate backend with an empty OpenAI key.

Branded installed Google Chrome was tried in a separate visible profile, but it did not load the unpacked extension using the command-line extension flags. Google Chrome for Testing 156.0.8078.4 (Playwright Chromium build 1248) is used instead, headed for the expanded suite. Each test records browser version, provider selection, elapsed time, browser errors, controller state, and a trace. Runs are serial because they share the local model.

## Scenarios

| # | Scenario | Website | Required evidence | Final outcome | Duration |
|---|---|---|---|---|---|
| 1 | Search, open result, answer hours | Controlled | Submitted search query, actual result URL, 10:30–4:00 in final answer | Provisional earlier pass | 275.630 s controller execution; 4.9 min total test |
| 2 | Compose email draft | Controlled | Compose navigation; exact recipient, subject and body; no send | Provisional earlier pass | 429.276 s controller execution; 7.4 min total test |
| 3 | Navigate to Example Domain | Public | Actual URL and IANA documentation text | Provisional earlier pass | 180.301 s controller execution; 3.3 min total test |
| 4 | Product facts | Controlled | Answer includes $49 and 12-hour battery life | Provisional earlier pass | 257.122 s controller execution; 4.5 min total test |
| 5 | Contact form | Controlled | Exact name and email values; no submit | Provisional earlier pass | 370.954 s total test |
| 6 | Correct stale form value | Controlled | Replaced email; preserved original name; no submit | Strict isolated Ollama pass | 284.460 s controller; 4.9 min total |
| 7 | Compare products across pages | Controlled | Both product pages visited; Cedar Mini cheaper by $30 | Incomplete; repeated reads and provider contamination stopped run | No valid completed duration |
| 8 | Calendar event draft | Controlled | Exact title/date/time; no save and no deferred task | Strict isolated Ollama pass | 250.119 s total test |
| 9 | Scheduled navigation | Controlled → public | Pending Ollama task, real Chrome alarm fires, Example Domain opens | Provisional earlier pass | 65.942 s total test |
| 10 | Cancel scheduled task | Controlled | Cancelled state and no page movement past original due time | Provisional earlier pass | 69.835 s total test |

### Exact instructions

1. “Search this website for Cedar Observatory, open its opening hours result, and tell me its Saturday opening hours.”
2. “Compose an email draft to maya.chen@example.test with subject Observatory visit and message exactly: Hi Maya, shall we visit Cedar Observatory this Saturday at 11 AM? Thanks, Alex. Fill in the draft but do not send it.”
3. “Open https://example.com in this tab.”
4. “What is the price and battery life of the product on this page?”
5. “Fill this contact form with name Alex Rivera and email alex.rivera@example.test. Do not submit it.”
6. “Replace the email address in this form with alex.new@example.test. Leave the name unchanged and do not submit.”
7. “Open the details for both Cedar Mini and Cedar Pro on this website and tell me which is cheaper and by how much.”
8. “Create a draft calendar event titled Cedar visit on October 20, 2026 at 11:00 AM. Fill the calendar form now, but do not save the event.”
9. “In 1 minute, open https://example.com”
10. “In 1 minute, scroll this page down.” The queued task is then cancelled with its visible Cancel button before its due time.

The source of these instructions is `tests/browser/accept-ollama-workflows.spec.ts`.

## Failures found before the ten-scenario run

- The original 30-second backend deadline expired during local scope planning. The bounded local deadline was changed to 120 seconds while OpenAI retains 30 seconds. Observed local scope planning was approximately 35–38 seconds.
- Backend development watch restarted when shared files changed, causing `Failed to fetch`. Validation now uses a stable backend without watch.
- The initial non-localhost HTTP fixture exposed unavailable `crypto.randomUUID` in content scripts. The fixture was changed to HTTPS; a separate product fix adds UUID generation fallback for HTTP content. The test now verifies a real content observation before asking the model to act.
- Search completed its real type → search click → result click → extraction workflow in 389.358 seconds of controller execution (6.7 minutes total test), but its final answer only said it found the hours. The assertion correctly rejected this because the user requested the hours themselves. A planner prompt correction requires the requested facts in the final summary, and avoids collecting records unless requested. Rerun pending.
- Initial draft planning used an invalid element reference. The controller rejected it, refreshed its observation and the model recovered by clicking the actual Compose email link. No unsafe action occurred.

## Reproduction

Start the normal paired backend (without development watch) on isolated port 4319 with `OPENAI_API_KEY` empty and ensure `qwen3.5:9b` is installed in local Ollama. Run `pnpm exec playwright test -c playwright.ollama.config.ts`. The config builds the isolated test extension, rejects a scripted backend, and writes `test-results/ollama-results.json` plus per-scenario traces. Normal scripted acceptance runs skip these opt-in live-model tests.

## Tested build distinction

The passing email-draft run used the earlier compact local tool prompt and 120-second local deadline. It ran headless. The subsequent nine-scenario run is headed and uses the factual-final-answer prompt, local request IDs, capability cache and inference timing instrumentation. These are distinct tested builds, not a claim that all ten ran on an identical build.

At the start of the nine-scenario run, SHA-256 values were:

- E2E extension background: `09c0cd1c2cbc6b66c80cfc111ead639eb28a5b047089886107646c09b9a30ebd`
- Local protocol: `f2b123582222063632815e610a01f197112616712a8d88b8025654c1240e7781`
- Ollama planner: `d09fb63131e5735458af024a45545c91c886765885c1a8e44d3b81cd0e43bc49`

The stable backend is not running in watch mode, so concurrent source edits do not change its loaded code.

## Expanded run findings before compact-prompt reload

- Search: scope completed in 45.736 seconds; the first action plan exceeded the 120-second backend deadline. No OpenAI fallback was accepted. This latency failure differs from the earlier missing-answer failure.
- Public navigation: local model navigation completed and the browser displayed the actual public page. The test expected an old heading, but the current public page contains multilingual documentation paragraphs instead. The assertion was corrected to the observed English documentation text; rerun pending.
- Product facts: passed with the final answer “The product price is $49 and the battery life is 12 hours.” It needlessly extracted the same record three times (one new record, then two duplicates) before finishing. This is a measurable efficiency problem despite the correct final answer.
- The suite was interrupted after product completion, before remaining scenarios, to load the compact prompt. Pending scenarios have not yet been counted as passes.

Temporary raw traces were preserved under `/tmp/nudge-ollama-first-stable` and `/tmp/nudge-ollama-expanded-first`. The interrupted run did not flush the JSON reporter; individual completed traces remain available. The stable initial draft ran without the later factual-answer prompt. The initial expanded product/navigation tests ran with the factual-answer prompt but before the subsequent compact prompt.

## Compact-prompt scope failure

The next run used the compact prompt and isolated SQLite directory `/private/tmp/nudge-ollama-validation-data`. Search scope took 53.841 seconds. The first action plan took 7.913 seconds; subsequent plans took approximately 2–3 seconds, a major latency improvement. However, scope returned only `read` and `navigate` for the explicit website-search instruction and placed a page URL in its origins list. The model repeatedly attempted to type the requested query; the safety controller correctly rejected each attempt because `fill` was absent. Validation stopped after observing the repeated policy denial, before executing the remaining cases. No browser field changed and no cloud fallback was accepted. The captured state is `/tmp/nudge-ollama-scope-failure.json`; raw trace artifacts are under `/tmp/nudge-ollama-compact-scope-failure`. A scope-normalization and repeated-denial fix is pending verification.

## Scope-fix rerun

Search passed after canonical-origin and explicit-search fill-scope normalization. The real model typed the query, clicked Search, opened the result, and answered “Cedar Observatory is open Saturdays from 10:30 AM to 4:00 PM.” Controller time was 275.630 seconds. Scope took 50.428 seconds; successive model plans took 98.282, 119.923, 2.999 and 2.279 seconds. The second plan remained uncomfortably close to the 120-second bound; the final two decisions were fast. These timings are observed wall-clock controller durations, not isolated model token throughput.

## Browser-command routing regression

The first contact-form attempt was incorrectly routed to ordinary `/api/memory/chat`, leaving the browser controller idle and the form untouched. Its exact instruction was “Fill this contact form with name Alex Rivera and email alex.rivera@example.test. Do not submit it.” Validation was interrupted after observing the completed chat response and no browser-controller start. The UI routing fix gives explicit browser-action verbs priority. The suite now checks that browser work starts within 15 seconds, which exposes this regression quickly. Search and navigation passes from that run are preserved under `/tmp/nudge-ollama-scope-fixed`. The remaining six scenarios plus the profile bonus are being rerun with the routing fix.

## Additional saved-profile scenario

A bonus eleventh scenario saves `name = Jordan Vale` and `email = jordan.vale@example.test` through the visible Memory & profile UI, then instructs: “Fill this contact form with my saved name and email address. Do not submit it.” The instruction deliberately omits the saved values. The required evidence is actual form fields containing those values and no submission. This runs against the isolated validation database, never the user's normal memory database. Outcome: strict isolated Ollama pass; 194.783 seconds total test.

Contact-form rerun passed in 370.954 seconds total (365.031 seconds inside the scenario). Actual name and email fields matched the supplied values and no form submission occurred. Its first two action plans took 114.662 and 118.887 seconds, again showing the remaining local latency risk.

The correction scenario then exposed the same routing family for the verb “Replace”: it made no browser-controller request and failed the new start assertion after 15 seconds (20.521 seconds total). The explicit form-edit routing fix was extended, and the five remaining workflows plus saved-profile bonus are rerunning on a fresh extension build. Scheduled-task execution and cancellation are tested in the full-page chat linked to the actual website tab.

The next correction attempt routed to the browser successfully, but scope took 72.390 seconds and returned `read`, `navigate`, and `edit`, without `fill`. The first action plan then exceeded the 120-second deadline before changing a field. This run stopped after the first failure (3.9 minutes total); no fallback was accepted. Raw results: `/tmp/nudge-ollama-correction-timeout`. The remaining five tests did not run in that invocation.

## Scheduled execution and cancellation verification

Both passed on the fresh headed extension with full-page task management. Scheduled navigation took 62.753 seconds inside the scenario (65.942 seconds total); the real Chrome alarm fired after one minute, and the actual public Example Domain page opened. Controller execution after the alarm was 0.840 seconds. Cancellation took 68.195 seconds inside the scenario (69.835 seconds total), including waiting 65 seconds after cancellation to verify the page never scrolled and the controller stayed idle. Both retained the Ollama provider. These two operations use deterministic scheduling/direct-navigation paths and required no model inference; they are browser workflow tests, not evidence of model reasoning. Raw artifacts: `/tmp/nudge-ollama-schedule-pass`.

## Form-scope fast-path rerun

The next loaded backend fixed correction scope: `read`, `navigate`, `fill`, and `edit` were granted in 16 ms with a canonical origin. Despite the smaller form tool catalogue and compacted request metadata, the first actual local action plan still exceeded the 120-second bound. The controller offered fallback but none was accepted; no field changed. This is now a latency failure rather than routing or scope. Total test time was approximately 2.2 minutes. Validation stopped immediately; comparison, calendar and profile recall were not run in this invocation. Artifacts: `/tmp/nudge-ollama-form-scope-fixed-timeout`.

## Bounded runtime diagnosis

One tiny direct local request (`think:false`, maximum 16 output tokens, 60-second bound) returned exactly OK in 639 ms: 17 prompt tokens took459 ms, one output token166 ms, load6 ms. Ollama0.40.5 reported an MLX GPU runner with safetensors and7.83GB VRAM, context8192. This one-token measurement does not establish sustained decode throughput. The failed correction server log shows a cold runner taking10.9 seconds, then an uncached2535-token prompt taking about87.3 seconds, leaving only about22 seconds for decoding before cancellation. The dominant observed cost is prompt processing plus cold initialization, rather than an unresponsive model. No runtime settings or model downloads were changed for this diagnosis.

## Comparison run stopped for provider isolation failure

Comparison started with actual Ollama: scope38.623 seconds; first action106.051 seconds clicked Cedar Mini. Three subsequent local decisions repeatedly read the Back to catalogue link rather than navigating. Later responses abruptly included fields absent from the local output schema and continued without matching Ollama inference logs. The run was stopped immediately; no comparison pass is counted and calendar/recall did not run. Ordinary agent requests lacked an explicit provider header, allowing the shared backend provider to diverge from the isolated extension selection. No fallback was accepted by the test. This requires provider pinning and a stronger request-header assertion before rerunning. Raw artifacts: `/tmp/nudge-ollama-comparison-provider-contamination`. Earlier passing runs predate this observed switch; their model timings were verified against local logs.

The harness now defaults both extension build and requests to isolated port4319, requires every agent request to carry `x-nudge-provider: ollama`, and aborts requests without that header before they reach the backend. The isolated backend must have an empty OpenAI key. The ordinary-task provider pinning fix must be present in the tested extension.

## Isolated calendar and saved-profile findings

With strict Ollama headers and the isolated backend without cloud credentials, correction still exceeded120seconds before its first field action (2273 uncached prompt tokens; about91seconds prefill). Calendar routed to the browser correctly, but failed its scope request in41.5seconds. A single raw adapter reproduction identified the cause: the model returned origins `["this/current page"]`, category `create_records`, and title/date/time record fields; normalization threw `TypeError: Invalid URL`. Raw synthetic response: `/tmp/nudge-calendar-scope-raw.json`.

Saved-profile setup saved the name successfully but the exact textarea-label locator failed after rerender, because the saved textarea content affected the label text. This was a harness issue before any recall inference. The locator now uses a non-exact label match and browser actions have a15-second bound. Recall is still pending.

The next planned backend increases the local browser-planning deadline to180seconds and aliases long element IDs to short request-local references, restoring exact IDs before execution. The deadline increase is a functionality bound, not a latency improvement; voice deadlines remain unchanged.

## Strict correction pass and calendar focus loop

Correction passed on isolated4319 with empty OpenAI key, all requests explicitly pinned to Ollama, and no fallback. It replaced the email exactly, preserved Sam Lee, and did not submit. Controller duration284.460seconds (approximately4.9minutes total), with one type action followed by finish. The180-second bound allowed the first decision, which took approximately164seconds, to complete.

Calendar then focused the same title field three consecutive times without typing. Decisions took approximately96,77,and84seconds. The test run was interrupted at the third verified no-progress action; no calendar pass is counted. Artifacts including the correction pass are preserved at `/tmp/nudge-ollama-strict-correction-pass-calendar-loop`. A narrowly scoped fix removes redundant focus from routine-form tools and explains that type_text focuses automatically. The next backend also omits irrelevant prior chat history from ordinary form steps while preserving saved profile facts and documents. Calendar and recall are rerunning after that restart.

## Final verified batch and remaining work

The final calendar and saved-profile tests both passed with a copied isolated extension, authenticated backend on4319, empty OpenAI key, and every scope/plan request carrying `x-nudge-provider: ollama`. Unpinned requests are blocked by the harness before reaching the backend. Calendar total test time was250.119seconds (241.896seconds inside the scenario); title Cedar visit, date2026-10-20, and time11:00 were exact, with no save or deferred task. Saved-profile recall total test time was194.783seconds (186.294seconds inside the scenario); Jordan Vale and jordan.vale@example.test were saved through the visible profile UI, recalled into the real form without including them in the instruction, and never submitted. Raw final JSON report and traces: `/tmp/nudge-ollama-strict-calendar-recall-pass`.

The strict correction pass remains in `/tmp/nudge-ollama-strict-correction-pass-calendar-loop`. These strict passes used different loaded builds: correction had short element aliases and180-second deadline; calendar/recall additionally had the focus-loop fix and trimmed prior-chat context. The earlier seven provisional passes require rerunning with strict provider isolation before claiming ten validated cases; comparison also needs a successful local-only rerun. No additional broad suite was run in this validation batch. The isolated4319 backend was stopped; the normal4317 backend, voice4318 service and Ollama were left untouched.
