import { describe, expect, it } from 'vitest';

import { extractOtp } from './otp-extractor';

describe('extractOtp', () => {
  it('extracts a 4–8 digit code near the requested service', () => {
    expect(extractOtp({ text: 'Netflix verification code: 482913. Expires soon.', service: 'Netflix', now: Date.now() })).toEqual({ status: 'found', code: '482913' });
  });
  it('refuses ambiguous candidates and unrelated numbers', () => {
    expect(extractOtp({ text: 'Netflix codes 482913 and 719204', service: 'Netflix', now: Date.now() }).status).toBe('ambiguous');
    expect(extractOtp({ text: 'Invoice 123456', service: 'Netflix', now: Date.now() }).status).toBe('none');
  });
});
