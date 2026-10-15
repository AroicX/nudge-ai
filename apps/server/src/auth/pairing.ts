import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

function equalSecret(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export function pairingGuard(expectedSecret: string) {
  return async function requirePairing(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const received = request.headers['x-nudge-pairing-secret'];
    if (typeof received !== 'string' || !equalSecret(received, expectedSecret)) {
      await reply.code(401).send({ error: 'Pairing authentication required.' });
    }
  };
}
