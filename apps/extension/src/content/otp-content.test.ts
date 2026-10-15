// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enterOtp, extractOtpFromPage } from './otp-content';

const NOW = Date.parse('2026-10-15T20:00:00.000Z');
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    (() => ({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 })) as never,
  );
});

describe('extractOtpFromPage', () => {
  it('picks the newest fresh message for the service', () => {
    document.body.innerHTML = `
      <article data-received-at="${iso(60 * 48)}"><h2>Acme sign-in</h2><p>Your Acme verification code is 111111</p></article>
      <article data-received-at="${iso(2)}"><h2>Acme sign-in</h2><p>Your Acme verification code is 482913</p></article>
      <article data-received-at="${iso(1)}"><h2>Shop</h2><p>Order 778899 shipped</p></article>`;
    expect(extractOtpFromPage(document, 'Acme', NOW)).toEqual({ status: 'found', envelopeCode: '482913' });
  });

  it('is ambiguous when one message has two codes', () => {
    document.body.innerHTML = `<article data-received-at="${iso(1)}"><p>Acme code 123456 or backup code 654321</p></article>`;
    expect(extractOtpFromPage(document, 'Acme', NOW).status).toBe('ambiguous');
  });

  it('is stale when the newest message is older than 15 minutes', () => {
    document.body.innerHTML = `<article data-received-at="${iso(20)}"><p>Acme verification code 482913</p></article>`;
    expect(extractOtpFromPage(document, 'Acme', NOW).status).toBe('stale');
  });

  it('finds nothing for a different service', () => {
    document.body.innerHTML = `<article data-received-at="${iso(1)}"><p>Netflix verification code 482913</p></article>`;
    expect(extractOtpFromPage(document, 'Acme', NOW).status).toBe('none');
  });
});

describe('enterOtp', () => {
  it('fills a one-time-code field without submitting', () => {
    document.body.innerHTML = '<form><input autocomplete="one-time-code" aria-label="Code" /><button>Confirm</button></form>';
    const submit = vi.fn();
    document.querySelector('form')!.addEventListener('submit', submit);
    const input = document.querySelector('input')!;
    const result = enterOtp(input, '482913');
    expect(result).toEqual({ ok: true, acceptedLength: 6 });
    expect(input.value).toBe('482913');
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a field that is neither one-time-code nor code-like', () => {
    document.body.innerHTML = '<input aria-label="Email" />';
    expect(enterOtp(document.querySelector('input')!, '482913').ok).toBe(false);
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('accepts a code-like labelled field', () => {
    document.body.innerHTML = '<label>Verification code <input /></label>';
    expect(enterOtp(document.querySelector('input')!, '482913').ok).toBe(true);
  });
});
