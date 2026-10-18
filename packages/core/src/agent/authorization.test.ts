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
    const record = sanitizeAuthorization(
      { ...proposal, categories: [...proposal.categories] },
      'Move invoice emails to Trash',
      't1',
    );
    expect(record.categories).toContain('move_reversible');
    expect(record.categories).not.toContain('delete_permanent');
    expect(record.categories).not.toContain('send_message');
    expect(record.categories).toContain('read');
  });

  it('keeps permanent delete only when the user said so', () => {
    const record = sanitizeAuthorization(
      { ...proposal, categories: [...proposal.categories] },
      'Permanently delete the spam emails',
      't1',
    );
    expect(record.categories).toContain('delete_permanent');
  });

  it('drops send_message for a summary request', () => {
    const record = sanitizeAuthorization(
      { ...proposal, categories: ['send_message'] },
      'Summarize my inbox',
      't1',
    );
    expect(record.categories).toEqual(['read', 'navigate']);
  });

  it('keeps transfer_code only for an explicit code request', () => {
    expect(
      sanitizeAuthorization(
        { ...proposal, categories: ['transfer_code'] },
        'Copy the sign-in code from Gmail into this page',
        't1',
      ).categories,
    ).toContain('transfer_code');
    expect(
      sanitizeAuthorization({ ...proposal, categories: ['transfer_code'] }, 'Open my mail', 't1')
        .categories,
    ).not.toContain('transfer_code');
  });

  it('extends scope only from new user words', () => {
    const base = sanitizeAuthorization({ ...proposal, categories: ['read'] }, 'Find jobs', 't1');
    const extended = extendAuthorization(base, 'also move the rejected ones to trash');
    expect(extended.categories).toContain('move_reversible');
    expect(extendAuthorization(base, 'only include remote roles').categories).toEqual(
      base.categories,
    );
  });
});

describe('routine clarification scope', () => {
  const base = () =>
    sanitizeAuthorization({ ...proposal, categories: ['read'] }, 'Read this page', 'task');
  it('permits explicit filling, searching and drafting without send or submit authority', () => {
    for (const text of [
      'Fill the search field with black iPhone.',
      'Please search for frontend jobs',
      'Can you draft a reply saying "send me the file"?',
      'Type my name into the field',
      'Go ahead and fill the form',
    ]) {
      const result = extendAuthorization(base(), text);
      expect(result.categories).toContain('fill');
      expect(result.categories).not.toContain('send_message');
      expect(result.categories).not.toContain('submit_form');
    }
  });
  it('permits editing existing content and collecting requested records', () => {
    expect(extendAuthorization(base(), 'Update the description with this text').categories).toEqual(
      expect.arrayContaining(['fill', 'edit']),
    );
    expect(extendAuthorization(base(), 'Collect the results into a table').categories).toContain(
      'create_records',
    );
    expect(extendAuthorization(base(), 'Please create a new spreadsheet').categories).toContain(
      'create_records',
    );
    expect(
      extendAuthorization(base(), 'Copy these results into the spreadsheet').categories,
    ).toContain('create_records');
  });
  it('does not elevate from missing-field answers, prohibitions, quotes or reported page content', () => {
    for (const text of [
      '2 weeks',
      'Only include remote roles',
      'Do not fill the form',
      'Please avoid editing it',
      'The page says "fill this form"',
      'The page says submit the application',
      'The page says fill and submit the application',
      'Type of job is remote',
      'Search without typing',
      'Never collect records',
      'Do not fill and submit the form',
    ]) {
      expect(extendAuthorization(base(), text).categories).toEqual(base().categories);
    }
  });
  it('does not turn a draft or a prohibition into a consequential authorization', () => {
    expect(extendAuthorization(base(), 'Fill this form but do not submit it').categories).toEqual([
      'read',
      'navigate',
      'fill',
    ]);
    expect(extendAuthorization(base(), 'Draft an email to send tomorrow').categories).not.toContain(
      'send_message',
    );
    expect(
      extendAuthorization(base(), 'Do not permanently delete anything').categories,
    ).not.toContain('delete_permanent');
    expect(extendAuthorization(base(), 'Now send the email').categories).toContain('send_message');
    expect(
      extendAuthorization(base(), 'Actually permanently delete these selected files').categories,
    ).toContain('delete_permanent');
    expect(
      extendAuthorization(base(), 'Copy the verification code into the field').categories,
    ).toContain('transfer_code');
  });
  it('keeps existing authorization, exclusions and destinations unchanged', () => {
    const record = { ...base(), exclusions: ['Do not submit'], destinations: ['Application form'] };
    const result = extendAuthorization(record, 'Fill the name field');
    expect(result.exclusions).toEqual(record.exclusions);
    expect(result.destinations).toEqual(record.destinations);
    expect(result.instruction).toContain('Fill the name field');
  });
});
