import type { ExtractedRecord, FinalReport, MemoryStep, PlanItem, TabRole, TaskMemory } from '@nudge/contracts';

const MAX_FULL_STEPS = 30;
const PLANNER_STEPS = 8;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createMemory(goal: string, recordFields: string[] = []): TaskMemory {
  return {
    goal: clip(goal, 4_000),
    constraints: [],
    userData: [],
    plan: [],
    steps: [],
    tabs: [],
    recordFields,
    recordCount: 0,
    sources: [],
    issues: [],
  };
}

export function appendStep(memory: TaskMemory, step: MemoryStep): TaskMemory {
  const cleaned: MemoryStep = {
    ...step,
    summary: clip(step.summary, 1_000),
    ...(step.evidence ? { evidence: clip(step.evidence, 1_000) } : {}),
  };
  const existingSummary = memory.steps[0]?.tool === 'summary' ? memory.steps[0] : undefined;
  const detailed = existingSummary ? memory.steps.slice(1) : memory.steps;
  const all = [...detailed, cleaned];
  if (all.length <= MAX_FULL_STEPS) {
    return { ...memory, steps: existingSummary ? [existingSummary, ...all] : all };
  }
  const overflow = all.length - MAX_FULL_STEPS;
  const previous = existingSummary ? Number(/^(\d+)/.exec(existingSummary.summary)?.[1] ?? 0) : 0;
  const summarised = previous + overflow;
  return {
    ...memory,
    steps: [
      { tool: 'summary', summary: `${summarised} earlier steps completed (details omitted).`, ok: true },
      ...all.slice(overflow),
    ],
  };
}

export function applyPlanUpdate(memory: TaskMemory, plan: PlanItem[]): TaskMemory {
  return { ...memory, plan: plan.slice(0, 40) };
}

export function addConstraint(memory: TaskMemory, text: string, instructionVersion: number): TaskMemory {
  return { ...memory, constraints: [...memory.constraints, { text: clip(text, 2_000), instructionVersion }].slice(-50) };
}

export function setTabRole(memory: TaskMemory, tab: { tabId: number; title: string; url: string }, role: TabRole): TaskMemory {
  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    origin = '';
  }
  const tabs = memory.tabs.filter((existing) => existing.tabId !== tab.tabId);
  return { ...memory, tabs: [...tabs, { tabId: tab.tabId, role, title: clip(tab.title, 500), origin }].slice(-50) };
}

export function addIssue(memory: TaskMemory, text: string): TaskMemory {
  if (memory.issues.includes(text)) return memory;
  return { ...memory, issues: [...memory.issues, clip(text, 1_000)].slice(-30) };
}

export function addSource(memory: TaskMemory, url: string): TaskMemory {
  if (memory.sources.includes(url)) return memory;
  return { ...memory, sources: [...memory.sources, url].slice(-100) };
}

export function plannerView(memory: TaskMemory): TaskMemory {
  return {
    ...memory,
    steps: memory.steps.slice(-PLANNER_STEPS),
    userData: memory.userData.filter((item) => !item.sensitive),
  };
}

export function buildReport(
  memory: TaskMemory,
  records: ExtractedRecord[],
  outcome: FinalReport['outcome'],
  summary: string,
  exports: string[],
): FinalReport {
  const steps = memory.steps.filter((step) => step.tool !== 'summary');
  const verified = steps
    .filter((step) => step.ok && step.evidence && !step.uncertain)
    .map((step) => `${step.summary} (${step.evidence})`);
  const unverified = steps
    .filter((step) => step.uncertain || (step.ok && !step.evidence && !['observe_tab', 'list_tabs', 'read_text', 'inspect_element', 'wait_for', 'ask_user', 'request_confirmation', 'finish', 'report_partial'].includes(step.tool)))
    .map((step) => step.summary);
  const skipped = memory.plan
    .filter((item) => item.status === 'skipped')
    .map((item) => ({
      item: item.text,
      reason: memory.issues.find((issue) => issue.toLowerCase().includes(item.text.toLowerCase())) ?? 'Skipped.',
    }));
  const partial = memory.plan.filter((item) => item.status === 'pending' || item.status === 'active').map((item) => item.text);
  const savedRecords = records.filter((record) => record.saved.destination).length;
  if (records.length > 0) {
    verified.push(`${records.length} records collected${savedRecords ? `, ${savedRecords} written and read back` : ''}`);
  }
  return {
    outcome,
    summary: clip(summary, 4_000),
    verified: verified.slice(-100),
    partial: partial.slice(-100),
    unverified: unverified.slice(-100),
    skipped: skipped.slice(-100),
    sources: memory.sources.slice(-100),
    exports,
  };
}
