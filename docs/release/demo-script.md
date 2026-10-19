# Fixture demo script

Record this against the local fixture site. Do not use a signed-in Google, mail, or bank account, and do not show an API key.

1. Start the fixture site with `pnpm dev:fixtures` and open `http://127.0.0.1:4173`.
2. Start the Nudge server and open the side panel from the toolbar.
3. Ask: “Find the cheapest black 256 GB option and stop before checkout.”
4. When a confirmation appears, decline it, then press Stop if the task is still running.
5. Open full-page chat and ask a question that does not include personal data.
6. Show Provider settings with the key field empty.

Stop the recording before any real account page is visible.
