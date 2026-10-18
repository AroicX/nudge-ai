import type { ChatGptAccount } from '../chatgpt/companion';
import { CHATGPT_PRIVACY, CHATGPT_VOICE_NOTE } from '../chatgpt/text-route';

export interface ChatGptPanelProps {
  accounts: ChatGptAccount[];
  activeAccountId?: string | undefined;
  busy: boolean;
  error?: string | undefined;
  limitReached: boolean;
  welcome: boolean;
  connected: boolean;
  onConnect(): void;
  onReconnect(accountId: string): void;
  onAddAccount(): void;
  onEnablePlan(accountId: string): void;
  onDisconnect(accountId: string): void;
  onSelect(accountId: string): void;
  onDismissWelcome(): void;
  onManageUsage(): void;
}

export function ChatGptPanel({
  accounts,
  activeAccountId,
  busy,
  error,
  limitReached,
  welcome,
  connected,
  onConnect,
  onReconnect,
  onAddAccount,
  onEnablePlan,
  onDisconnect,
  onSelect,
  onDismissWelcome,
  onManageUsage,
}: ChatGptPanelProps) {
  const active = accounts.find((account) => account.id === activeAccountId);
  return (
    <section className="chatgpt-panel" aria-label="ChatGPT plan">
      <div className="chatgpt-panel__copy">
        <h2>Use your ChatGPT plan</h2>
        <p>Complete eligible text requests with usage included in your ChatGPT plan or credits. This is separate from OpenAI API billing.</p>
        <ul>
          {CHATGPT_PRIVACY.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{CHATGPT_VOICE_NOTE}</p>
      </div>
      {connected && active ? (
        <p className="chatgpt-panel__status">
          Using ChatGPT plan
          <span>{active.label}</span>
          <button type="button" className="link" onClick={onManageUsage}>
            Manage usage
          </button>
        </p>
      ) : (
        <button type="button" className="chatgpt-connect" disabled={busy} onClick={onConnect}>
          Continue with ChatGPT
        </button>
      )}
      {accounts.length > 1 ? (
        <label>
          ChatGPT account
          <select
            aria-label="ChatGPT account"
            value={activeAccountId ?? ''}
            onChange={(event) => onSelect(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
                {account.signedIn ? '' : ' (signed out)'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="chatgpt-panel__actions">
        {active && !active.signedIn ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => onReconnect(active.id)}>
            Reconnect
          </button>
        ) : null}
        {active?.signedIn && !active.planUsage ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => onEnablePlan(active.id)}>
            Enable ChatGPT plan usage
          </button>
        ) : null}
        {accounts.length ? (
          <button type="button" className="secondary" disabled={busy} onClick={onAddAccount}>
            Add ChatGPT account
          </button>
        ) : null}
        {active?.signedIn ? (
          <button type="button" className="secondary" disabled={busy} onClick={() => onDisconnect(active.id)}>
            Disconnect
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="provider-error">
          {error}{' '}
          {limitReached ? (
            <button type="button" onClick={onManageUsage}>
              Manage usage
            </button>
          ) : null}
        </p>
      ) : null}
      {!active?.planUsage && active?.signedIn ? (
        <p>ChatGPT plan usage is off for this account. Enable it, or choose an API key or a local model.</p>
      ) : null}
      {welcome ? (
        <div className="chatgpt-welcome" role="dialog" aria-labelledby="chatgpt-welcome-title">
          <h3 id="chatgpt-welcome-title">You&apos;re using your ChatGPT plan</h3>
          <p>Eligible text in Nudge uses your ChatGPT plan. You can manage usage in ChatGPT settings.</p>
          <button type="button" onClick={onDismissWelcome}>
            Got it
          </button>
        </div>
      ) : null}
    </section>
  );
}
