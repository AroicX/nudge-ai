import { RESOURCE, TOKEN_URL, UNUSABLE_REFRESH } from './constants';
import { loadEndpoints } from './openid';

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

function scopesOf(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

async function postForm(body: URLSearchParams, fetcher: typeof fetch): Promise<Response> {
  const endpoints = await loadEndpoints(fetcher);
  return fetcher(endpoints.tokenEndpoint || TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

export async function readTokenResponse(response: Response): Promise<TokenResponse> {
  const requestId = response.headers.get('openai-request-id') ?? response.headers.get('x-request-id');
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : 'token_exchange_failed';
    throw new OAuthError(
      requestId ? `ChatGPT sign-in failed (${requestId}).` : 'ChatGPT sign-in failed.',
      code,
      response.status,
    );
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string')
    throw new OAuthError('ChatGPT did not return renewable credentials.', 'incomplete_token');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    ...(typeof body.id_token === 'string' ? { idToken: body.id_token } : {}),
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    scopes: scopesOf(body.scope),
  };
}

export function exchangeCode(
  input: { clientId: string; code: string; verifier: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
) {
  return postForm(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: RESOURCE,
    }),
    fetcher,
  ).then(readTokenResponse);
}

export function refreshTokens(
  input: { clientId: string; refreshToken: string },
  fetcher: typeof fetch = fetch,
) {
  return postForm(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: input.clientId,
      refresh_token: input.refreshToken,
      resource: RESOURCE,
    }),
    fetcher,
  ).then(readTokenResponse);
}

export function refreshIsUnusable(error: unknown): boolean {
  return error instanceof OAuthError && UNUSABLE_REFRESH.has(error.code);
}

export async function revokeRefreshToken(
  input: { clientId: string; refreshToken: string },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const endpoints = await loadEndpoints(fetcher);
  let lastFailure = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(endpoints.revocationEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: input.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: input.clientId,
        }),
      });
      if (response.ok) return true;
      if (response.status < 500) return false;
      lastFailure = true;
    } catch {
      lastFailure = true;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return !lastFailure;
}
