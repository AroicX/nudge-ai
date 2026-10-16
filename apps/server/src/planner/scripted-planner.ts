import {
  PlannerResponseSchema,
  ScopeResponseSchema,
  type PlannerRequest,
  type PlannerResponse,
  type ScopeRequest,
  type ScopeResponse,
} from '@nudge/contracts';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import { withoutScreenshot, type PlannerProvider } from './planner-provider';

/**
 * Test-only deterministic planner. Scenario steps are tool-call templates whose
 * element and tab references are resolved against the observation it receives,
 * so the extension still observes, validates, executes and verifies for real.
 */
export interface ScriptStep {
  when?: { textPresent?: string; urlIncludes?: string };
  call: Record<string, unknown>;
  planUpdate?: unknown;
  expectation?: unknown;
  riskLabel?: 'none' | 'consequential';
}

export interface Scenario {
  match: string;
  scope: Record<string, unknown> & { goal: string; recordFields?: string[] };
  steps: ScriptStep[];
  versions?: Record<string, ScriptStep[]>;
}

export interface ScenarioFile {
  scenarios: Scenario[];
}

const ELEMENT_KEYS = new Set(['elementId', 'fromElementId', 'toElementId', 'destinationElementId']);
const TAB_KEYS = new Set(['tabId', 'sourceTabId', 'destinationTabId']);

type ElementRef = { byName?: string; byText?: string; byLabel?: string; kind?: string };

class Unresolved extends Error {}

export class ScriptedPlanner implements PlannerProvider {
  readonly log: unknown[] = [];
  #scenarios: Scenario[];
  #cursors = new Map<string, number>();

  constructor(file: ScenarioFile) {
    this.#scenarios = file.scenarios;
  }

  static fromPath(path: string): ScriptedPlanner {
    return new ScriptedPlanner(JSON.parse(readFileSync(path, 'utf8')) as ScenarioFile);
  }

  replace(file: ScenarioFile): void {
    this.#scenarios = file.scenarios;
    this.#cursors.clear();
    this.log.length = 0;
  }

  async capabilities() {
    return { tools: true, vision: true };
  }

