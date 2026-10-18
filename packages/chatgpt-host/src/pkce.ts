import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
  accountId?: string;
  enablePlan: boolean;
  expiresAt: number;
}

export function createTransaction(input: {
  redirectUri: string;
  clientId: string;
  accountId?: string;
  enablePlan?: boolean;
  now?: number;
}): AuthTransaction {
  const verifier = randomUrlToken(64);
  return {
    state: randomUrlToken(),
    nonce: randomUrlToken(),
    verifier,
    challenge: codeChallenge(verifier),
    redirectUri: input.redirectUri,
    clientId: input.clientId,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    enablePlan: input.enablePlan === true,
    expiresAt: (input.now ?? Date.now()) + 10 * 60 * 1000,
  };
}
