export const HOST_NAME = 'com.nudge.chatgpt';
export const AGENT_NAME = 'Nudge';
export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
export const DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const RESOURCE = 'https://api.openai.com/v1';
export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const MODELS_URL = 'https://api.openai.com/v1/models';
export const DYNAMIC_CLIENT = 'dynamic_agent_client';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
export const CALLBACK_PATH = '/auth/callback';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';
export const UNUSABLE_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
