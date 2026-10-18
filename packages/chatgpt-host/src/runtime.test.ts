import { plannerRequest } from '../../../apps/server/src/planner/test-fixtures';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_SCOPE, SCOPE } from './constants';
import { createBroker } from './broker';
import { encodeMessage, pushFrames } from './framing';
import { responsesBody } from './inference';
import { listenForCallback } from './loopback';
import { resetDiscoveryCache } from './openid';
import { ChatGptRuntime } from './runtime';
import { AccountStore } from './store';

const discovery = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
  token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
};

async function identityKey() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test';
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
}

function signIdentity(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  input: { subject: string; audience: string; nonce?: string; email?: string },
) {
  return new SignJWT({
    ...(input.nonce ? { nonce: input.nonce } : {}),
    email: input.email ?? 'ada@example.com',
    name: 'Ada',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://auth.openai.com')
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function harness() {
  resetDiscoveryCache();
  const directory = mkdtempSync(join(tmpdir(), 'nudge-chatgpt-'));
  const store = new AccountStore(join(directory, 'accounts.json'));
  const calls: string[] = [];
  let opened = '';
  let resolveCallback: (params: URLSearchParams) => void = () => undefined;
  let tokenHandler: (body: string, init?: RequestInit) => Promise<Response> = async () =>
    json({ error: 'invalid_grant' }, 400);
  let models = { models: [{ visibility: 'list', slug: 'gpt-test', display_name: 'GPT Test' }] };
  let responseHandler: ((init?: RequestInit) => Promise<Response>) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/openid-configuration')) return json(discovery);
    if (url.endsWith('/oauth/token')) return tokenHandler(String(init?.body ?? ''), init);
    if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 200 });
    if (url.endsWith('/models')) return json(models);
    if (url.endsWith('/responses')) {
      if (!responseHandler) return json({ error: { code: 'request_failed' } }, 500);
      return responseHandler(init);
    }
    return json({ error: 'unexpected' }, 500);
  };
  return {
    directory,
    store,
    calls,
    get opened() {
      return opened;
    },
    finish(params: URLSearchParams) {
      resolveCallback(params);
    },
    setTokens(handler: typeof tokenHandler) {
      tokenHandler = handler;
    },
    setModels(next: typeof models) {
      models = next;
    },
    setResponses(handler: typeof responseHandler) {
      responseHandler = handler;
    },
    runtime(keys: Awaited<ReturnType<typeof identityKey>>['keys'], now = () => Date.now()) {
      return new ChatGptRuntime({
        store,
        fetch: fetcher,
        keys,
        now,
        openBrowser: async (url) => {
          opened = url;
        },
        listen: async () => ({
          redirectUri: 'http://127.0.0.1:1455/auth/callback',
          result: new Promise<URLSearchParams>((resolve) => {
            resolveCallback = resolve;
          }),
          close() {
            resolveCallback(new URLSearchParams({ error: 'access_denied', state: 'cancelled' }));
          },
        }),
      });
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' },
  });
}

