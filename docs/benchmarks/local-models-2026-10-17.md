# Local Nudge model comparison — 17 October 2026

Gemma 4 12B was installed through the official Ollama library and tested against the installed Qwen 3.5 9B. Keep Qwen as the active Nudge model based on this small workload comparison. Gemma remains installed; model selection was not changed.

## Environment and method

- Apple M2 MacBook Pro, 24 GiB unified memory; Ollama MLX runner.
- Models tested sequentially and unloaded afterward. Existing desktop applications and the local voice sidecar remained open. The Mac reported about 7.5 GiB of swap in use between runs; this is not an isolated laboratory benchmark.
- Five synthetic tasks, each run twice: short conversational reply, naira arithmetic, navigation, current-page black iPhone selection, and missing-page-context handling.
- Thinking disabled, temperature 0, voice context 4,096 tokens, browser context 8,192 tokens. Same prompts and output schema for both models.
- The second trial repeats the identical prompt and benefits from caching. First-trial latency is reported separately below. Model loading happened before requests.
- Browser tests use a compact action schema, not Nudge's full production planner. No speech recognition, audio playback, microphone accent testing, or actual website interaction is included in these model timings. These results cannot establish general model intelligence or end-to-end voice latency.

## Measurements

| Metric | Qwen 3.5 9B | Gemma 4 12B |
| --- | ---: | ---: |
| Checks passed | 10/10 | 6/10 |
| Conversational checks | 4/4 | 4/4 |
| Browser checks | 6/6 | 2/6 |
| Median time to first text, new voice prompts | 0.86 s | 1.55 s |
| Median time to first text, repeated voice prompts | 0.20 s | 0.16 s |
| Median complete short text reply, both trials | 1.37 s | 1.31 s |
| Median complete browser action JSON, both trials | 4.02 s | 4.56 s |
| Initial model preparation | 4.42 s | 3.62 s |
| Ollama-reported loaded model allocation, 4K context | 7.68 GB | 7.65 GB |

Allocation is decimal GB reported by Ollama immediately after preload, not peak process memory or whole-system RAM. Two trials per task are too few to treat small timing differences as reliable advantages. Token rates are preserved in the JSON but are not directly comparable across tokenizers.

Both models selected the observed black iPhone and calculated 2,500 naira change correctly. Gemma failed both navigation trials by choosing `click` and claiming a YouTube link existed when none was provided. It also failed both missing-context trials by proposing clicks on unobserved controls instead of asking for the missing page. Qwen selected the expected action in every trial.

## Screenshot regression

The screenshot's failure was a separate application gate: Nudge required a readable HTTP page even for an exact destination request. The fixed controller opens the requested destination through existing policy checks and verifies Chrome's actual tab URL before completing. It does not choose an unrelated tab from another window.

Verified with two Chromium regression tests starting at `chrome://newtab/`, and with the installed extension in the user's actual Chrome window. The command “Can you open YouTube now?” opened the live YouTube homepage; Nudge showed completion in 2 seconds and the YouTube source. The automated Chromium tests stub destination HTML; the manual Chrome check used the live website.

Repository verification: 449 unit tests, lint, typecheck, build, and two browser regression tests passed. The updated installed extension was reloaded.

## Reproduce and sources

Run `python3 scripts/benchmark-local-models.py MODEL_NAME` from the project root with Ollama running and no concurrent inference. Results append to `local-models-2026-10-17.json`; preserve or move the existing report before starting a separate experiment. Full prompts, outputs, timings, and model digests are in that JSON.

- [Official Gemma 4 12B Ollama listing](https://ollama.com/library/gemma4:12b)
- [Google Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4)

A newer release does not guarantee knowledge of current events. Browser answers must use the actual observed page, regardless of the chosen model.
