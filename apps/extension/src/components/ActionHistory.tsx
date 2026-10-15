import type { ActionResult } from '@nudge/contracts';

export function ActionHistory({
  actions,
  onClear,
}: {
  actions: ActionResult[];
  onClear: (() => void) | undefined;
}) {
  if (!actions.length) return null;
  return (
    <details className="history">
      <summary>
        {actions.length} action{actions.length === 1 ? '' : 's'}
      </summary>
      <ol>
        {actions.map((action, index) => (
          <li key={`${action.actionType}-${index}`}>{action.detail}</li>
        ))}
      </ol>
      {onClear ? (
        <button type="button" className="link" onClick={onClear}>
          Clear history
        </button>
      ) : null}
    </details>
  );
}
