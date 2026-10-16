import type { AuthorizationRecord } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { validateNavigation } from './url-policy';

const auth = (origins: AuthorizationRecord['origins']): AuthorizationRecord => ({
  taskId: 't', instruction: 'x', origins, categories: ['read', 'navigate'], destinations: [], exclusions: [], limits: {},
});
const base = { userTypedUrls: [], observedUrls: ['https://jobs.test/page/2'], taskOrigins: ['https://jobs.test'], recordValues: [] };

describe('validateNavigation', () => {
  it('allows an observed link', () => {
    expect(validateNavigation('https://jobs.test/page/2', { ...base, authorization: auth([]) })).toEqual({ ok: true });
  });

  it('blocks an unobserved origin without browse_web', () => {
    expect(validateNavigation('https://evil.test/', { ...base, authorization: auth(['https://jobs.test']) }).ok).toBe(false);
  });

  it('allows any http origin with browse_web', () => {
    expect(validateNavigation('https://other.test/', { ...base, authorization: auth('browse_web') })).toEqual({ ok: true });
  });

  it('requires confirmation when a new origin receives collected data', () => {
    const outcome = validateNavigation('https://evil.test/collect?d=Acme%20Corp', {
      ...base,
      recordValues: ['Acme Corp'],
      authorization: auth('browse_web'),
    });
    expect(outcome.ok).toBe('confirm');
  });

  it('rejects non-http schemes', () => {
    expect(validateNavigation('javascript:alert(1)', { ...base, authorization: auth('browse_web') }).ok).toBe(false);
  });
});
