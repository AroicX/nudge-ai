import type { PlannerRequest } from '@nudge/contracts';

// Leaves room for system instructions and the response in the local 8K context.
// Count UTF-8 bytes, not JS characters, so non-Latin pages cannot evade the cap.
export const MAX_LOCAL_REQUEST_BYTES = 18_000;
const NOTICE =
  'Context was compacted: page content, tabs, successful history and sources may be omitted. Do not infer absence or task completion from omitted content. Observe/read more when needed; never repeat uncertain actions.';
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function encode(value: PlannerRequest & { contextNotice?: string }): string {
  const rest = { ...value } as Partial<typeof value>;
  delete rest.requestId;
  delete rest.taskId;
  return JSON.stringify({
    ...rest,
    memory: { ...value.memory, ...(value.memory.goal === value.goal ? { goal: undefined } : {}) },
    tabs: value.tabs.map((entry) => {
      const tab: Partial<typeof entry> = { ...entry };
      delete tab.lastSeenAt;
      delete tab.favIconUrl;
      return tab;
    }),
  });
}

/** Model-only serialization; contextNotice describes omissions, not new authority. */
export function serializeCompactPlannerRequest(request: PlannerRequest): string {
  if (size(request) <= MAX_LOCAL_REQUEST_BYTES) return encode(request);
  const compact = structuredClone(request) as PlannerRequest & { contextNotice: string };
  compact.contextNotice = NOTICE;
  if (compact.notes.length < 20) compact.notes.push(NOTICE);
  // Authorization, constraints, user data, plan, issues, notes, tab roles and last
  // result stay verbatim. Failed/uncertain operations must never disappear.
  compact.memory.steps = compact.memory.steps.filter(
    (step, index, steps) => !step.ok || step.uncertain || index >= steps.length - 4,
  );
  compact.memory.sources = [];
  compact.tabs = compact.tabs.filter((tab) => tab.tabId === request.observation?.tabId);
  if (compact.observation) {
    compact.observation.snapshot.elements = [];
    compact.observation.snapshot.text = [];
    compact.observation.snapshot.truncated = true;
  }
  if (size(compact) > MAX_LOCAL_REQUEST_BYTES) {
    throw new Error(
      'Local planner authorization, constraints and essential safety context exceed the request budget. Shorten the task or use a larger-context provider.',
    );
  }

  const terms = [
    ...new Set(
      `${request.goal} ${request.memory.constraints.map((item) => item.text).join(' ')}`
        .toLowerCase()
        .match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    ),
  ].filter(
    (term) =>
      !['the', 'and', 'for', 'find', 'please', 'this', 'that', 'with', 'from'].includes(term),
  );
  const relevance = (text: string) =>
    terms.reduce((score, term) => score + Number(text.toLowerCase().includes(term)), 0);
  const add = <T>(list: T[], value: T, budget = MAX_LOCAL_REQUEST_BYTES) => {
    list.push(value);
    if (size(compact) > budget) list.pop();
  };
  const baseline = size(compact);
  const available = MAX_LOCAL_REQUEST_BYTES - baseline;
  const snapshot = compact.observation?.snapshot;
  const original = request.observation?.snapshot;
  if (snapshot && original) {
    const controls = new Set(['input', 'textarea', 'select', 'checkbox', 'editable']);
    const ranked = original.elements
      .map((element, index) => ({
        element,
        index,
        score:
          relevance(
            [element.name, element.text, element.label, element.href].filter(Boolean).join(' '),
          ) *
            10 +
          (controls.has(element.kind) ? 100 : 0) +
          (element.formHasSensitiveField ? 100 : 0) +
          (element.kind === 'button' ? 5 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    for (const { element } of ranked) {
      // Preserve IDs, destinations, values and safety flags; descriptions and
      // long option lists are excerpts, covered by the explicit truncation note.
      add(
        snapshot.elements,
        {
          ...element,
          ...(element.name ? { name: element.name.slice(0, 240) } : {}),
          ...(element.text ? { text: element.text.slice(0, 300) } : {}),
          ...(element.label ? { label: element.label.slice(0, 240) } : {}),
          ...(element.options ? { options: element.options.slice(0, 12) } : {}),
        },
        baseline + Math.floor(available * 0.65),
      );
    }
    for (const text of [...original.text].sort((a, b) => relevance(b) - relevance(a))) {
      add(snapshot.text, text.slice(0, 500), baseline + Math.floor(available * 0.9));
    }
  }
  for (const tab of [...request.tabs].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      relevance(`${b.title} ${b.url}`) - relevance(`${a.title} ${a.url}`),
  )) {
    if (!compact.tabs.some((entry) => entry.tabId === tab.tabId)) add(compact.tabs, tab);
  }
  return encode(compact);
}