  #scenario(text: string): Scenario {
    const scenario = this.#scenarios.find((candidate) => new RegExp(candidate.match, 'i').test(text));
    if (!scenario) throw new Error(`No scripted scenario matches: ${text.slice(0, 80)}`);
    return scenario;
  }

  async scope(request: ScopeRequest, _signal?: AbortSignal): Promise<ScopeResponse> {
    this.log.push({ kind: 'scope', request });
    const { goal, recordFields, ...proposal } = this.#scenario(request.instruction).scope;
    return ScopeResponseSchema.parse({ requestId: request.requestId, goal, proposal, ...(recordFields ? { recordFields } : {}) });
  }

  async plan(request: PlannerRequest, _signal?: AbortSignal): Promise<PlannerResponse> {
    this.log.push({ kind: 'plan', request: withoutScreenshot(request) });
    const scenario = this.#scenarios.find((candidate) => new RegExp(candidate.match, 'i').test(request.authorization.instruction)) ?? this.#scenario(request.goal);
    const version = String(request.instructionVersion);
    const steps = (request.instructionVersion > 0 && scenario.versions?.[version]) || scenario.steps;
    const key = `${request.taskId}:${steps === scenario.steps ? '0' : version}`;
    const index = this.#cursors.get(key) ?? 0;
    const step = steps[index];
    const waitTab = request.observation?.tabId ?? request.tabs[0]?.tabId ?? 0;
    const wait = (reason: string): PlannerResponse => ({
      requestId: request.requestId,
      toolCall: { tool: 'wait_for', tabId: waitTab, condition: { kind: 'idle' }, timeoutMs: 500 },
      planUpdate: [{ id: 'script', text: reason.slice(0, 500), status: 'active' }],
    });
    if (!step) {
      return { requestId: request.requestId, toolCall: { tool: 'report_partial', done: [], remaining: ['Script exhausted'], reason: 'The scripted scenario has no more steps.' } };
    }
    if (step.when && !this.#conditionMet(step.when, request)) return wait('Waiting for the page.');
    let call: unknown;
    try {
      call = this.#resolve(step.call, request, undefined);
    } catch (error) {
      if (error instanceof Unresolved) return wait(error.message);
      throw error;
    }
    this.#cursors.set(key, index + 1);
    return PlannerResponseSchema.parse({
      requestId: request.requestId,
      toolCall: call,
      ...(step.planUpdate ? { planUpdate: step.planUpdate } : {}),
      ...(step.expectation ? { expectation: this.#resolve(step.expectation, request, undefined) } : {}),
      ...(step.riskLabel ? { riskLabel: step.riskLabel } : {}),
    });
  }

  #corpus(request: PlannerRequest): string {
    const snapshot = request.observation?.snapshot;
    if (!snapshot) return '';
    return [...snapshot.text, ...snapshot.elements.flatMap((element) => [element.name ?? '', element.text ?? '', element.value ?? ''])]
      .join('\n')
      .toLowerCase();
  }

  #conditionMet(when: NonNullable<ScriptStep['when']>, request: PlannerRequest): boolean {
    if (when.textPresent && !this.#corpus(request).includes(when.textPresent.toLowerCase())) return false;
    if (when.urlIncludes && !request.observation?.snapshot.url.includes(when.urlIncludes)) return false;
    return true;
  }

  #element(ref: ElementRef, request: PlannerRequest) {
    const elements = (request.observation?.snapshot.elements ?? []).filter((element) => !ref.kind || element.kind === ref.kind);
    const wanted = (ref.byName ?? ref.byText ?? ref.byLabel ?? '').toLowerCase();
    const field = (element: (typeof elements)[number]) =>
      (ref.byName !== undefined ? element.name : ref.byText !== undefined ? element.text : element.label)?.toLowerCase() ?? '';
    const match = elements.find((element) => field(element) === wanted) ?? elements.find((element) => field(element).includes(wanted));
    if (!match) throw new Unresolved(`Looking for “${wanted}”.`);
    return match;
  }

  #resolve(value: unknown, request: PlannerRequest, key: string | undefined): unknown {
    if (Array.isArray(value)) return value.map((item) => this.#resolve(item, request, key));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (key && ELEMENT_KEYS.has(key) && ('byName' in record || 'byText' in record || 'byLabel' in record)) {
      return this.#element(record as ElementRef, request).id;
    }
    if (key && TAB_KEYS.has(key)) {
      if (record.bound === true) {
        if (request.observation === null) throw new Unresolved('No bound tab observed yet.');
        return request.observation.tabId;
      }
      if (typeof record.byUrl === 'string') {
        const tab = request.tabs.find((candidate) => candidate.url.includes(record.byUrl as string));
        if (!tab) throw new Unresolved(`No tab with ${record.byUrl}.`);
        return tab.tabId;
      }
    }
    if (key === 'screenshotId' && record.latest === true) {
      const id = request.observation?.screenshot?.frame.screenshotId;
      if (!id) throw new Unresolved('Waiting for a screenshot.');
      return id;
    }
    if ('relativeTo' in record) {
      const element = this.#element(record.relativeTo as ElementRef, request);
      const axis = (record.axis as string | undefined) ?? (key === 'y' ? 'y' : 'x');
      const rect = element.rect;
      if (!rect) throw new Unresolved('Element has no position.');
      return Math.round((axis === 'y' ? rect.y : rect.x) + Number(record.offset ?? 0));
    }
    return Object.fromEntries(Object.entries(record).map(([childKey, child]) => [childKey, this.#resolve(child, request, childKey)]));
  }
}

export const ScenarioFileSchema = z.object({ scenarios: z.array(z.any()) });
