import type { OperationPreview } from '@nudge/contracts';

export function PreviewCard({
  preview,
  onConfirm,
}: {
  preview: OperationPreview;
  onConfirm(previewId: string, approved: boolean): void;
}) {
  const items = `${preview.count} item${preview.count === 1 ? '' : 's'}`;
  const verb = preview.operation.split(' ')[0] ?? 'Do';
  return (
    <section className="task-card task-card--preview" aria-label="Confirm this action">
      <p className="task-card__eyebrow">Check before I continue</p>
      <h2>{preview.operation}</h2>
      <dl>
        <dt>Where</dt>
        <dd>{preview.location}</dd>
        <dt>Which</dt>
        <dd>{preview.criteria}</dd>
        <dt>How many</dt>
        <dd>{items}</dd>
      </dl>
      {preview.samples.length ? (
        <ul className="task-card__samples">
          {preview.samples.map((sample) => (
            <li key={sample}>{sample}</li>
          ))}
        </ul>
      ) : null}
      <p className={preview.permanent ? 'task-card__warning' : 'task-card__note'}>
        {preview.permanent
          ? 'This is permanent and cannot be undone.'
          : preview.reversible
            ? 'This can be undone (for example from Trash).'
            : 'This may be hard to undo.'}
      </p>
      <div className="task-card__actions">
        <button type="button" className={preview.permanent ? 'danger' : undefined} onClick={() => onConfirm(preview.previewId, true)}>
          {verb} {items}
        </button>
        <button type="button" className="secondary" onClick={() => onConfirm(preview.previewId, false)}>
          Don’t do it
        </button>
      </div>
    </section>
  );
}
