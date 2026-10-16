import type { PageSnapshot } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { restoreCheckpoint, toCheckpoint } from './checkpoint';
import { addIssue, appendStep, applyPlanUpdate, buildReport, createMemory, plannerView } from './memory';
import { redactText } from './redaction';
import { checkExpectation } from './verifier';

const snap = (text: string[], url = 'https://x.test/'): PageSnapshot => ({
  snapshotId: 's', documentId: 'doc_1', capturedAt: '2026-10-15T18:00:00.000Z', url, title: 't',
  viewport: { width: 1, height: 1, scrollX: 0, scrollY: 0, pageHeight: 1 },
  elements: [], text, truncated: false, inaccessible: [],
});

describe('checkExpectation', () => {
  it('verifies text_present only from the fresh snapshot', () => {
    expect(checkExpectation({ kind: 'text_present', text: 'Saved' }, snap([]), snap(['Row Saved']), { ok: true, changed: true, detail: '' }).verified).toBe(true);
    expect(checkExpectation({ kind: 'text_present', text: 'Saved' }, snap(['Saved']), snap([]), { ok: true, changed: true, detail: '' }).verified).toBe(false);
  });

  it('does not verify an ok but unchanged result', () => {
    const outcome = checkExpectation({ kind: 'count_changed' }, snap(['a']), snap(['a']), { ok: true, changed: false, detail: '' });
    expect(outcome.verified).toBe(false);
  });

  it('verifies url_changed', () => {
    expect(checkExpectation({ kind: 'url_changed' }, snap([], 'https://x.test/1'), snap([], 'https://x.test/2'), { ok: true, changed: true, detail: '' }).verified).toBe(true);
  });
});

describe('task memory', () => {
  it('keeps the last 30 steps and summarises older ones', () => {
    let memory = createMemory('goal');
    for (let index = 0; index < 45; index += 1) memory = appendStep(memory, { tool: 'click', summary: `step ${index}`, ok: true });
    expect(memory.steps.length).toBe(31);
    expect(memory.steps[0]!.summary).toMatch(/15 earlier steps/);
    expect(memory.steps.at(-1)!.summary).toBe('step 44');
  });

  it('gives the planner a compact view', () => {
    let memory = createMemory('goal');
    for (let index = 0; index < 20; index += 1) memory = appendStep(memory, { tool: 'click', summary: `s${index}`, ok: true });
    expect(plannerView(memory).steps.length).toBeLessThanOrEqual(8);
  });
});

describe('checkpoints', () => {
  it('never contain otp-like values or long raw text', () => {
    const memory = { ...createMemory('Copy the code'), userData: [{ label: 'otp', value: '482913', sensitive: true }, { label: 'name', value: 'Ada' }] };
    const checkpoint = toCheckpoint({
      taskId: 't1', memory, status: 'running',
      authorization: { taskId: 't1', instruction: 'x', origins: [], categories: ['read'], destinations: [], exclusions: [], limits: {} },
      records: [], generation: 2, instructionVersion: 1,
    });
    const json = JSON.stringify(checkpoint);
    expect(json).not.toContain('482913');
    expect(json).toContain('Ada');
  });

  it('restores an in-flight mutation as uncertain and pauses', () => {
    const checkpoint = toCheckpoint({
      taskId: 't1', memory: createMemory('g'), status: 'running',
      authorization: { taskId: 't1', instruction: 'x', origins: [], categories: ['read'], destinations: [], exclusions: [], limits: {} },
      records: [], generation: 0, instructionVersion: 0, inFlight: { tool: 'click', fingerprint: 'f' },
    });
    const restored = restoreCheckpoint(checkpoint);
    expect(restored.status).toBe('paused');
    expect(restored.uncertain).toEqual(['click']);
    expect(restored.memory.issues.some((issue) => issue.includes('Verify before continuing: click'))).toBe(true);
    expect(restored.memory.steps.at(-1)).toMatchObject({ tool: 'click', uncertain: true });
  });
});

describe('redactText', () => {
  it('redacts codes near verification wording but not unrelated numbers', () => {
    expect(redactText('Your verification code is 482913.')).not.toContain('482913');
    expect(redactText('Order 778899 shipped yesterday to your address on file.')).toContain('778899');
  });
  it('redacts long tokens', () => {
    expect(redactText('token abcdefghijklmnopqrstuvwxyz0123456789')).toContain('[redacted]');
  });
});

describe('buildReport', () => {
  it('separates verified, unverified, partial and skipped work', () => {
    let memory = createMemory('g');
    memory = applyPlanUpdate(memory, [
      { id: '1', text: 'Read page', status: 'done' },
      { id: '2', text: 'Write rows', status: 'pending' },
      { id: '3', text: 'Delete spam', status: 'skipped' },
    ]);
    memory = appendStep(memory, { tool: 'type_text', summary: 'Typed row 1', ok: true, evidence: 'Read back A1' });
    memory = appendStep(memory, { tool: 'click', summary: 'Clicked save', ok: true });
    memory = addIssue(memory, 'Delete spam: not authorized');
    const report = buildReport(memory, [], 'partially_completed', 'Half done', []);
    expect(report.verified).toEqual(['Typed row 1 (Read back A1)']);
    expect(report.unverified).toEqual(['Clicked save']);
    expect(report.partial).toEqual(['Write rows']);
    expect(report.skipped).toEqual([{ item: 'Delete spam', reason: 'Delete spam: not authorized' }]);
  });
});
