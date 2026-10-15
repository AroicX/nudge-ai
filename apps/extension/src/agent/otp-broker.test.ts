import type { ContentRequest, ContentResult } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { OtpBroker } from './otp-broker';

const input = {
  taskId: 't1', generation: 0, sourceTabId: 2, service: 'Acme',
  destinationTabId: 1, destinationElementId: 'docV:3', destinationDocumentId: 'docV',
};

function content(overrides: Partial<Record<ContentRequest['type'], (request: ContentRequest) => Partial<ContentResult>>> = {}) {
  const log: Array<{ tabId: number; request: ContentRequest }> = [];
  const port = {
    log,
    send: vi.fn(async (tabId: number, request: ContentRequest): Promise<ContentResult> => {
      log.push({ tabId, request });
      const base: ContentResult = { ok: true, detail: 'ok', changed: false, documentId: tabId === 1 ? 'docV' : 'docM' };
      const handler = overrides[request.type];
      if (handler) return { ...base, ...handler(request) };
      if (request.type === 'inspect') return { ...base, element: { kind: 'input', autocomplete: 'one-time-code', codeLike: true } };
      if (request.type === 'otp_extract') return { ...base, otp: { status: 'found', envelopeCode: '482913' } };
      if (request.type === 'otp_enter') return { ...base, changed: true, detail: 'Code entered; not submitted.', otp: { status: 'found', acceptedLength: 6 } };
      return base;
    }),
  };
  return port;
}

describe('OtpBroker', () => {
  it('transfers a fresh code to the verified destination without exposing it', async () => {
    const port = content();
    const broker = new OtpBroker(port, () => 0);
    const result = await broker.transfer(input);
    expect(result.ok).toBe(true);
    expect(result.detail).not.toMatch(/482913/);
    const enter = port.log.find((entry) => entry.request.type === 'otp_enter');
    expect(enter).toMatchObject({ tabId: 1, request: { elementId: 'docV:3', documentId: 'docV', envelopeCode: '482913' } });
    expect(JSON.stringify(result)).not.toContain('482913');
  });

  it('refuses when the destination document changed between extract and enter', async () => {
    let inspections = 0;
    const port = content({
      inspect: () => {
        inspections += 1;
        return inspections === 1
          ? { element: { kind: 'input', autocomplete: 'one-time-code', codeLike: true } }
          : { documentId: 'docV2', element: { kind: 'input', autocomplete: 'one-time-code', codeLike: true } };
      },
    });
    const result = await new OtpBroker(port, () => 0).transfer(input);
    expect(result.ok).toBe(false);
    expect(port.log.some((entry) => entry.request.type === 'otp_enter')).toBe(false);
  });

  it('refuses a destination that is not a code field', async () => {
    const port = content({ inspect: () => ({ element: { kind: 'input', inputType: 'email', codeLike: false } }) });
    const result = await new OtpBroker(port, () => 0).transfer(input);
    expect(result).toMatchObject({ ok: false });
    expect(port.log.some((entry) => entry.request.type === 'otp_extract')).toBe(false);
  });

  it('asks when the code is ambiguous and never uses a stale code', async () => {
    const ambiguous = await new OtpBroker(content({ otp_extract: () => ({ ok: false, otp: { status: 'ambiguous' } }) }), () => 0).transfer(input);
    expect(ambiguous.detail).toMatch(/more than one/i);
    const stale = content({ otp_extract: () => ({ ok: false, otp: { status: 'stale' } }) });
    const staleResult = await new OtpBroker(stale, () => 0).transfer(input);
    expect(staleResult.ok).toBe(false);
    expect(stale.log.some((entry) => entry.request.type === 'otp_enter')).toBe(false);
  });

  it('cancel destroys a pending envelope before entry', async () => {
    let release!: () => void;
    const port = content({});
    const original = port.send;
    port.send = vi.fn(async (tabId: number, request: ContentRequest) => {
      if (request.type === 'inspect' && port.log.some((entry) => entry.request.type === 'otp_extract')) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return original(tabId, request);
    });
    const broker = new OtpBroker(port, () => 0);
    const pending = broker.transfer(input);
    await new Promise((resolve) => setTimeout(resolve, 10));
    broker.cancelAll();
    release();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(port.log.some((entry) => entry.request.type === 'otp_enter')).toBe(false);
  });
});
