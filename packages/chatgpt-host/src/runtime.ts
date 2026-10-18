import { OpenAIPlanner } from '@nudge/core';
import type { PlannerRequest, ScopeRequest } from '@nudge/contracts';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { JWTVerifyGetKey } from 'jose';
import { DYNAMIC_CLIENT, PLAN_SCOPE } from './constants';
import { authorizationUrl, readCallback, redactAuthorizationUrl } from './authorize';
import {
  consumeSse,
  eventFromSse,
  explainPlanError,
  listPlanModels,
  parseHttpError,
  PlanRequestError,
  responsesBody,
  type PlanModel,
  type ResponseInput,
} from './inference';
import { RESPONSES_URL } from './constants';
import {
  exchangeCode,
  OAuthError,
  refreshIsUnusable,
  refreshTokens,
  revokeRefreshToken,
} from './oauth';
import { verifyIdToken } from './openid';
import { createTransaction, safeEqual, type AuthTransaction } from './pkce';
import { planEnabled, publicAccount, type AccountRecord, type AccountStore, type HostState } from './store';

export interface RuntimeOptions {
  store: AccountStore;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  listen?: () => Promise<{ redirectUri: string; result: Promise<URLSearchParams>; close(): void }>;
  now?: () => number;
  keys?: JWTVerifyGetKey;
  log?: (message: string) => void;
}

export class ChatGptRuntime {
  #refreshing = new Map<string, Promise<void>>();
  #inflight = false;
  #browserTurn: { key: string; output: unknown[]; error?: string } | undefined;
  #pending: { transaction: AuthTransaction; close(): void } | undefined;
  readonly fetch: typeof fetch;
  readonly openBrowser: (url: string) => Promise<void>;
  readonly listen: NonNullable<RuntimeOptions['listen']>;
  readonly now: () => number;
  readonly keys: JWTVerifyGetKey | undefined;
  readonly log: (message: string) => void;

  constructor(private readonly options: RuntimeOptions) {
    this.fetch = options.fetch ?? fetch;
    this.openBrowser =
      options.openBrowser ??
      (async (url) => {
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        spawn(command, args, { stdio: 'ignore', detached: true }).unref();
      });
    this.listen = options.listen ?? (async () => {
      const { listenForCallback } = await import('./loopback');
      return listenForCallback();
    });
    this.now = options.now ?? Date.now;
    this.keys = options.keys;
    this.log = options.log ?? (() => undefined);
  }