function sse(events: string[]) {
  const encoded = new TextEncoder().encode(events.join('\n\n') + '\n\n');
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('ChatGPT plan companion', () => {
  afterEach(() => resetDiscoveryCache());

  it('rejects a callback whose state does not match and does not exchange a code', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    let exchanged = 0;
    env.setTokens(async () => {
      exchanged += 1;
      return json({});
    });
    const runtime = env.runtime(keys);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).not.toBe(''));
    const state = new URL(env.opened).searchParams.get('state');
    env.finish(new URLSearchParams({ code: 'code', state: `${state}nope`, client_id: 'oaiapp_issued' }));
    await expect(pending).rejects.toThrow('could not be verified');
    expect(exchanged).toBe(0);
    void privateKey;
  });

  it('stops when consent is declined', async () => {
    const { keys } = await identityKey();
    const env = harness();
    let exchanged = 0;
    env.setTokens(async () => {
      exchanged += 1;
      return json({});
    });
    const runtime = env.runtime(keys);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).not.toBe(''));
    const state = new URL(env.opened).searchParams.get('state');
    env.finish(new URLSearchParams({ error: 'access_denied', state: state ?? '' }));
    await expect(pending).rejects.toThrow('declined');
    expect(exchanged).toBe(0);
    expect(runtime.status().accounts).toEqual([]);
  });

  it('stores an issued client id and refuses to mix a second account into it', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    env.setTokens(async (_body, init) => {
      const nonce = new URL(env.opened).searchParams.get('nonce') ?? '';
      const audience = new URLSearchParams(String(init?.body ?? '')).get('client_id') ?? '';
      return json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: await signIdentity(privateKey, { subject: 'user_1', audience, nonce, email: 'ada@example.com' }),
        expires_in: 3600,
        scope: SCOPE,
        token_type: 'Bearer',
      });
    });
    const runtime = env.runtime(keys);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).toContain('client_id=dynamic_agent_client'));
    expect(new URL(env.opened).searchParams.get('agent_name_hint')).toBe('Nudge');
    expect(new URL(env.opened).searchParams.has('prompt')).toBe(false);
    expect(new URL(env.opened).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    const state = new URL(env.opened).searchParams.get('state') ?? '';
    env.finish(new URLSearchParams({ code: 'code-1', state, client_id: 'oaiapp_issued' }));
    const account = await pending;
    expect(account.planUsage).toBe(true);
    const saved = env.store.read();
    expect(saved?.accounts[0]?.clientId).toBe('oaiapp_issued');
    expect(statSync(join(env.directory, 'accounts.json')).mode & 0o777).toBe(0o600);

    const again = runtime.connect({ accountId: account.id });
    await vi.waitFor(() => expect(env.opened).toContain('client_id=oaiapp_issued'));
    expect(new URL(env.opened).searchParams.has('agent_name_hint')).toBe(false);
    env.finish(
      new URLSearchParams({
        code: 'code-2',
        state: new URL(env.opened).searchParams.get('state') ?? '',
        client_id: 'oaiapp_other',
      }),
    );
    await expect(again).rejects.toThrow('different connection');
    expect(env.store.read()?.accounts).toHaveLength(1);
    expect(env.store.read()?.accounts[0]?.tokens?.accessToken).toBe('access-1');
  });

  it('keeps registrations separate and clears only the disconnected account', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    let subject = 'user_1';
    let email = 'ada@example.com';
    let issued = 'oaiapp_one';
    env.setTokens(async (_body, init) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      const nonce = new URL(env.opened).searchParams.get('nonce') ?? '';
      return json({
        access_token: `access-${subject}`,
        refresh_token: `refresh-${subject}`,
        id_token: await signIdentity(privateKey, {
          subject,
          audience: params.get('client_id') === 'dynamic_agent_client' ? issued : (params.get('client_id') ?? issued),
          nonce,
          email,
        }),
        expires_in: 3600,
        scope: SCOPE,
        token_type: 'Bearer',
      });
    });
    const runtime = env.runtime(keys);
    const firstPending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).toContain('dynamic_agent_client'));
    env.finish(new URLSearchParams({ code: 'c1', state: new URL(env.opened).searchParams.get('state') ?? '', client_id: issued }));
    const first = await firstPending;
    subject = 'user_2';
    email = 'bea@example.com';
    issued = 'oaiapp_two';
    const secondPending = runtime.connect({ newAccount: true });
    await vi.waitFor(() => expect(new URL(env.opened).searchParams.get('client_id')).toBe('dynamic_agent_client'));
    env.finish(new URLSearchParams({ code: 'c2', state: new URL(env.opened).searchParams.get('state') ?? '', client_id: 'oaiapp_two' }));
    const second = await secondPending;
    expect(first.id).not.toBe(second.id);
    const result = await runtime.disconnect(first.id);
    expect(result.revocationConfirmed).toBe(true);
    const accounts = env.store.read()?.accounts ?? [];
    expect(accounts.find((account) => account.id === first.id)?.tokens).toBeUndefined();
    expect(accounts.find((account) => account.id === first.id)?.clientId).toBe('oaiapp_one');
    expect(accounts.find((account) => account.id === second.id)?.tokens?.accessToken).toBe('access-user_2');
    await expect(runtime.respond({
      accountId: first.id,
      model: 'gpt-test',
      instructions: 'Answer.',
      messages: [{ role: 'user', content: 'Hello' }],
      onDelta: () => undefined,
    }, new AbortController().signal)).rejects.toThrow('Connect ChatGPT again');
  });

  it('serializes refresh so two callers share one token request', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    env.setTokens(async (_body, init) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      const nonce = new URL(env.opened).searchParams.get('nonce') ?? '';
      const audience = params.get('grant_type') === 'refresh_token' ? 'oaiapp_issued' : (params.get('client_id') ?? '');
      return json({
        access_token: params.get('grant_type') === 'refresh_token' ? 'access-new' : 'access-old',
        refresh_token: 'refresh-new',
        id_token: await signIdentity(privateKey, { subject: 'user_1', audience, ...(params.get('grant_type') === 'refresh_token' ? {} : { nonce }) }),
        expires_in: 3600,
        scope: SCOPE,
        token_type: 'Bearer',
      });
    });
    let now = Date.now();
    const runtime = env.runtime(keys, () => now);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).not.toBe(''));
    env.finish(new URLSearchParams({ code: 'c', state: new URL(env.opened).searchParams.get('state') ?? '', client_id: 'oaiapp_issued' }));
    const account = await pending;
    now += 2 * 60 * 60 * 1000;
    let refreshes = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.setTokens(async (_body, init) => {
      refreshes += 1;
      await gate;
      return json({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        id_token: await signIdentity(privateKey, { subject: 'user_1', audience: 'oaiapp_issued' }),
        expires_in: 3600,
        scope: SCOPE,
        token_type: 'Bearer',
      });
      void init;
    });
    const first = runtime.models(account.id, new AbortController().signal);
    const second = runtime.models(account.id, new AbortController().signal);
    await vi.waitFor(() => expect(refreshes).toBe(1));
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ slug: 'gpt-test', displayName: 'GPT Test' }],
      [{ slug: 'gpt-test', displayName: 'GPT Test' }],
    ]);
    expect(refreshes).toBe(1);
    expect(env.store.read()?.accounts[0]?.tokens?.accessToken).toBe('access-new');
  });

  it('streams with the plan token and does not retry a cancelled or limited request', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    env.setTokens(async () => {
      const nonce = new URL(env.opened).searchParams.get('nonce') ?? '';
      return json({
        access_token: 'plan-access',
        refresh_token: 'plan-refresh',
        id_token: await signIdentity(privateKey, { subject: 'user_1', audience: 'oaiapp_issued', nonce }),
        expires_in: 3600,
        scope: SCOPE,
        token_type: 'Bearer',
      });
    });
    const runtime = env.runtime(keys);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).not.toBe(''));
    env.finish(new URLSearchParams({ code: 'c', state: new URL(env.opened).searchParams.get('state') ?? '', client_id: 'oaiapp_issued' }));
    const account = await pending;
    const bodies: string[] = [];
    const headers: string[] = [];
    env.setResponses(async (init) => {
      bodies.push(String(init?.body ?? ''));
      headers.push(new Headers(init?.headers).get('authorization') ?? '');
      return sse([
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}',
        'event: response.completed\ndata: {"type":"response.completed"}',
      ]);
    });
    let text = '';
    await runtime.respond(
      {
        accountId: account.id,
        model: 'gpt-test',
        instructions: 'Be brief.',
        messages: [{ role: 'user', content: 'Hi' }],
        onDelta: (delta) => {
          text += delta;
        },
      },
      new AbortController().signal,
    );
    expect(text).toBe('Hello');
    expect(headers).toEqual(['Bearer plan-access']);
    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({
      model: 'gpt-test',
      instructions: 'Be brief.',
      input: [{ role: 'user', content: 'Hi' }],
      store: false,
      stream: true,
    });
    expect(responsesBody({ model: 'gpt-test', instructions: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] })).not.toMatch(/temperature|max_output_tokens|previous_response_id|api_key|sk-/);

    let limited = 0;
    env.setResponses(async () => {
      limited += 1;
      return json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } }, 429);
    });
    await expect(
      runtime.respond(
        {
          accountId: account.id,
          model: 'gpt-test',
          instructions: 'Be brief.',
          messages: [{ role: 'user', content: 'Again' }],
          onDelta: () => undefined,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Usage limit reached');
    expect(limited).toBe(1);

    let cancelled = 0;
    env.setResponses(async (init) => {
      cancelled += 1;
      return new Promise((_resolve, reject) => {
        const stop = () => reject(new Error('Stopped'));
        if (init?.signal?.aborted) {
          stop();
          return;
        }
        init?.signal?.addEventListener('abort', stop, { once: true });
      });
    });
    const controller = new AbortController();
    const hanging = runtime.respond(
      {
        accountId: account.id,
        model: 'gpt-test',
        instructions: 'Be brief.',
        messages: [{ role: 'user', content: 'Stop' }],
        onDelta: () => undefined,
      },
      controller.signal,
    );
    await vi.waitFor(() => expect(cancelled).toBe(1));
    controller.abort();
    await expect(hanging).rejects.toThrow();
    expect(cancelled).toBe(1);
    expect(account.planUsage).toBe(true);
    void PLAN_SCOPE;
  });

  it('does not infer when plan permission was not granted', async () => {
    const { privateKey, keys } = await identityKey();
    const env = harness();
    env.setTokens(async () => {
      const nonce = new URL(env.opened).searchParams.get('nonce') ?? '';
      return json({
        access_token: 'identity-only',
        refresh_token: 'identity-refresh',
        id_token: await signIdentity(privateKey, { subject: 'user_1', audience: 'oaiapp_issued', nonce }),
        expires_in: 3600,
        scope: 'openid profile email offline_access',
        token_type: 'Bearer',
      });
    });
    const runtime = env.runtime(keys);
    const pending = runtime.connect();
    await vi.waitFor(() => expect(env.opened).not.toBe(''));
    env.finish(new URLSearchParams({ code: 'c', state: new URL(env.opened).searchParams.get('state') ?? '', client_id: 'oaiapp_issued' }));
    const account = await pending;
    expect(account.planUsage).toBe(false);
    expect(account.signedIn).toBe(true);
    let responses = 0;
    env.setResponses(async () => {
      responses += 1;
      return sse(['event: response.completed\ndata: {"type":"response.completed"}']);
    });
    await expect(
      runtime.respond({
        accountId: account.id,
        model: 'gpt-test',
        instructions: 'Be brief.',
        messages: [{ role: 'user', content: 'Hi' }],
        onDelta: () => undefined,
      }, new AbortController().signal),
    ).rejects.toThrow('plan usage is off');
    expect(responses).toBe(0);
  });

  it('rejects another extension and an invalid message', async () => {
    const { keys } = await identityKey();
    const env = harness();
    const runtime = env.runtime(keys);
    const sent: unknown[] = [];
    const broker = createBroker(runtime, {
      allowedExtensionIds: ['a'.repeat(32)],
      send: (message) => sent.push(message),
    });
    await broker.handle({ v: 1, extensionId: 'b'.repeat(32), id: '1', type: 'status' });
    await broker.handle({ v: 1, id: '2', type: 'status', accessToken: 'secret' });
    expect(sent).toEqual([
      expect.objectContaining({ code: 'forbidden_extension' }),
      expect.objectContaining({ code: 'invalid_message' }),
    ]);
    expect(JSON.stringify(sent)).not.toContain('secret');
    const round = encodeMessage({ ok: true });
    const parsed: unknown[] = [];
    expect(pushFrames(round, (message) => parsed.push(message))).toEqual(Buffer.alloc(0));
    expect(parsed).toEqual([{ ok: true }]);
  });

  it('sends namespaced browser tools and returns local tool results on the next inference turn', async () => {
    const { keys } = await identityKey();
    const env = harness();
    const runtime = env.runtime(keys);
    const state = runtime.ensureHost();
    state.accounts.push({ id: 'a', label: 'Test', email: 'test@example.com', issuer: 'https://auth.openai.com', subject: 'test', clientId: 'oaiapp_test', hostId: state.hostId, scopes: SCOPE.split(' '), planUsage: true, tokens: { accessToken: 'plan-only', refreshToken: 'refresh', idToken: 'test', expiresAt: Date.now() + 3600000, savedAt: new Date().toISOString() } });
    env.store.write(state);
    const bodies: Array<Record<string, any>> = [];
    env.setResponses(async (init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer plan-only');
      bodies.push(JSON.parse(String(init?.body)));
      return sse(['data: ' + JSON.stringify({ type: 'response.output_item.done', item: { type: 'function_call', namespace: 'nudge', name: 'emit_step', call_id: 'call_1', arguments: JSON.stringify({ requestId: 'req_1', toolCall: { tool: 'observe_tab', tabId: 4 } }) } }), 'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [] } })]);
    });
    const request = plannerRequest();
    const result = await runtime.browserStep({ type: 'plan', accountId: 'a', model: 'gpt-test', request }, new AbortController().signal);
    expect(result).toMatchObject({ toolCall: { tool: 'observe_tab', tabId: 4 } });
    expect(bodies[0]?.tools).toEqual([expect.objectContaining({ type: 'namespace', name: 'nudge', tools: [expect.objectContaining({ type: 'function', name: 'emit_step' })] })]);
    expect(bodies[0]).toMatchObject({ store: false, stream: true, tool_choice: 'required' });
    await runtime.browserStep({ type: 'plan', accountId: 'a', model: 'gpt-test', request: { ...request, lastResult: { tool: 'observe_tab', ok: true, detail: 'Title: Example Domain' } } }, new AbortController().signal);
    expect(bodies[1]?.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function_call_output', call_id: 'call_1', output: expect.stringContaining('Title: Example Domain') })]));
    const abort = new AbortController();
    env.setResponses(async (init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })));
    const pending = runtime.browserStep({ type: 'plan', accountId: 'a', model: 'gpt-test', request }, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    await expect(pending).rejects.toThrow('Stopped');
  });

  it('accepts only the documented loopback callback path', async () => {
    const listener = await listenForCallback(2000);
    try {
      const missed = await fetch(listener.redirectUri.replace('/auth/callback', '/callback'));
      expect(missed.status).toBe(404);
      const arrived = listener.result;
      const response = await fetch(`${listener.redirectUri}?code=abc&state=xyz`);
      expect(response.status).toBe(200);
      const params = await arrived;
      expect(params.get('code')).toBe('abc');
      expect(params.get('state')).toBe('xyz');
    } finally {
      listener.close();
    }
  });
});
