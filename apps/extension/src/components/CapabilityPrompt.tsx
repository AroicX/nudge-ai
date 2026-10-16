export function CapabilityPrompt({
  reason,
  onRetry,
  onDismiss,
}: {
  reason: string;
  onRetry(): void;
  onDismiss(): void;
}) {
  return (
    <section className="task-card task-card--capability" aria-label="Real mouse and keyboard input">
      <h2>This step needs real mouse and keyboard input</h2>
      <p>{reason}</p>
      <p className="task-card__note">
        While Nudge controls this tab’s input, Chrome shows a bar saying an extension “started debugging this browser”.
        Nudge attaches only to the task’s tab and detaches when the step is done. Clicking Cancel on that bar stops it.
      </p>
      <div className="task-card__actions">
        <button type="button" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="secondary" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
