import { AGENT_NAME, AUTHORIZE_URL, DYNAMIC_CLIENT, RESOURCE, SCOPE } from './constants';
import type { AuthTransaction } from './pkce';

export function authorizationUrl(
  transaction: AuthTransaction,
  hostId: string,
  hints?: { idToken?: string; email?: string },
): string {
  const params = new URLSearchParams({
    client_id: transaction.clientId,
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: transaction.redirectUri,
    scope: SCOPE,
    resource: RESOURCE,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge_method: 'S256',
    code_challenge: transaction.challenge,
  });
  if (transaction.clientId === DYNAMIC_CLIENT) params.set('agent_name_hint', AGENT_NAME);
  if (hints?.idToken) params.set('id_token_hint', hints.idToken);
  if (hints?.email) params.set('login_hint', hints.email);
  if (transaction.enablePlan) params.set('prompt', 'consent');
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function redactAuthorizationUrl(url: string): string {
  return url.replace(/id_token_hint=[^&]+/g, 'id_token_hint=redacted');
}

export interface CallbackResult {
  code?: string;
  error?: string;
  clientId?: string;
  state: string;
}

export function readCallback(search: string): CallbackResult | { invalid: true } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state = params.get('state');
  if (!state) return { invalid: true };
  const code = params.get('code') ?? undefined;
  const error = params.get('error') ?? undefined;
  const clientId = params.get('client_id') ?? undefined;
  return {
    state,
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(clientId ? { clientId } : {}),
  };
}
