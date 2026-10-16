import { z } from 'zod';

const ServerEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_AGENT_MODEL: z.string().min(1),
    OPENAI_REALTIME_MODEL: z.string().min(1).default('gpt-realtime'),
    OPENAI_TRANSCRIBE_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
    NUDGE_PAIRING_SECRET: z.string().min(16),
    NUDGE_SERVER_URL: z.string().optional(),
    NUDGE_PLANNER: z.enum(['live', 'scripted']).default('live'),
    NUDGE_PLANNER_SCRIPT: z.string().optional(),
    NODE_ENV: z.string().optional(),
  })
  .passthrough();

export interface ServerConfig {
  openAIApiKey: string;
  agentModel: string;
  realtimeModel: string;
  transcribeModel: string;
  pairingSecret: string;
  planner: 'live' | 'scripted';
  plannerScript?: string | undefined;
  host: '127.0.0.1';
  port: number;
}

export function loadConfig(environment: Record<string, string | undefined>): ServerConfig {
  const parsed = ServerEnvironmentSchema.parse(environment);
  const configuredUrl = new URL(parsed.NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317');
  if (configuredUrl.hostname !== '127.0.0.1' && configuredUrl.hostname !== 'localhost') {
    throw new Error('NUDGE_SERVER_URL must use a loopback hostname.');
  }
  if (parsed.NUDGE_PLANNER === 'scripted') {
    if (parsed.NODE_ENV === 'production') throw new Error('The scripted planner is test-only and cannot run in production.');
    if (!parsed.NUDGE_PLANNER_SCRIPT) throw new Error('NUDGE_PLANNER_SCRIPT is required for the scripted planner.');
  }
  return {
    planner: parsed.NUDGE_PLANNER,
    plannerScript: parsed.NUDGE_PLANNER_SCRIPT,
    openAIApiKey: parsed.OPENAI_API_KEY,
    agentModel: parsed.OPENAI_AGENT_MODEL,
    realtimeModel: parsed.OPENAI_REALTIME_MODEL,
    transcribeModel: parsed.OPENAI_TRANSCRIBE_MODEL,
    pairingSecret: parsed.NUDGE_PAIRING_SECRET,
    host: '127.0.0.1',
    port: configuredUrl.port ? Number(configuredUrl.port) : 4317,
  };
}
