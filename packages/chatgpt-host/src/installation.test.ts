import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { installHost } from './installation';
import { encodeMessage, pushFrames } from './framing';

it('starts the installed host with Chrome’s minimal PATH and preserves its data directory', async () => {
  const root = mkdtempSync(join(tmpdir(), "nudge host's "));
  const directory = join(root, 'data');
  const hostDir = join(root, 'manifests');
  const extensionId = 'a'.repeat(32);
  installHost({ extensionId, directory, hostDir });
  const manifest = JSON.parse(readFileSync(join(hostDir, 'com.nudge.chatgpt.json'), 'utf8'));
  expect(manifest.allowed_origins).toEqual([`chrome-extension://${extensionId}/`]);
  const child = spawn(manifest.path, [`chrome-extension://${extensionId}/`], {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const result = new Promise<unknown>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      let errors = '';
      child.stderr.on('data', (chunk) => { errors += chunk.toString(); });
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`Host exited ${code}: ${errors}`)));
      child.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        buffer = Buffer.from(pushFrames(buffer, resolve));
      });
    });
    child.stdin.write(encodeMessage({ v: 1, id: 'status-test', extensionId, type: 'status' }));
    await expect(result).resolves.toMatchObject({ id: 'status-test', accounts: [] });
  } finally {
    child.kill();
  }
});
