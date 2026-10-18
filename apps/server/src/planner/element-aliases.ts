import type { PlannerRequest } from '@nudge/contracts';

const identityKeys = [
  'elementId',
  'fromElementId',
  'toElementId',
  'destinationElementId',
  'sourceElementId',
] as const;

function restoreIdentities(value: unknown, ids: ReadonlyMap<string, string>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const object = value as Record<string, unknown>;
  for (const key of identityKeys) {
    const id = object[key];
    if (typeof id === 'string' && ids.has(id)) object[key] = ids.get(id)!;
  }
}

/** Model-only aliases: document IDs remain authoritative and are never shortened. */
export function aliasPlannerElements(source: PlannerRequest): {
  request: PlannerRequest;
  restore(response: unknown): unknown;
} {
  const request = structuredClone(source);
  const aliases = new Map<string, string>();
  const originals = new Map<string, string>();
  for (const element of request.observation?.snapshot.elements ?? []) {
    let alias = aliases.get(element.id);
    if (!alias) {
      alias = `local:${aliases.size + 1}`;
      aliases.set(element.id, alias);
      originals.set(alias, element.id);
    }
    element.id = alias;
  }
  return {
    request,
    restore(response) {
      const restored: unknown = structuredClone(response);
      if (!restored || typeof restored !== 'object' || Array.isArray(restored)) return restored;
      const object = restored as Record<string, unknown>;
      // Identity slots live here in the planner contract. Do not recurse through
      // records, authorization, text, or other arbitrary user-provided payloads.
      restoreIdentities(object.toolCall, originals);
      restoreIdentities(object.expectation, originals);
      return restored;
    },
  };
}
