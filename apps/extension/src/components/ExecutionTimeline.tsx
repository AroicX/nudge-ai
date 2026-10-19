import type { ControllerSnapshot, TimelineStep } from '@nudge/contracts';
import { AlertCircle, Check, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Reasoning, ReasoningContent, ReasoningTrigger } from '../../components/nexus-ui/reasoning';
import { Tool, ToolContent, ToolInput, ToolOutput, ToolTrigger, type ToolStatus } from './nexus-ui/tool';

type Props = {
  steps: TimelineStep[];
  status?: ControllerSnapshot['status'] | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  showTimings?: boolean;
  historical?: boolean;
};

function isPlannerTick(label: string) {
  return (
    label === 'Choosing the next step' ||
    label === 'Chose the next step' ||
    label === 'Discarded a step planned before your change'
  );
}

function seconds(start: number | undefined, end: number | undefined) {
  return start === undefined || end === undefined
    ? undefined
    : Math.max(0, Math.floor((end - start) / 1000));
}

function formatElapsed(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  if (hours > 0) {
    const parts = [`${hours}h`];
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainder > 0) parts.push(`${remainder}s`);
    return parts.join(' ');
  }
  if (minutes > 0) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  return `${remainder}s`;
}

export function ExecutionTimeline({
  steps,
  status,
  startedAt,
  completedAt,
  showTimings = false,
  historical = false,
}: Props) {
  const [now, setNow] = useState(Date.now);
  const complete = status === 'completed';
  const terminal =
    complete || status === 'failed' || status === 'cancelled' || status === 'partially_completed';
  const interrupted = historical && !terminal;
  const lastKnownAt = [
    completedAt,
    startedAt,
    ...steps.flatMap((step) => [step.startedAt, step.completedAt]),
  ]
    .filter((time): time is number => time !== undefined)
    .reduce<number | undefined>((latest, time) => Math.max(latest ?? time, time), undefined);
  const streaming =
    !interrupted &&
    !terminal &&
    status !== 'paused' &&
    status !== 'waiting_for_confirmation' &&
    status !== 'waiting_for_user' &&
    status !== 'idle';
  const timed =
    startedAt !== undefined ||
    steps.some((step) => step.startedAt !== undefined && step.status === 'active');
  const clockRunning = streaming && timed && showTimings;
  useEffect(() => {
    if (!clockRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockRunning]);
  const shown = steps.filter((step) => !isPlannerTick(step.label));
  if (!shown.length && !terminal) return null;
  const hasError = status === 'failed' || shown.some((step) => step.status === 'error');
  const current = shown.findLast((step) => step.status === 'active') ?? shown.at(-1);
  const label = interrupted
    ? 'Task interrupted'
    : complete
      ? 'Task completed'
      : status === 'cancelled'
        ? 'Task stopped'
        : status === 'partially_completed'
          ? 'Task partially completed'
          : hasError
            ? 'Nudge needs attention'
            : status === 'paused'
              ? 'Task paused'
              : (current?.label ?? 'Working');
  const taskSeconds = seconds(
    startedAt,
    completedAt ?? (interrupted ? lastKnownAt : terminal ? undefined : now),
  );
  return (
    <section className="execution-timeline" aria-label="Action progress">
      <div role="status" aria-live="polite" className="sr-only">
        {label}
      </div>
      <Reasoning isStreaming={streaming && !hasError} complete={complete}>
        <div className="reasoning__header">
          <ReasoningTrigger
            aria-label={
              interrupted || terminal || hasError || status === 'paused'
                ? label
                : `Nudge is working: ${label}`
            }
          >
            {label}
          </ReasoningTrigger>
          {showTimings && taskSeconds !== undefined ? (
            <span className="reasoning__duration" aria-label="Task elapsed time">
              {formatElapsed(taskSeconds)}
            </span>
          ) : null}
        </div>
        <ReasoningContent>
          {showTimings ? (
            <div className="nudge-tool-list">
              {shown.map((step) => {
                const status = toolStatus(step.status, interrupted);
                const duration = stepDuration(step, { interrupted, terminal, lastKnownAt, now });
                return (
                  <div key={step.id} className="nudge-tool-row">
                    <Tool status={status} defaultOpen={step.status === 'active' || step.status === 'error'}>
                      <ToolTrigger name={step.label} />
                      <ToolContent>
                        <ToolInput payload={{ action: step.label, ...(step.detail ? { detail: step.detail } : {}) }} />
                        <ToolOutput
                          {...(step.sources?.length
                            ? { payload: { sources: step.sources.map((source) => source.domain) } }
                            : step.detail
                              ? { payload: step.detail }
                              : {})}
                          errorText={step.detail ?? 'This step failed.'}
                          showWhen={['completed', 'error']}
                        />
                      </ToolContent>
                    </Tool>
                    {duration !== undefined ? (
                      <span className="reasoning__duration" aria-label={`${step.label} elapsed time`}>
                        {formatElapsed(duration)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
          <ol className="reasoning__steps">
            {shown.map((step) => {
              const duration = stepDuration(step, { interrupted, terminal, lastKnownAt, now });
              const Icon =
                step.status === 'error'
                  ? AlertCircle
                  : step.status === 'completed'
                    ? Check
                    : Circle;
              return (
                <li
                  className="reasoning__step"
                  data-status={
                    interrupted && step.status === 'active' ? 'interrupted' : step.status
                  }
                  key={step.id}
                >
                  <div className="reasoning__step-title">
                    <Icon size={14} aria-hidden="true" />
                    <span className="sr-only">
                      {interrupted && step.status === 'active' ? 'interrupted' : step.status}:{' '}
                    </span>
                    <span>{step.label}</span>
                    {showTimings && duration !== undefined ? (
                      <span
                        className="reasoning__duration"
                        aria-label={`${step.label} elapsed time`}
                      >
                        {formatElapsed(duration)}
                      </span>
                    ) : null}
                  </div>
                  {step.detail || step.sources?.length ? (
                    <div className="reasoning__detail">
                      {step.detail ? <p>{step.detail}</p> : null}
                      {step.sources?.map((source) => (
                        <span className="timeline-source" key={`${source.tabId}:${source.url}`}>
                          {source.domain}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          )}
        </ReasoningContent>
      </Reasoning>
    </section>
  );
}

function stepDuration(
  step: TimelineStep,
  clock: { interrupted: boolean; terminal: boolean; lastKnownAt: number | undefined; now: number },
) {
  return seconds(
    step.startedAt,
    step.completedAt ??
      (step.status === 'active' && !clock.terminal
        ? clock.interrupted
          ? clock.lastKnownAt
          : clock.now
        : undefined),
  );
}

function toolStatus(status: TimelineStep['status'], interrupted: boolean): ToolStatus {
  if (interrupted && status === 'active') return 'error';
  if (status === 'active') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'error') return 'error';
  return 'pending';
}
