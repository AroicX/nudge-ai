import { z } from 'zod';

const ServerEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_AGENT_MODEL: z.string().min(1),
    NUDGE_PAIRING_SECRET: z.string().min(16),
    NUDGE_SERVER_URL: z.string().optional(),
  })
  .passthrough();

export interface ServerConfig {
  openAIApiKey: string;
  agentModel: string;
  pairingSecret: string;
  host: '127.0.0.1';
  port: number;
}

export function loadConfig(environment: Record<string, string | undefined>): ServerConfig {
  const parsed = ServerEnvironmentSchema.parse(environment);
  const configuredUrl = new URL(parsed.NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317');
  if (configuredUrl.hostname !== '127.0.0.1' && configuredUrl.hostname !== 'localhost') {
    throw new Error('NUDGE_SERVER_URL must use a loopback hostname.');
  }
  return {
    openAIApiKey: parsed.OPENAI_API_KEY,
    agentModel: parsed.OPENAI_AGENT_MODEL,
    pairingSecret: parsed.NUDGE_PAIRING_SECRET,
    host: '127.0.0.1',
    port: configuredUrl.port ? Number(configuredUrl.port) : 4317,
  };
}
