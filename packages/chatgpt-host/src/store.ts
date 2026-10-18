import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PLAN_SCOPE } from './constants';

export interface TokenSet {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  savedAt: string;
}

export interface AccountRecord {
  id: string;
  label: string;
  email: string;
  name?: string;
  issuer: string;
  subject: string;
  clientId: string;
  hostId: string;
  scopes: string[];
  planUsage: boolean;
  tokens?: TokenSet;
}

export interface HostState {
  hostId: string;
  activeAccountId?: string;
  accounts: AccountRecord[];
}

export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.NUDGE_CHATGPT_DIR ||
    (env.NUDGE_DATA_DIR
      ? join(env.NUDGE_DATA_DIR, 'chatgpt')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Nudge', 'chatgpt')
        : join(homedir(), '.local', 'share', 'nudge', 'chatgpt'))
  );
}

export function planEnabled(scopes: string[]): boolean {
  return scopes.includes(PLAN_SCOPE);
}

export function publicAccount(account: AccountRecord) {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    planUsage: account.planUsage,
    signedIn: Boolean(account.tokens?.accessToken && account.tokens.refreshToken),
  };
}

function writePrivate(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export class AccountStore {
  constructor(private readonly file: string) {}

  read(): HostState | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as HostState;
      if (!parsed || typeof parsed.hostId !== 'string' || !Array.isArray(parsed.accounts))
        return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  write(state: HostState): void {
    writePrivate(this.file, JSON.stringify(state));
  }
}