  ensureHost(): HostState {
    const existing = this.options.store.read();
    if (existing?.hostId) return existing;
    const created = { hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
    this.options.store.write(created);
    return created;
  }

  status() {
    const state = this.ensureHost();
    return {
      hostReady: true,
      activeAccountId: state.activeAccountId,
      accounts: state.accounts.map(publicAccount),
    };
  }

  async connect(input: { accountId?: string; newAccount?: boolean; enablePlan?: boolean } = {}) {
    if (this.#pending) throw new Error('Finish the ChatGPT window that is already open.');
    const state = this.ensureHost();
    const existing = input.accountId
      ? state.accounts.find((account) => account.id === input.accountId)
      : undefined;
    if (input.accountId && !existing) throw new Error('That ChatGPT account is not saved on this computer.');
    const clientId = !input.newAccount && existing ? existing.clientId : DYNAMIC_CLIENT;
    const listener = await this.listen();
    const transaction = createTransaction({
      redirectUri: listener.redirectUri,
      clientId,
      ...(existing ? { accountId: existing.id } : {}),
      enablePlan: input.enablePlan === true,
      now: this.now(),
    });
    this.#pending = { transaction, close: () => listener.close() };
    const url = authorizationUrl(transaction, state.hostId, {
      ...(existing?.tokens?.idToken ? { idToken: existing.tokens.idToken } : {}),
      ...(existing?.email ? { email: existing.email } : {}),
    });
    this.log(redactAuthorizationUrl(url));
    try {
      await this.openBrowser(url);
      const params = await listener.result;
      return await this.#complete(params);
    } finally {
      this.#pending = undefined;
    }
  }

  cancelConnect() {
    this.#pending?.close();
    this.#pending = undefined;
  }

  async #complete(params: URLSearchParams) {
    const pending = this.#pending;
    if (!pending) throw new Error('ChatGPT sign-in is not waiting for a callback.');
    const { transaction } = pending;
    if (this.now() > transaction.expiresAt) throw new Error('ChatGPT sign-in expired. Try again.');
    const callback = readCallback(`?${params.toString()}`);
    if ('invalid' in callback || !safeEqual(callback.state, transaction.state))
      throw new Error('ChatGPT sign-in could not be verified.');
    if (callback.error) {
      if (callback.error === 'access_denied')
        throw new Error('ChatGPT access was declined. You can try again from full-screen settings.');
      throw new Error('ChatGPT sign-in was not completed.');
    }
    if (!callback.code) throw new Error('ChatGPT did not return an authorization code.');
    let clientId = transaction.clientId;
    if (transaction.clientId === DYNAMIC_CLIENT) {
      if (!callback.clientId || callback.clientId === DYNAMIC_CLIENT)
        throw new Error('ChatGPT did not finish registering Nudge.');
      clientId = callback.clientId;
    } else if (callback.clientId && callback.clientId !== transaction.clientId) {
      throw new Error('ChatGPT returned a different connection. Sign in was not saved.');
    }
    let tokens;
    try {
      tokens = await exchangeCode(
        {
          clientId,
          code: callback.code,
          verifier: transaction.verifier,
          redirectUri: transaction.redirectUri,
        },
        this.fetch,
      );
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'invalid_grant')
        throw new Error('That ChatGPT sign-in expired. Start Continue with ChatGPT again.', { cause: error });
      throw error;
    }
    if (!tokens.idToken) throw new Error('ChatGPT did not return an identity token.');
    const identity = await this.#verify(tokens.idToken, {
      audience: clientId,
      nonce: transaction.nonce,
    });
    const subject = String(identity.sub);
    const email = typeof identity.email === 'string' ? identity.email : 'ChatGPT account';
    const name = typeof identity.name === 'string' ? identity.name : undefined;
    const state = this.ensureHost();
    const scopes = tokens.scopes;
    if (transaction.accountId) {
      const account = state.accounts.find((item) => item.id === transaction.accountId);
      if (!account || account.subject !== subject || account.clientId !== clientId)
        throw new Error('This sign-in belongs to a different ChatGPT account and was not saved.');
      account.scopes = scopes;
      account.planUsage = planEnabled(scopes);
      account.email = email;
      if (name) account.name = name;
      account.tokens = tokenSet(tokens, this.now());
      state.activeAccountId = account.id;
      this.options.store.write(state);
      return publicAccount(account);
    }
    const duplicate = state.accounts.find(
      (account) => account.subject === subject && account.clientId === clientId,
    );
    if (duplicate) {
      duplicate.scopes = scopes;
      duplicate.planUsage = planEnabled(scopes);
      duplicate.tokens = tokenSet(tokens, this.now());
      state.activeAccountId = duplicate.id;
      this.options.store.write(state);
      return publicAccount(duplicate);
    }
    const account: AccountRecord = {
      id: randomUUID(),
      label: uniqueLabel(name, email, state.accounts),
      email,
      ...(name ? { name } : {}),
      issuer: 'https://auth.openai.com',
      subject,
      clientId,
      hostId: state.hostId,
      scopes,
      planUsage: scopes.includes(PLAN_SCOPE),
      tokens: tokenSet(tokens, this.now()),
    };
    state.accounts.push(account);
    state.activeAccountId = account.id;
    this.options.store.write(state);
    return publicAccount(account);
  }

  async disconnect(accountId: string) {
    const state = this.ensureHost();
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('That ChatGPT account is not saved on this computer.');
    let revocationConfirmed = true;
    if (account.tokens?.refreshToken) {
      revocationConfirmed = await revokeRefreshToken(
        { clientId: account.clientId, refreshToken: account.tokens.refreshToken },
        this.fetch,
      );
    }
    delete account.tokens;
    account.planUsage = false;
    if (state.activeAccountId === account.id) delete state.activeAccountId;
    this.options.store.write(state);
    return { revocationConfirmed, account: publicAccount(account) };
  }

  select(accountId: string) {
    const state = this.ensureHost();
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error('That ChatGPT account is not saved on this computer.');
    state.activeAccountId = account.id;
    this.options.store.write(state);
    return publicAccount(account);
  }

  async models(accountId: string, signal: AbortSignal): Promise<PlanModel[]> {
    const accessToken = await this.#accessToken(accountId, signal);
    return listPlanModels(accessToken, this.fetch, signal);
  }

  async browserStep(input: { accountId: string; model: string } & ({ type: 'plan'; request: PlannerRequest } | { type: 'scope'; request: ScopeRequest }), signal: AbortSignal) {
    const key = input.type === 'plan' ? `${input.accountId}:${input.model}:${input.request.taskId}` : undefined;
    const planner = new OpenAIPlanner({ responses: { create: async (value) => {
      const body = value as { input: unknown[]; tools: unknown[]; instructions: string };
      const turn = key && this.#browserTurn?.key === key ? this.#browserTurn : undefined;
      const previous = turn?.output ?? [];
      // Answer every earlier function call with its own call_id. The full new state is in the
      // next user message, so the output carries only the structured execution result.
      const results = previous.filter((item): item is { type: string; call_id: string } =>
        Boolean(item && typeof item === 'object' && (item as { type?: string }).type === 'function_call'))
        .map((call) => ({ type: 'function_call_output', call_id: call.call_id,
          output: JSON.stringify(
            turn?.error
              ? { error: `Your previous step was not executed: ${turn.error}. Return one valid emit_step.` }
              : input.type === 'plan' ? { result: input.request.lastResult ?? null } : {},
          ) }));
      const output = await this.respond({
        accountId: input.accountId, model: input.model, instructions: body.instructions, messages: [], onDelta: () => undefined,
        requestBody: { ...body, input: [...previous, ...results, ...body.input],
          tools: [{ type: 'namespace', name: 'nudge', description: 'Nudge browser actions executed locally by the extension after permission checks.', tools: body.tools }],
          tool_choice: 'required', parallel_tool_calls: false, include: ['reasoning.encrypted_content'], store: false, stream: true },
      }, signal);
      if (key) this.#browserTurn = { key, output };
      return { output };
    } } }, input.model);
    try {
      return input.type === 'plan' ? await planner.plan(input.request, signal) : await planner.scope(input.request, signal);
    } catch (error) {
      if (key && this.#browserTurn?.key === key)
        this.#browserTurn = { ...this.#browserTurn, error: error instanceof Error ? error.message.slice(0, 500) : 'invalid step' };
      throw error;
    }
  }

  async respond(
    input: {
      accountId: string;
      model: string;
      instructions: string;
      messages: ResponseInput[];
      onDelta: (text: string) => void;
      requestBody?: Record<string, unknown>;
    },
    signal: AbortSignal,
  ) {
    if (this.#inflight) throw new Error('A ChatGPT plan reply is already running.');
    const account = this.#account(input.accountId);
    if (!account.planUsage || !account.scopes.includes(PLAN_SCOPE))
      throw new Error('ChatGPT plan usage is off for this account. Enable it from full-screen settings, or choose API billing.');
    this.#inflight = true;
    let emitted = false;
    let refreshed = false;
    let retried = false;
    try {
      const body = input.requestBody ? JSON.stringify(input.requestBody) : responsesBody(input);
      for (;;) {
        try {
          const accessToken = await this.#accessToken(account.id, signal);
          const output = await readStream({
            accessToken,
            body,
            fetcher: this.fetch,
            signal,
            onDelta: (text) => {
              emitted = true;
              input.onDelta(text);
            },
          });
          return output;
        } catch (error) {
          if (signal.aborted || emitted) throw error;
          const plan = error instanceof PlanRequestError ? error : undefined;
          if (!refreshed && plan?.needsRefresh) {
            refreshed = true;
            await this.#refresh(account.id);
            continue;
          }
          if (!retried && plan?.retryable) {
            retried = true;
            await delay(400, signal);
            continue;
          }
          if (plan) throw new Error(`${explainPlanError(plan)} [${plan.code}; HTTP ${plan.httpStatus ?? 'stream'}; request ${plan.requestId ?? 'unavailable'}]`, { cause: error });
          throw error;
        }
      }
    } finally {
      this.#inflight = false;
    }
  }

  #verify(idToken: string, expected: { audience: string; nonce?: string }) {
    return this.keys
      ? verifyIdToken(idToken, expected, this.keys)
      : verifyIdToken(idToken, expected);
  }

  #account(accountId: string) {
    const account = this.ensureHost().accounts.find((item) => item.id === accountId);
    if (!account?.tokens) throw new Error('Connect ChatGPT again before sending a plan request.');
    return account;
  }

  async #accessToken(accountId: string, _signal: AbortSignal) {
    const account = this.#account(accountId);
    if (account.tokens!.expiresAt - 60_000 > this.now()) return account.tokens!.accessToken;
    await this.#refresh(account.id);
    return this.#account(accountId).tokens!.accessToken;
  }

  #refresh(accountId: string) {
    const existing = this.#refreshing.get(accountId);
    if (existing) return existing;
    const flight = this.#refreshOnce(accountId).finally(() => this.#refreshing.delete(accountId));
    this.#refreshing.set(accountId, flight);
    return flight;
  }

  async #refreshOnce(accountId: string) {
    const account = this.#account(accountId);
    try {
      const tokens = await refreshTokens(
        { clientId: account.clientId, refreshToken: account.tokens!.refreshToken },
        this.fetch,
      );
      if (tokens.idToken) {
        const identity = await this.#verify(tokens.idToken, { audience: account.clientId });
        if (identity.sub !== account.subject) {
          const latest = this.ensureHost();
          const current = latest.accounts.find((item) => item.id === accountId);
          if (current) delete current.tokens;
          this.options.store.write(latest);
          throw new Error('Refreshed ChatGPT credentials belonged to a different account.');
        }
      }
      const state = this.ensureHost();
      const current = state.accounts.find((item) => item.id === accountId);
      if (!current) throw new Error('That ChatGPT account is not saved on this computer.');
      const idToken = tokens.idToken ?? current.tokens?.idToken;
      current.tokens = tokenSet(
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          ...(idToken ? { idToken } : {}),
        },
        this.now(),
      );
      current.scopes = tokens.scopes.length ? tokens.scopes : current.scopes;
      current.planUsage = planEnabled(current.scopes);
      this.options.store.write(state);
    } catch (error) {
      if (refreshIsUnusable(error)) {
        const state = this.ensureHost();
        const current = state.accounts.find((item) => item.id === accountId);
        if (current) delete current.tokens;
        if (state.activeAccountId === accountId) delete state.activeAccountId;
        this.options.store.write(state);
        throw new Error('ChatGPT access expired. Continue with ChatGPT to reconnect.', { cause: error });
      }
      throw error;
    }
  }
}

