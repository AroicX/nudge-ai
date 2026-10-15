import type { TimelineStep } from '@nudge/contracts';

import {
  ChainOfThought,
  ChainOfThoughtComplete,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtStepContent,
  ChainOfThoughtStepTitle,
  ChainOfThoughtTrigger,
} from '../../components/nexus-ui/chain-of-thought';

export function ExecutionTimeline({ steps }: { steps: TimelineStep[] }) {
  if (!steps.length) return null;
  const hasError = steps.some((step) => step.status === 'error');
  const complete = steps.every((step) => step.status === 'completed');
  const current = steps.findLast((step) => step.status === 'active') ?? steps.at(-1)!;
  return (
    <section className="execution-timeline" aria-label="Action progress">
      <div role="status" aria-live="polite" className="sr-only">
        {current.label}
      </div>
      <ChainOfThought>
        <ChainOfThoughtTrigger>
          {hasError ? 'Nudge needs attention' : complete ? 'Task complete' : current.label}
        </ChainOfThoughtTrigger>
        <ChainOfThoughtContent className="chain-of-thought__content">
          {steps.map((step) => (
            <ChainOfThoughtStep key={step.id} status={step.status}>
              <ChainOfThoughtStepTitle>{step.label}</ChainOfThoughtStepTitle>
              {step.detail || step.sources?.length ? (
                <ChainOfThoughtStepContent>
                  {step.detail ? <p>{step.detail}</p> : null}
                  {step.sources?.map((source) => (
                    <span className="timeline-source" key={`${source.tabId}:${source.url}`}>
                      {source.domain}
                    </span>
                  ))}
                </ChainOfThoughtStepContent>
              ) : null}
            </ChainOfThoughtStep>
          ))}
          {complete ? <ChainOfThoughtComplete label="Task complete" /> : null}
        </ChainOfThoughtContent>
      </ChainOfThought>
    </section>
  );
}
