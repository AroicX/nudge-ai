/**
 * Deterministic date/time resolution for calendar events. Relative words are
 * resolved against an injected clock and the user's IANA timezone — never a
 * hardcoded day. Ambiguous input is reported as missing instead of guessed.
 */

export interface EventTimingInput {
  date: string;
  startTime: string;
  endTime?: string | undefined;
  durationMinutes?: number | undefined;
}

export type EventTiming =
  | {
      ok: true;
      timeZone: string;
      /** Wall-clock local times in `timeZone`, ISO-like `YYYY-MM-DDTHH:mm`. */
      startLocal: string;
      endLocal: string;
      startUtc: string;
      endUtc: string;
      /** Human label, e.g. "Monday, 19 October 2026, 09:00–10:00 (Africa/Lagos)". */
      label: string;
    }
  | { ok: false; missing: string[]; reason: string };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parts(epochMs: number, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
    })
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    y: Number(values.year),
    m: Number(values.month),
    d: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS.indexOf(String(values.weekday).toLowerCase()),
  };
}

export function localToday(nowMs: number, timeZone: string): Ymd & { weekday: number } {
  const p = parts(nowMs, timeZone);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday };
}

function addDays(date: Ymd, days: number): Ymd {
  const value = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
}

function validYmd(date: Ymd): boolean {
  const value = new Date(Date.UTC(date.y, date.m - 1, date.d));
  return value.getUTCFullYear() === date.y && value.getUTCMonth() === date.m - 1 && value.getUTCDate() === date.d;
}

const pad = (value: number) => String(value).padStart(2, '0');
const ymdText = (date: Ymd) => `${date.y}-${pad(date.m)}-${pad(date.d)}`;

/** Resolve a date expression in the user's timezone. Returns undefined when ambiguous/unknown. */
export function resolveDate(expression: string, nowMs: number, timeZone: string): Ymd | undefined {
  const text = expression.trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const today = localToday(nowMs, timeZone);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const date = { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    return validYmd(date) ? date : undefined;
  }
  if (text === 'today') return { y: today.y, m: today.m, d: today.d };
  if (text === 'tomorrow' || text === 'tmrw') return addDays(today, 1);
  if (text === 'day after tomorrow' || text === 'the day after tomorrow') return addDays(today, 2);
  const inDays = /^in (\d{1,3}) days?$/.exec(text);
  if (inDays) return addDays(today, Number(inDays[1]));
  const weekday = /^(?:(this|next|on|coming|this coming) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!);
    let delta = (target - today.weekday + 7) % 7;
    // "Monday" on a Monday means the following Monday; "this Monday" on a Monday means today.
    if (delta === 0 && weekday[1] !== 'this') delta = 7;
    return addDays(today, delta);
  }
  // "20 October [2026]" or "October 20[th] [2026]"
  const dayMonth = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/.exec(text);
  const monthDay = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  const named = dayMonth
    ? { day: Number(dayMonth[1]), month: dayMonth[2]!, year: dayMonth[3] }
    : monthDay
      ? { day: Number(monthDay[2]), month: monthDay[1]!, year: monthDay[3] }
      : undefined;
  if (named) {
    const month = MONTHS.findIndex((name) => name === named.month || name.slice(0, 3) === named.month);
    if (month < 0) return undefined;
    let date: Ymd = { y: named.year ? Number(named.year) : today.y, m: month + 1, d: named.day };
    if (!validYmd(date)) return undefined;
    if (!named.year && ymdText(date) < ymdText(today)) date = { ...date, y: date.y + 1 };
    return date;
  }
  return undefined; // numeric forms like 10/11 are ambiguous (day/month order); ask instead.
}

/** Parse "9am", "9:30 pm", "14:30", "noon". Bare "9" is ambiguous and rejected. */
export function parseClock(expression: string): { hour: number; minute: number } | undefined {
  const text = expression.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (text === 'noon' || text === 'midday') return { hour: 12, minute: 0 };
  if (text === 'midnight') return { hour: 0, minute: 0 };
  const twelve = /^(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)$/.exec(text);
  if (twelve) {
    const hour = Number(twelve[1]);
    const minute = Number(twelve[2] ?? '0');
    if (hour < 1 || hour > 12 || minute > 59) return undefined;
    const pm = twelve[3]!.startsWith('p');
    return { hour: (hour % 12) + (pm ? 12 : 0), minute };
  }
  const military = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    if (hour > 23 || minute > 59) return undefined;
    // "9:30" without am/pm is ambiguous only for 1–12; 24-hour values 13–23 and 0 are explicit.
    if (hour >= 1 && hour <= 12 && military[1]!.length === 1) return undefined;
    return { hour, minute };
  }
  return undefined;
}

