import { expect, test } from './helpers/extension';
import { canvasEdit } from './helpers/scripted-scenarios';

test('edits a canvas design with real pointer and keyboard input', async ({ nudge }) => {
  await nudge.scenario(canvasEdit);
  const { page, tabId } = await nudge.open('/canvas-editor');
  await nudge.instruct('Move the text box to the right and change its text to Grand Opening', tabId);

  const state = await nudge.waitForStatus(['completed', 'partially_completed', 'failed'], 60_000);
  const status = page.getByTestId('canvas-status');
  await expect(status).toContainText('x=280');
  await expect(status).toContainText('text: Grand Opening');
  // The editor ignores synthetic events; every edit came from trusted input.
  await expect(status).toContainText('ignored synthetic events: 0');
  expect(state.status).toBe('completed');
  expect(state.capability).toBe('dom_plus_trusted_input');
  // Nudge's own debugger session was detached afterwards (Playwright keeps its own CDP session, so
  // getTargets().attached is always true here; probe Nudge's session directly instead).
  const probe = await nudge.worker.evaluate(async (id) => {
    try {
      await chrome.debugger.sendCommand({ tabId: id }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      return 'still attached';
    } catch (error) {
      return String(error);
    }
  }, tabId);
  expect(probe).toMatch(/not attached/i);
});
