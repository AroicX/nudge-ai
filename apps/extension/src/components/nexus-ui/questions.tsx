// Adapted from https://nexus-ui.dev/docs/components/questions.
import { createContext, useContext, useState, type ReactNode } from 'react';

export const QUESTION_NO_PREFERENCE_LABEL = '[No Preference]';

export type QuestionOptionInput = { value: string; label: ReactNode };
export type QuestionInput = {
  id: string;
  type: 'single' | 'multiple';
  prompt: ReactNode;
  options: QuestionOptionInput[];
  required?: boolean;
};
export type QuestionSubmissionAnswer = { value: string; label: ReactNode };
export type QuestionsSubmission = Array<
  | {
      questionId: string;
      prompt: ReactNode;
      type: 'single' | 'multiple';
      status: 'answered' | 'skipped';
      answer: QuestionSubmissionAnswer | QuestionSubmissionAnswer[];
    }
>;

type Stored = Record<string, QuestionSubmissionAnswer[]>;
const QuestionsContext = createContext<{
  items: QuestionInput[];
  answers: Stored;
  choose(id: string, answer: QuestionSubmissionAnswer, type: 'single' | 'multiple'): void;
  submit(): void;
  activeId?: string | undefined;
}>({ items: [], answers: {}, choose: () => undefined, submit: () => undefined });
const QuestionContext = createContext<string>('');

export function Questions({
  items,
  onSubmit,
  children,
}: {
  items: QuestionInput[];
  onSubmit(submission: QuestionsSubmission): void;
  children: ReactNode;
}) {
  const [answers, setAnswers] = useState<Stored>({});
  const [activeId, setActiveId] = useState(items[0]?.id);
  const submit = (next: Stored) => {
    onSubmit(
      items.map((item) => {
        const chosen = next[item.id] ?? [];
        if (!chosen.length) {
          return {
            questionId: item.id,
            prompt: item.prompt,
            type: item.type,
            status: 'skipped' as const,
            answer:
              item.type === 'multiple'
                ? [{ value: '', label: QUESTION_NO_PREFERENCE_LABEL }]
                : { value: '', label: QUESTION_NO_PREFERENCE_LABEL },
          };
        }
        return {
          questionId: item.id,
          prompt: item.prompt,
          type: item.type,
          status: 'answered' as const,
          answer: item.type === 'multiple' ? chosen : chosen[0]!,
        };
      }),
    );
    setAnswers({});
    setActiveId(items[0]?.id);
  };
  const choose = (id: string, answer: QuestionSubmissionAnswer, type: 'single' | 'multiple') => {
    const existing = answers[id] ?? [];
    const chosen =
      type === 'single'
        ? [answer]
        : existing.some((item) => item.value === answer.value)
          ? existing.filter((item) => item.value !== answer.value)
          : [...existing, answer];
    const next = { ...answers, [id]: chosen };
    setAnswers(next);
    if (type === 'single') submit(next);
  };
  const ready = items.every((item) => !item.required || (answers[item.id]?.length ?? 0) > 0);
  return (
    <section className="nudge-questions" aria-label="Clarifying question">
      <QuestionsContext.Provider
        value={{
          items,
          answers,
          choose,
          submit: () => {
            if (ready) submit(answers);
          },
          ...(activeId === undefined ? {} : { activeId }),
        }}
      >
        {children}
      </QuestionsContext.Provider>
    </section>
  );
}

export function QuestionsHeader({ children }: { children: ReactNode }) {
  return <div className="nudge-questions__header">{children}</div>;
}

export function QuestionsTitle() {
  const { items, activeId } = useContext(QuestionsContext);
  const current = items.find((item) => item.id === activeId) ?? items[0];
  return <h2>{current?.prompt}</h2>;
}

export function Question({ id, children }: { id: string; children: ReactNode }) {
  return <QuestionContext.Provider value={id}>{children}</QuestionContext.Provider>;
}

export function QuestionOptions({ children }: { children: ReactNode }) {
  return <div className="nudge-questions__options">{children}</div>;
}

export function QuestionOption({ value, children }: { value: string; children: ReactNode }) {
  const id = useContext(QuestionContext);
  const { items, answers, choose } = useContext(QuestionsContext);
  const item = items.find((entry) => entry.id === id);
  const selected = answers[id]?.some((answer) => answer.value === value) ?? false;
  return (
    <button
      type="button"
      className="nudge-questions__option"
      aria-pressed={selected}
      onClick={() => item && choose(id, { value, label: children }, item.type)}
    >
      {children}
    </button>
  );
}

export function QuestionOther({ placeholder = 'Something else' }: { placeholder?: string }) {
  const id = useContext(QuestionContext);
  const { items, choose } = useContext(QuestionsContext);
  const [text, setText] = useState('');
  const item = items.find((entry) => entry.id === id);
  return (
    <form
      className="nudge-questions__other"
      onSubmit={(event) => {
        event.preventDefault();
        if (item && text.trim()) choose(id, { value: text.trim(), label: text.trim() }, item.type);
      }}
    >
      <input aria-label={placeholder} value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="secondary" disabled={!text.trim()}>
        Use this answer
      </button>
    </form>
  );
}

export function QuestionsFooter({ children }: { children: ReactNode }) {
  return <div className="nudge-questions__footer">{children}</div>;
}

export function QuestionsSubmit({ children = 'Submit' }: { children?: ReactNode }) {
  const { items, answers, submit } = useContext(QuestionsContext);
  const ready = items.every((item) => !item.required || (answers[item.id]?.length ?? 0) > 0);
  return (
    <button type="button" disabled={!ready} onClick={submit}>
      {children}
    </button>
  );
}