function tokenSet(
  tokens: { accessToken: string; refreshToken: string; idToken?: string; expiresIn: number },
  now: number,
) {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken ?? '',
    expiresAt: now + tokens.expiresIn * 1000,
    savedAt: new Date(now).toISOString(),
  };
}

function uniqueLabel(name: string | undefined, email: string, accounts: AccountRecord[]) {
  const base = name && name !== email ? `${name} · ${email}` : email;
  const taken = new Set(accounts.map((account) => account.label));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} · ${index}`)) index += 1;
  return `${base} · ${index}`;
}

async function delay(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('Stopped'));
      },
      { once: true },
    );
  });
}

async function readStream(options: {
  accessToken: string;
  body: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}) {
  const response = await options.fetcher(RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: options.body,
    signal: options.signal,
  });
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (!response.ok) throw parseHttpError(response.status, await response.json().catch(() => ({})), requestId);
  if (!response.body) throw new PlanRequestError('ChatGPT returned an empty stream.', 'empty_stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let completed = false;
  let output: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = consumeSse(decoder.decode(value, { stream: true }), carry);
    carry = parsed.rest;
    for (const event of parsed.events) {
      const next = eventFromSse(event.event, event.data);
      if (!next) continue;
      if (next.type === 'delta' && next.text) options.onDelta(next.text);
      else if (next.type === 'output') output.push(...(next.output ?? []));
      else if (next.type === 'completed') { completed = true; if (next.output?.length) output = next.output; }
      else if (next.error) throw next.error;
    }
  }
  if (!completed) throw new PlanRequestError('The ChatGPT reply did not finish.', 'incomplete');
  return output;
}
