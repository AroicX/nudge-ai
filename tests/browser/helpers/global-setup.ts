import { execSync } from 'node:child_process';

export default function globalSetup() {
  // Build the extension with e2e hooks into apps/extension/.output-e2e (production build untouched).
  execSync('pnpm --filter @nudge/extension build', {
    stdio: 'inherit',
    env: { ...process.env, WXT_PUBLIC_NUDGE_E2E: '1' },
  });
}
