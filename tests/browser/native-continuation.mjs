// Opt-in real Chrome UI regression. Backend is mocked; no inference or user profile is used.
// Build first: pnpm --filter @nudge/extension build
// Run: node tests/browser/native-continuation.mjs
import { chromium } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = path.join(root, 'test-results/native-continuation');
(async () => {
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-continuation-extension-'));
  fs.cpSync(path.join(root, 'apps/extension/.output/chrome-mv3'), extension, { recursive: true });
  let handler;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const route = {
      request: () => ({
        url: () => `http://127.0.0.1:${server.address().port}${req.url}`,
        method: () => req.method,
        postDataJSON: () => (body ? JSON.parse(body) : {}),
      }),
      fulfill: async ({ status = 200, body = '', contentType = 'application/json' }) => {
        res.writeHead(status, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        });
        res.end(body);
      },
    };
    if (req.method === 'OPTIONS') return route.fulfill({});
    await handler(route);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const file of fs.readdirSync(extension, { recursive: true })) {
    if (String(file).endsWith('.js')) {
      const bundlePath = path.join(extension, String(file));
      fs.writeFileSync(
        bundlePath,
        fs.readFileSync(bundlePath, 'utf8').replaceAll('127.0.0.1:4317', `127.0.0.1:${port}`),
      );
    }
  }
  const executablePath = process.env.CHROME_EXECUTABLE || chromium.executablePath();
  const context = await chromium.launchPersistentContext('', {
    executablePath,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--headless=new',
    ],
  });
  try {
    let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const chats = new Map();
    const messages = new Map();
    const facts = new Map();
    const documents = new Map([
      [
        'cv',
        {
          id: 'cv',
          filename: 'Sample CV.txt',
          text: 'A sample reference document for this isolated UI check.',
          source: 'user',
          createdAt: new Date().toISOString(),
        },
      ],
    ]);
    facts.set('role', {
      key: 'role',
      value: 'Designer',
      source: 'user',
      updatedAt: new Date().toISOString(),
    });
    let preferences = { autoRemember: true, localDiagnostics: false };
    let sequence = 0;
    let inferenceRequests = 0;
    handler = async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path.startsWith('/fixture'))
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<title>Local browser fixture</title><h1>Destination</h1>',
        });
      if (path.startsWith('/api/agent/') || path === '/api/memory/chat') {
        inferenceRequests++;
        return route.fulfill({
          status: 503,
          body: JSON.stringify({ error: 'Inference forbidden in this browser check' }),
        });
      }
      let input = {};
      try {
        input = route.request().postDataJSON() || {};
      } catch {
        /* Requests without JSON bodies have no input. */
      }
      let result = { configured: true };
      if (path.includes('/providers/health'))
        result = {
          openai: { available: true },
          ollama: { available: true, models: ['local-preview-model'] },
        };
      else if (path === '/api/memory/preferences') {
        if (method === 'PUT') preferences = { ...preferences, ...input };
        result = preferences;
      } else if (path === '/api/memory/chats') {
        if (method === 'POST') {
          const chat = {
            id: input.id || `chat-${++sequence}`,
            title: input.title || 'New chat',
            generation: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          chats.set(chat.id, chat);
          messages.set(chat.id, []);
          result = { chat };
        } else result = { chats: [...chats.values()] };
      } else if (/^\/api\/memory\/chats\/[^/]+\/messages$/.test(path)) {
        const id = path.split('/')[4];
        const chat = chats.get(id);
        if (!chat)
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Not found' }),
          });
        if (method === 'PUT') {
          if (input.generation !== chat.generation)
            return route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Stale generation' }),
            });
          const merged = new Map((messages.get(id) || []).map((t) => [t.id, t]));
          for (const turn of input.messages) merged.set(turn.id, turn);
          messages.set(id, [...merged.values()]);
        }
        if (method === 'DELETE') {
          messages.set(id, []);
          chat.generation++;
        }
        result = { messages: messages.get(id) || [], generation: chat.generation };
      } else if (/^\/api\/memory\/chats\/[^/]+$/.test(path)) {
        const id = path.split('/')[4];
        if (method === 'PATCH') chats.get(id).title = input.title;
        if (method === 'DELETE') {
          chats.delete(id);
          messages.delete(id);
        }
        result = { chat: chats.get(id), ok: true };
      } else if (path === '/api/memory/facts') result = { facts: [...facts.values()] };
      else if (path.startsWith('/api/memory/facts/')) {
        const key = decodeURIComponent(path.split('/')[4]);
        if (method === 'PUT')
          facts.set(key, { key, ...input, updatedAt: new Date().toISOString() });
        else facts.delete(key);
        result = { ok: true };
      } else if (path === '/api/memory/documents') {
        if (method === 'POST') {
          const doc = {
            id: `doc-${++sequence}`,
            ...input,
            source: 'user',
            createdAt: new Date().toISOString(),
          };
          documents.set(doc.id, doc);
          result = { document: doc };
        } else result = { documents: [...documents.values()] };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(result),
      });
    };
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/sidepanel.html?view=fullpage`);
    await page.getByText('No browser page attached').waitFor();
    await page.locator('.chat-sidebar__new').waitFor();
    await page.waitForFunction(() => !document.querySelector('.chat-sidebar__new').disabled);
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'empty-light.png') });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.nudgeTheme === 'dark');
    await page.screenshot({ path: path.join(artifacts, 'empty-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth))
      throw Error('Mobile overflow');
    await page.screenshot({ path: path.join(artifacts, 'mobile-dark.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.getByRole('button', { name: 'Memory & profile' }).click();
    await page.getByRole('tabpanel', { name: 'Profile' }).waitFor();
    await page.getByText('Designer', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(artifacts, 'memory-profile-light.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Documents' }).click();
    await page.getByLabel('Document upload area').waitFor();
    await page.screenshot({
      path: path.join(artifacts, 'memory-documents-light.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('switch', { name: /Automatically remember/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[role="switch"]').disabled);
    await page.getByRole('switch', { name: /Automatically remember/ }).click();
    await page.waitForFunction(() => !document.querySelector('[role="switch"]').checked);
    if (preferences.autoRemember !== false) throw Error('Memory preference not saved');
    await page.screenshot({
      path: path.join(artifacts, 'memory-settings-light.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.screenshot({
      path: path.join(artifacts, 'memory-settings-dark.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.screenshot({
      path: path.join(artifacts, 'memory-profile-dark.png'),
      fullPage: true,
    });
    await page.getByRole('tab', { name: 'Documents' }).click();
    await page.screenshot({
      path: path.join(artifacts, 'memory-documents-dark.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth))
      throw Error('Mobile memory overflow');
    await page.screenshot({
      path: path.join(artifacts, 'memory-documents-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Close memory' }).click();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    console.log('MEMORY_UI', 'tabs, preferences and desktop/mobile appearance verified');
    const cdp = await context.browser().newBrowserCDPSession();

    await page.getByLabel('Tell Nudge what to do').fill(`Open http://127.0.0.1:${port}/fixture`);
    const newPage = context.waitForEvent('page', {
      predicate: (p) => !p.url().includes('chrome-extension://'),
    });
    await page.getByRole('button', { name: 'Send message' }).click();
    const destination = await newPage.catch(async (e) => {
      console.log('FULLPAGE', await page.locator('body').innerText());
      console.log(
        'PAGES',
        context.pages().map((p) => p.url()),
      );
      throw e;
    });
    await destination.waitForLoadState('domcontentloaded');
    await page
      .waitForFunction(() => document.body.innerText.includes('is open.'), {}, { timeout: 15000 })
      .catch(async (e) => {
        console.log('FULLPAGE', await page.locator('body').innerText());
        throw e;
      });
    const after = (await cdp.send('Target.getTargets')).targetInfos;

    const views = await worker.evaluate(() =>
      chrome.runtime.getContexts ? chrome.runtime.getContexts({}) : [],
    );
    console.log(
      'CONTEXTS',
      JSON.stringify(
        views.map((v) => ({
          contextType: v.contextType,
          documentUrl: v.documentUrl,
          tabId: v.tabId,
          windowId: v.windowId,
        })),
        null,
        2,
      ),
    );
    const target = after.find((t) => t.url === `chrome-extension://${id}/sidepanel.html`);
    if (!target || !views.some((v) => v.contextType === 'SIDE_PANEL'))
      throw Error('Native sidepanel missing');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    let commandId = 0;
    const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId === sessionId) {
        const message = JSON.parse(event.message);
        if (message.id) {
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        }
      }
    });
    const nativeCommand = async (method, params = {}) => {
      const id = ++commandId;
      const response = new Promise((resolve) => pending.set(id, resolve));
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      });
      const result = await response;
      if (result.error) throw Error(JSON.stringify(result.error));
      return result.result;
    };
    const evaluate = async (expression) => {
      const result = await nativeCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitNative = async (expression) =>
      evaluate(
        `new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(Date.now()-start>15000){clearInterval(timer);reject(Error('Native panel wait expired'))}},100)})`,
      );
    await waitNative(
      "document.body.innerText.includes('127.0.0.1 is open.') && document.body.innerText.includes('Open http://127.0.0.1:')",
    );
    const sameChat = await evaluate("chrome.storage.local.get('nudgeActiveChat')");
    const fullChat = await page.evaluate(() => chrome.storage.local.get('nudgeActiveChat'));
    if (sameChat.nudgeActiveChat !== fullChat.nudgeActiveChat)
      throw Error('Chat selection differs');
    console.log('NATIVE_PANEL_SHARED_CHAT', JSON.stringify(sameChat));

    const tabId = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    for (const [command, expected] of [
      ['Zoom to 125%', 'Page zoom is 125%.'],
      ['Reset zoom', 'Page zoom is 100%.'],
      ['Pin tab', 'pinned'],
      ['Unpin tab', 'unpinned'],
    ]) {
      await evaluate("document.querySelector('#nudge-message').focus()");
      await nativeCommand('Input.insertText', { text: command });

      // Submit through the actual composer after React processes the input.
      await evaluate(
        'document.querySelector(\'form[aria-label="Message Nudge"]\').requestSubmit()',
      );
      await waitNative(`document.body.innerText.includes(${JSON.stringify(expected)})`).catch(
        async (e) => {
          console.log('FAILED_COMMAND', command, await evaluate('document.body.innerText'));
          console.log(
            'ACTUAL',
            await worker.evaluate(
              async (id) => ({
                zoom: await chrome.tabs.getZoom(id),
                tab: await chrome.tabs.get(id),
              }),
              tabId,
            ),
          );
          console.log(
            'CONTROLLER',
            await evaluate(
              "new Promise(resolve=>{const p=chrome.runtime.connect({name:'nudge-panel'});p.onMessage.addListener(m=>{if(m.type==='state'){p.disconnect();resolve(m)}});p.postMessage({type:'hello'})})",
            ),
          );
          throw e;
        },
      );
      const state = await worker.evaluate(
        async (id) => ({ zoom: await chrome.tabs.getZoom(id), tab: await chrome.tabs.get(id) }),
        tabId,
      );
      if (command === 'Zoom to 125%' && state.zoom !== 1.25) throw Error('Zoom was not applied');
      if (command === 'Reset zoom' && state.zoom !== 1) throw Error('Zoom was not reset');
      if (command === 'Pin tab' && !state.tab.pinned) throw Error('Tab was not pinned');
      if (command === 'Unpin tab' && state.tab.pinned) throw Error('Tab was not unpinned');
      console.log(
        'NATIVE_ACTION',
        command,
        JSON.stringify({ zoom: state.zoom, pinned: state.tab.pinned }),
      );
    }
    await waitNative('document.documentElement.scrollHeight - innerHeight - scrollY < 100');
    await evaluate('window.scrollTo(0, 0)');
    await waitNative("Boolean(document.querySelector('.jump-latest'))");
    await evaluate("document.querySelector('.jump-latest').click()");
    await waitNative('document.documentElement.scrollHeight - innerHeight - scrollY < 100');
    console.log('FOLLOW_LATEST', 'auto-scroll, manual reading and jump verified');
    await worker.evaluate(() => chrome.storage.local.set({ nudgeTheme: 'light' }));
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await waitNative("document.documentElement.dataset.nudgeTheme === 'dark'");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'fullpage-dark.png') });
    const darkPanel = await nativeCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(artifacts, 'native-panel-dark.png'),
      Buffer.from(darkPanel.data, 'base64'),
    );
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await waitNative("document.documentElement.dataset.nudgeTheme === 'light'");
    console.log(
      'SHARED_APPEARANCE',
      'light and dark synchronized across actual extension surfaces',
    );
    const contextsAfter = await worker.evaluate(() =>
      chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
    );
    if (contextsAfter.length !== 1) throw Error('Sidepanel no longer open');
    console.log(
      'Native panel stayed open on destination; same chat and follow-up actions verified.',
    );
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'fullpage.png') });
    const nativeScreenshot = await nativeCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(artifacts, 'native-panel.png'),
      Buffer.from(nativeScreenshot.data, 'base64'),
    );
    if (inferenceRequests) throw Error(`Unexpected inference requests: ${inferenceRequests}`);
    console.log('No-source deterministic destination task completed; zero inference requests.');
    console.log(
      'BROWSER_CAPABILITIES',
      await worker.evaluate(() => ({
        split: typeof chrome.tabs.createSplit,
        version: navigator.userAgent,
      })),
    );
    const supportsSplit = await worker.evaluate(
      () => typeof chrome.tabs.createSplit === 'function',
    );
    if (supportsSplit) {
      await page.close();
      for (const extra of context.pages()) if (extra.url() === 'about:blank') await extra.close();
      const second = await worker.evaluate(
        async ({ id, url }) => {
          const first = await chrome.tabs.get(id);
          return chrome.tabs.create({ url, windowId: first.windowId, active: false });
        },
        { id: tabId, url: `http://127.0.0.1:${port}/fixture-second` },
      );
      await evaluate("document.querySelector('#nudge-message').focus()");
      await nativeCommand('Input.insertText', { text: 'Split tabs side by side' });
      await evaluate(
        'document.querySelector(\'form[aria-label="Message Nudge"]\').requestSubmit()',
      );
      await waitNative(
        "document.body.innerText.includes('The two tabs are side by side in browser split view.')",
      );
      const splitTabs = await worker.evaluate(
        (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))),
        [tabId, second.id],
      );
      if (splitTabs[0].splitViewId < 0 || splitTabs[0].splitViewId !== splitTabs[1].splitViewId)
        throw Error('Native split not applied');
      console.log(
        'NATIVE_SPLIT',
        splitTabs.map((t) => ({ id: t.id, splitViewId: t.splitViewId, windowId: t.windowId })),
      );
    }
    if (inferenceRequests) throw Error(`Unexpected inference requests: ${inferenceRequests}`);
  } finally {
    await context.close();
    server.closeAllConnections();
    server.close();
    fs.rmSync(extension, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
