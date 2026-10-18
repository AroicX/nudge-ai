import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_NAME } from './constants';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function installHost({ extensionId, directory, hostDir }: {
  extensionId: string;
  directory: string;
  hostDir: string;
}) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome extension ID.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const allowFile = join(directory, 'native-host.json');
  writeFileSync(allowFile, JSON.stringify({ allowedExtensionIds: [extensionId] }), { mode: 0o600 });
  chmodSync(allowFile, 0o600);

  // Chrome launched from Finder does not inherit the terminal's Node PATH or custom data directory.
  const launcher = join(directory, 'nudge-chatgpt-host');
  const main = join(dirname(fileURLToPath(import.meta.url)), 'main.ts');
  const script = `#!/bin/sh\nset -eu\nexport NUDGE_CHATGPT_DIR=${shellQuote(directory)}\nexec ${shellQuote(process.execPath)} --import ${shellQuote(import.meta.resolve('tsx'))} ${shellQuote(main)} "$@"\n`;
  writeFileSync(launcher, script, { mode: 0o700 });
  chmodSync(launcher, 0o700);
  mkdirSync(hostDir, { recursive: true });
  writeFileSync(join(hostDir, `${HOST_NAME}.json`), JSON.stringify({
    name: HOST_NAME,
    description: 'Nudge companion for Continue with ChatGPT',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2));
}