/** Offset (ms) of `timeZone` at `epochMs`: local wall time minus UTC. */
function offsetAt(epochMs: number, timeZone: string): number {
  const p = parts(epochMs, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second) - Math.floor(epochMs / 1000) * 1000;
}

export function zonedToUtc(date: Ymd, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(date.y, date.m - 1, date.d, hour, minute);
  let utc = guess - offsetAt(guess, timeZone);
  utc = guess - offsetAt(utc, timeZone);
  return utc;
}

export function resolveEventTiming(input: EventTimingInput, nowMs: number, timeZone: string): EventTiming {
  if (!isValidTimeZone(timeZone)) return { ok: false, missing: ['timezone'], reason: `Unknown timezone “${timeZone}”.` };
  const missing: string[] = [];
  const date = resolveDate(input.date, nowMs, timeZone);
  if (!date) missing.push('date');
  const start = parseClock(input.startTime);
  if (!start) missing.push('start time (with am/pm or 24-hour time)');
  let durationMinutes = input.durationMinutes;
  if (input.endTime) {
    const end = parseClock(input.endTime);
    if (!end) missing.push('end time');
    else if (start) {
      durationMinutes = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
      if (durationMinutes <= 0) durationMinutes += 24 * 60;
    }
  }
  if (durationMinutes === undefined && !input.endTime) missing.push('duration or end time');
  if (missing.length || !date || !start || durationMinutes === undefined)
    return { ok: false, missing, reason: `Missing or ambiguous: ${missing.join(', ')}.` };
  const startUtc = zonedToUtc(date, start.hour, start.minute, timeZone);
  const endUtc = startUtc + durationMinutes * 60_000;
  if (startUtc < nowMs - 60_000)
    return { ok: false, missing: ['date'], reason: 'That time is in the past for your timezone.' };
  const endParts = parts(endUtc, timeZone);
  const startLocal = `${ymdText(date)}T${pad(start.hour)}:${pad(start.minute)}`;
  const endLocal = `${endParts.y}-${pad(endParts.m)}-${pad(endParts.d)}T${pad(endParts.hour)}:${pad(endParts.minute)}`;
  const label = `${new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(startUtc)}, ${pad(start.hour)}:${pad(start.minute)}–${pad(endParts.hour)}:${pad(endParts.minute)} (${timeZone})`;
  return {
    ok: true,
    timeZone,
    startLocal,
    endLocal,
    startUtc: new Date(startUtc).toISOString(),
    endUtc: new Date(endUtc).toISOString(),
    label,
  };
}

export interface CalendarEventDraft {
  title: string;
  timing: Extract<EventTiming, { ok: true }>;
  attendees?: string[] | undefined;
  location?: string | undefined;
  details?: string | undefined;
}

const compact = (local: string) => `${local.replace(/[-:]/g, '')}00`;

/**
 * Google Calendar's "add event" template link opens the normal event editor,
 * prefilled, in the signed-in browser. Nothing is saved until the user's Save
 * click (which goes through the submission-approval policy).
 */
export function googleCalendarTemplateUrl(draft: CalendarEventDraft): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: draft.title,
    dates: `${compact(draft.timing.startLocal)}/${compact(draft.timing.endLocal)}`,
    ctz: draft.timing.timeZone,
  });
  if (draft.details) params.set('details', draft.details);
  if (draft.location) params.set('location', draft.location);
  if (draft.attendees?.length) params.set('add', draft.attendees.join(','));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function googleCalendarDayUrl(date: { startLocal: string }): string {
  const [y, m, d] = date.startLocal.slice(0, 10).split('-').map(Number);
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
}

/** Stable identity of an intended event, used to prevent duplicate saves. */
export function eventFingerprint(title: string, startLocal: string): string {
  return `${title.trim().toLowerCase().replace(/\s+/g, ' ')}@${startLocal}`;
}
