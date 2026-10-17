import { describe, expect, it } from 'vitest';

import { classifyInstruction } from './instruction-classifier';

const active = { taskActive: true, confirmationPending: false, tabTitles: [] };

describe('classifyInstruction', () => {
  it.each([
    ['stop', 'stop'],
    ['Stop.', 'stop'],
    ['cancel', 'stop'],
    ['hold on', 'pause'],
    ['pause', 'pause'],
    ['continue', 'resume'],
    ['skip this', 'skip'],
  ])('%s → %s', (text, kind) => {
    expect(classifyInstruction(text, active).kind).toBe(kind);
  });

  it('treats yes as a confirmation only when one is pending', () => {
    expect(classifyInstruction('yes, move them', { ...active, confirmationPending: true })).toEqual(
      {
        kind: 'confirm',
        approved: true,
      },
    );
    expect(classifyInstruction("no, don't", { ...active, confirmationPending: true })).toEqual({
      kind: 'confirm',
      approved: false,
    });
    expect(classifyInstruction('yes', active).kind).toBe('correction');
  });

  it('recognises tab corrections', () => {
    expect(classifyInstruction('use the other tab', active)).toMatchObject({
      kind: 'tab_correction',
    });
    expect(
      classifyInstruction('use the Sheet tab', {
        ...active,
        tabTitles: [{ tabId: 7, title: 'Jobs Sheet' }],
      }),
    ).toMatchObject({ kind: 'tab_correction', tabId: 7 });
    expect(classifyInstruction('tab 5', active)).toMatchObject({
      kind: 'tab_correction',
      tabIndex: 5,
    });
    expect(classifyInstruction('switch to tab 12', active)).toMatchObject({
      kind: 'tab_correction',
      tabIndex: 12,
    });
    expect(
      classifyInstruction('switch to my Gmail tab', {
        ...active,
        tabTitles: [{ tabId: 11, title: 'Inbox - person@example.com - Gmail' }],
      }),
    ).toMatchObject({ kind: 'tab_correction', tabId: 11 });
    expect(
      classifyInstruction('switch to my Gmail tab', {
        ...active,
        tabTitles: [
          { tabId: 11, title: 'Inbox - first@example.com - Gmail' },
          { tabId: 12, title: 'Inbox - second@example.com - Gmail' },
        ],
      }),
    ).toEqual({ kind: 'tab_correction', text: 'switch to my Gmail tab' });
  });

  it('turns other speech into a correction while active and a new task when idle', () => {
    expect(classifyInstruction('only include remote roles', active)).toEqual({
      kind: 'correction',
      text: 'only include remote roles',
    });
    expect(
      classifyInstruction('only include remote roles', { ...active, taskActive: false }),
    ).toEqual({ kind: 'new_task', text: 'only include remote roles' });
  });

  it('does not treat a goal containing stop as a stop command', () => {
    expect(classifyInstruction('find bus stop timetables', active).kind).toBe('correction');
  });
});
