import { homedir } from 'node:os';
import { join } from 'node:path';
import { installHost } from './installation';
import { HOST_NAME } from './constants';
import { dataDirectory } from './store';

const extensionId = process.argv.find((arg) => arg.startsWith('--extension-id='))?.slice('--extension-id='.length)
  ?? process.argv[process.argv.indexOf('--extension-id') + 1];

if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write('Usage: pnpm --filter @nudge/chatgpt-host install-host -- --extension-id <32-character Chrome extension id>\n');
  process.exit(1);
}

installHost({
  extensionId,
  directory: dataDirectory(),
  hostDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
});
process.stdout.write(`Registered ${HOST_NAME} for chrome-extension://${extensionId}/\n`);
process.stdout.write('Reload the Nudge extension, then use Continue with ChatGPT in full-screen chat.\n');
