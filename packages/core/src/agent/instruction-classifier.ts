export interface ClassifyContext {
  taskActive: boolean;
  confirmationPending: boolean;
  tabTitles: { tabId: number; title: string }[];
}

export type Classified =
  | { kind: 'stop' | 'pause' | 'resume' | 'skip' }
  | { kind: 'confirm'; approved: boolean }
  | { kind: 'tab_correction'; tabId?: number; tabIndex?: number; text: string }
  | { kind: 'correction'; text: string }
  | { kind: 'new_task'; text: string };

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!?,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP =
  /^(please )?(stop|cancel|stop (it|that|now|the task|task)|cancel (it|that|the task)|abort|that's enough)( now)?( please)?$/;
const PAUSE = /^(please )?(pause|hold on|wait|hang on|hold)( a (second|moment|sec))?( please)?$/;
const RESUME = /^(please )?(continue|resume|go on|keep going|carry on)( please)?$/;
const SKIP = /^(please )?skip( (this|it|that|this one))?( please)?$/;
const YES = /^(yes|yeah|yep|confirm|confirmed|do it|go ahead|ok|okay|sure)\b/;
const NO = /^(no|nope|don't|do not|cancel that|never mind)\b/;
const OTHER_TAB = /\b(other|previous|first|last|original) tab\b/;
const NAMED_TAB = /\b(?:use|switch to|go to)\s+(?:the\s+)?(.+?)\s+tab\b/;
const NUMBERED_TAB = /^(?:(?:use|switch to|go to|select|open)\s+)?tab\s+(\d{1,3})$/;

export function classifyInstruction(text: string, ctx: ClassifyContext): Classified {
  const raw = text.trim();
  const value = normalize(raw);
  if (STOP.test(value)) return { kind: 'stop' };
  if (ctx.taskActive) {
    if (ctx.confirmationPending) {
      if (YES.test(value)) return { kind: 'confirm', approved: true };
      if (NO.test(value)) return { kind: 'confirm', approved: false };
    }
    if (PAUSE.test(value)) return { kind: 'pause' };
    if (RESUME.test(value)) return { kind: 'resume' };
    if (SKIP.test(value)) return { kind: 'skip' };
    const numbered = NUMBERED_TAB.exec(value);
    if (numbered?.[1]) return { kind: 'tab_correction', tabIndex: Number(numbered[1]), text: raw };
    const named = NAMED_TAB.exec(value);
    if (named?.[1] && !OTHER_TAB.test(value)) {
      const wanted = named[1].replace(/^(?:my|a|an)\s+/, '').trim();
      const matches = ctx.tabTitles.filter((tab) => tab.title.toLowerCase().includes(wanted));
      return matches.length === 1
        ? { kind: 'tab_correction', tabId: matches[0]!.tabId, text: raw }
        : { kind: 'tab_correction', text: raw };
    }
    if (OTHER_TAB.test(value)) return { kind: 'tab_correction', text: raw };
    return { kind: 'correction', text: raw };
  }
  return { kind: 'new_task', text: raw };
}
