import { describe, expect, it } from 'vitest';

import { extendAuthorization, sanitizeAuthorization } from './authorization';

const proposal = {
  origins: ['https://mail.test'],
  categories: ['read', 'navigate', 'move_reversible', 'delete_permanent', 'send_message'] as const,
  destinations: [],
  exclusions: [],
  limits: {},
};

describe('sanitizeAuthorization', () => {
  it('drops permanent delete that the instruction did not ask for', () => {
    const record = sanitizeAuthorization({ ...proposal, categories: [...proposal.categories] }, 'Move invoice emails to Trash', 't1');
    expect(record.categories).toContain('move_reversible');
    expect(record.categories).not.toContain('delete_permanent');
    expect(record.categories).not.toContain('send_message');
    expect(record.categories).toContain('read');
  });

  it('keeps permanent delete only when the user said so', () => {
    const record = sanitizeAuthorization({ ...proposal, categories: [...proposal.categories] }, 'Permanently delete the spam emails', 't1');
    expect(record.categories).toContain('delete_permanent');
  });

  it('drops send_message for a summary request', () => {
    const record = sanitizeAuthorization({ ...proposal, categories: ['send_message'] }, 'Summarize my inbox', 't1');
    expect(record.categories).toEqual(['read', 'navigate']);
  });

  it('keeps transfer_code only for an explicit code request', () => {
    expect(sanitizeAuthorization({ ...proposal, categories: ['transfer_code'] }, 'Copy the sign-in code from Gmail into this page', 't1').categories).toContain('transfer_code');
    expect(sanitizeAuthorization({ ...proposal, categories: ['transfer_code'] }, 'Open my mail', 't1').categories).not.toContain('transfer_code');
  });

  it('extends scope only from new user words', () => {
    const base = sanitizeAuthorization({ ...proposal, categories: ['read'] }, 'Find jobs', 't1');
    const extended = extendAuthorization(base, 'also move the rejected ones to trash');
    expect(extended.categories).toContain('move_reversible');
    expect(extendAuthorization(base, 'only include remote roles').categories).toEqual(base.categories);
  });
});
