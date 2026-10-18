/** Local planner (including exact-navigation fast path) against synthetic pages; never touches the user's browser. */
import { TaskController } from '../apps/extension/src/agent/task-controller';
import {
  FakeBrowser,
  MemoryCheckpoints,
  noScreenshots,
  element,
} from '../apps/extension/src/agent/test-doubles';
import { OllamaPlanner } from '../apps/server/src/planner/ollama-planner';
const browser = new FakeBrowser()
  .addTab(1, {
    url: 'https://www.google.com/',
    title: 'Google',
    documentId: 'google',
    elements: [],
    text: ['Google search'],
  })
  .addTab(2, {
    url: 'https://www.jumia.com.ng/',
    title: 'Shopping',
    documentId: 'shop',
    elements: [element('shop', 1, 'input', 'Search products')],
    text: ['Search products'],
  });
const local = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b');
const calls: string[] = [];
const controller = new TaskController({
  tabs: browser,
  content: browser,
  screenshots: noScreenshots,
  checkpoints: new MemoryCheckpoints(),
  planner: {
    scope: (request, signal) =>
      local.scope(request, AbortSignal.any([signal, AbortSignal.timeout(60000)])),
    plan: async (request, signal) => {
      const result = await local.plan(
        request,
        AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      );
      calls.push(result.toolCall.tool);
      console.log(`Planner: ${result.toolCall.tool}`);
      return result;
    },
  },
  otp: { cancelAll() {}, transfer: async () => ({ ok: false, detail: 'Not used' }) },
  clock: () => Date.now(),
  emit: () => {},
  provider: () => 'ollama',
  capabilities: () => ({ vision: false }),
});
const began = Date.now();
await controller.instruct('Open YouTube', 'voice', 2);
await controller.idle();
const snapshot = controller.snapshot();
const opened = (await browser.list()).some((tab) =>
  new URL(tab.url).hostname.endsWith('youtube.com'),
);
console.log(
  JSON.stringify(
    {
      opened,
      calls,
      status: snapshot.status,
      summary: snapshot.report?.summary,
      elapsedSeconds: (Date.now() - began) / 1000,
    },
    null,
    2,
  ),
);
if (!opened || snapshot.status !== 'completed' || !calls.some((call) => ['navigate', 'open_tab'].includes(call))) process.exitCode = 1;
