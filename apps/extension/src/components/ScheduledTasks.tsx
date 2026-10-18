import type { ScheduledTask } from '@nudge/contracts';
import { useState } from 'react';
import { Clock3, Pencil, Play, Trash2 } from 'lucide-react';
import { ConfirmDelete } from './ConfirmDelete';

export function ScheduledTasks({
  jobs,
  onCancel,
  activeTaskId,
  onManage,
}: {
  jobs: ScheduledTask[];
  onCancel(id: string): void;
  activeTaskId?: string | undefined;
  onManage?: ((id: string, action: 'run' | 'delete' | 'update', changes?: { instruction?: string; runAt?: number }) => void) | undefined;
}) {
  const [editing, setEditing] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [time, setTime] = useState('');
  if (!jobs.length) return null;
  return (
    <details className="scheduled-tasks" open>
      <summary>
        Scheduled tasks ({jobs.filter((job) => job.status === 'pending').length} pending)
      </summary>
      <ul>
        {jobs
          .slice()
          .reverse()
          .map((job) => (
            <li key={job.id}>
              <strong><Clock3 size={14} aria-hidden="true" /> {job.instruction}</strong>
              <span>
                {new Date(job.runAt).toLocaleString()} ·{' '}
                {job.provider === 'ollama' ? 'Ollama' : 'OpenAI'}
              </span>
              <span title={job.originUrl}>
                {new URL(job.originUrl).hostname} ·{' '}
                {job.status === 'attention' ? 'Needs attention' : job.status}
              </span>
              {job.detail ? <p>{job.detail}</p> : null}
              {onManage && job.status === 'pending' ? <div className="schedule-actions">
                <button type="button" aria-label={`Run scheduled task now: ${job.instruction}`} onClick={() => onManage(job.id, 'run')}><Play size={13} aria-hidden="true"/>Run now</button>
                <button type="button" aria-label={`Edit scheduled task: ${job.instruction}`} onClick={() => { setEditing(job.id); setInstruction(job.instruction); const date = new Date(job.runAt); setTime(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16)); }}><Pencil size={13} aria-hidden="true"/>Edit</button>
              </div> : null}
              {editing === job.id ? <form className="memory-form" onSubmit={(event) => { event.preventDefault(); const runAt = new Date(time).getTime(); if (Number.isFinite(runAt) && runAt > Date.now()) { onManage?.(job.id, 'update', { instruction, runAt }); setEditing(undefined); } }}>
                <label>Task instruction<textarea required value={instruction} maxLength={4000} onChange={(event) => setInstruction(event.target.value)}/></label>
                <label>Run at<input required type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)}/></label>
                <button type="submit" disabled={!instruction.trim() || !(new Date(time).getTime() > Date.now())}>Save schedule</button>
                <button type="button" onClick={() => setEditing(undefined)}>Discard edits</button>
              </form> : null}
              {job.status === 'pending' ||
              (job.status === 'attention' && job.id !== activeTaskId) ? (
                <button
                  type="button"
                  onClick={() => onCancel(job.id)}
                  aria-label={`${job.status === 'pending' ? 'Cancel' : 'Dismiss'} scheduled task: ${job.instruction}`}
                >
                  {job.status === 'pending' ? 'Cancel' : 'Dismiss'}
                </button>
              ) : null}
              {onManage && job.status !== 'running' && job.id !== activeTaskId ? <ConfirmDelete title="Delete this scheduled task?" description="This removes its schedule and saved run status. Any already completed browser actions remain." onConfirm={() => onManage(job.id, 'delete')}><button type="button" aria-label={`Delete scheduled task: ${job.instruction}`}><Trash2 size={13} aria-hidden="true"/>Delete</button></ConfirmDelete> : null}
            </li>
          ))}
      </ul>
      <small>
        Chrome and the Nudge server must be running. Tasks may wait for your confirmation.
      </small>
    </details>
  );
}
