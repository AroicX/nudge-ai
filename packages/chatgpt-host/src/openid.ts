import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { DISCOVERY_URL, ISSUER, JWKS_URL, TOKEN_URL } from './constants';

export interface OpenAiEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  revocationEndpoint: string;
}

let discovery: Promise<OpenAiEndpoints> | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export function resetDiscoveryCache(): void {
  discovery = undefined;
  jwks = undefined;
}

export async function loadEndpoints(fetcher: typeof fetch = fetch): Promise<OpenAiEndpoints> {
  discovery ??= fetcher(DISCOVERY_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error('OpenAI sign-in configuration could not be loaded.');
      const body = (await response.json()) as Record<string, unknown>;
      const endpoints = {
        issuer: body.issuer,
        authorizationEndpoint: body.authorization_endpoint,
        tokenEndpoint: body.token_endpoint,
        jwksUri: body.jwks_uri,
        revocationEndpoint: body.revocation_endpoint,
      };
      if (
        endpoints.issuer !== ISSUER ||
        endpoints.tokenEndpoint !== TOKEN_URL ||
        endpoints.jwksUri !== JWKS_URL ||
        typeof endpoints.authorizationEndpoint !== 'string' ||
        !endpoints.authorizationEndpoint.startsWith(`${ISSUER}/`) ||
        typeof endpoints.revocationEndpoint !== 'string' ||
        !endpoints.revocationEndpoint.startsWith(`${ISSUER}/`)
      ) {
        throw new Error('OpenAI sign-in configuration did not match the documented issuer.');
      }
      return endpoints as OpenAiEndpoints;
    })
    .catch((error: unknown) => {
      discovery = undefined;
      throw error;
    });
  return discovery;
}

export function remoteJwks(): ReturnType<typeof createRemoteJWKSet> {
  jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

export async function verifyIdToken(
  idToken: string,
  expected: { audience: string; nonce?: string },
  key: Parameters<typeof jwtVerify>[1] = remoteJwks(),
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, key, {
    issuer: ISSUER,
    audience: expected.audience,
    requiredClaims: expected.nonce ? ['sub', 'exp', 'iat', 'nonce'] : ['sub', 'exp', 'iat'],
    clockTolerance: 5,
  });
  if (expected.nonce && payload.nonce !== expected.nonce)
    throw new Error('The ChatGPT sign-in nonce did not match.');
  if (typeof payload.sub !== 'string' || !payload.sub)
    throw new Error('The ChatGPT sign-in did not include an account identity.');
  return payload;
}
