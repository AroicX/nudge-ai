import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBroker } from './broker';
import { encodeMessage, pushFrames } from './framing';
import { ChatGptRuntime } from './runtime';
import { AccountStore, dataDirectory } from './store';

function allowedIds(): string[] {
  const file = join(dataDirectory(), 'native-host.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { allowedExtensionIds?: unknown };
    const ids = Array.isArray(parsed.allowedExtensionIds)
      ? parsed.allowedExtensionIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (!ids.length) throw new Error('empty');
    return ids;
  } catch {
    process.stderr.write('Nudge ChatGPT companion has no allowed extension id. Run the installer.\n');
    process.exit(1);
  }
}

const runtime = new ChatGptRuntime({
  store: new AccountStore(join(dataDirectory(), 'accounts.json')),
});
const broker = createBroker(runtime, {
  allowedExtensionIds: allowedIds(),
  send(message) {
    process.stdout.write(encodeMessage(message));
  },
});

let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  try {
    buffer = pushFrames(buffer, (message) => {
      void broker.handle(message);
    });
  } catch {
    process.stderr.write('Nudge ChatGPT companion received an invalid frame.\n');
    broker.cancelAll();
    process.exit(1);
  }
});
process.stdin.on('end', () => {
  broker.cancelAll();
  process.exit(0);
});
