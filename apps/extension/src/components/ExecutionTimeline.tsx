import type { ControllerSnapshot, TimelineStep } from '@nudge/contracts';
import { AlertCircle, Check, Circle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Reasoning, ReasoningContent, ReasoningTrigger } from '../../components/nexus-ui/reasoning';

type Props = {
  steps: TimelineStep[];
  status?: ControllerSnapshot['status'] | undefined;
  startedAt?: number | undefined;
  completedAt?: number | undefined;
  showTimings?: boolean;
  historical?: boolean;
};

function seconds(start: number | undefined, end: number | undefined) {
  return start === undefined || end === undefined
    ? undefined
    : Math.max(0, Math.floor((end - start) / 1000));
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
  useEffect(() => {
    if (terminal || interrupted || !timed || !showTimings) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal, interrupted, timed, showTimings]);
  if (!steps.length) return null;
  const hasError = status === 'failed' || steps.some((step) => step.status === 'error');
  const current = steps.findLast((step) => step.status === 'active') ?? steps.at(-1)!;
  const label = interrupted
    ? 'Task interrupted'
    : complete
      ? 'Task complete'
      : status === 'cancelled'
        ? 'Task stopped'
        : status === 'partially_completed'
          ? 'Task partially completed'
          : hasError
            ? 'Nudge needs attention'
            : status === 'paused'
              ? 'Task paused'
              : current.label;
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
              {taskSeconds}s
            </span>
          ) : null}
        </div>
        <ReasoningContent>
          <ol className="reasoning__steps">
            {steps.map((step) => {
              const duration = seconds(
                step.startedAt,
                step.completedAt ??
                  (step.status === 'active' && !terminal
                    ? interrupted
                      ? lastKnownAt
                      : now
                    : undefined),
              );
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
                        {duration}s
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
        </ReasoningContent>
      </Reasoning>
    </section>
  );
}
