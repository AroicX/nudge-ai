import { describe, expect, it } from 'vitest';

import {
  eventFingerprint,
  googleCalendarDayUrl,
  googleCalendarTemplateUrl,
  parseClock,
  resolveDate,
  resolveEventTiming,
} from './calendar';

// Sunday 18 October 2026, 21:30 in Lagos (UTC+1) = 20:30 UTC.
const NOW = Date.parse('2026-10-18T20:30:00Z');
const LAGOS = 'Africa/Lagos';

describe('resolveDate', () => {
  it('resolves relative words against the injected clock and timezone, never a fixed day', () => {
    expect(resolveDate('tomorrow', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 19 });
    expect(resolveDate('today', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 18 });
    expect(resolveDate('in 3 days', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 21 });
    expect(resolveDate('Friday', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 23 });
    expect(resolveDate('Sunday', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 25 });
    expect(resolveDate('this Sunday', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 18 });
  });

  it('uses the user timezone when UTC is already on a different day', () => {
    // 23:30 UTC on the 18th is already 08:30 on the 19th in Tokyo.
    const late = Date.parse('2026-10-18T23:30:00Z');
    expect(resolveDate('tomorrow', late, 'Asia/Tokyo')).toEqual({ y: 2026, m: 10, d: 20 });
    expect(resolveDate('tomorrow', late, 'America/Los_Angeles')).toEqual({ y: 2026, m: 10, d: 19 });
  });

  it('accepts explicit dates and rejects ambiguous numeric ones', () => {
    expect(resolveDate('2026-11-02', NOW, LAGOS)).toEqual({ y: 2026, m: 11, d: 2 });
    expect(resolveDate('20 October', NOW, LAGOS)).toEqual({ y: 2026, m: 10, d: 20 });
    expect(resolveDate('January 5', NOW, LAGOS)).toEqual({ y: 2027, m: 1, d: 5 });
    expect(resolveDate('10/11', NOW, LAGOS)).toBeUndefined();
    expect(resolveDate('2026-02-30', NOW, LAGOS)).toBeUndefined();
  });
});

describe('parseClock', () => {
  it('parses unambiguous times only', () => {
    expect(parseClock('9am')).toEqual({ hour: 9, minute: 0 });
    expect(parseClock('9:30 PM')).toEqual({ hour: 21, minute: 30 });
    expect(parseClock('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(parseClock('noon')).toEqual({ hour: 12, minute: 0 });
    expect(parseClock('9')).toBeUndefined();
    expect(parseClock('9:30')).toBeUndefined();
  });
});

describe('resolveEventTiming', () => {
  it('builds local and UTC times for tomorrow 9am for one hour', () => {
    const timing = resolveEventTiming({ date: 'tomorrow', startTime: '9am', durationMinutes: 60 }, NOW, LAGOS);
    expect(timing).toMatchObject({
      ok: true,
      startLocal: '2026-10-19T09:00',
      endLocal: '2026-10-19T10:00',
      startUtc: '2026-10-19T08:00:00.000Z',
      timeZone: LAGOS,
    });
    if (timing.ok) expect(timing.label).toContain('Monday, 19 October 2026, 09:00–10:00 (Africa/Lagos)');
  });

  it('handles daylight-saving zones', () => {
    const timing = resolveEventTiming({ date: '2026-11-02', startTime: '9am', endTime: '9:30am' }, NOW, 'America/New_York');
    expect(timing).toMatchObject({ ok: true, startUtc: '2026-11-02T14:00:00.000Z', endLocal: '2026-11-02T09:30' });
  });

  it('reports every missing piece together instead of guessing', () => {
    const timing = resolveEventTiming({ date: 'someday', startTime: '9' }, NOW, LAGOS);
    expect(timing.ok).toBe(false);
    if (!timing.ok)
      expect(timing.missing).toEqual(['date', 'start time (with am/pm or 24-hour time)', 'duration or end time']);
  });

  it('refuses a time already in the past', () => {
    expect(resolveEventTiming({ date: 'today', startTime: '9am', durationMinutes: 30 }, NOW, LAGOS).ok).toBe(false);
  });
});

describe('calendar URLs', () => {
  it('prefills the Google Calendar editor and never saves by itself', () => {
    const timing = resolveEventTiming({ date: 'tomorrow', startTime: '9am', durationMinutes: 45 }, NOW, LAGOS);
    if (!timing.ok) throw new Error('expected timing');
    const url = new URL(
      googleCalendarTemplateUrl({ title: 'Design review', timing, attendees: ['ada@example.com'], location: 'Room 4' }),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Design review');
    expect(url.searchParams.get('dates')).toBe('20261019T090000/20261019T094500');
    expect(url.searchParams.get('ctz')).toBe(LAGOS);
    expect(url.searchParams.get('add')).toBe('ada@example.com');
    expect(googleCalendarDayUrl(timing)).toBe('https://calendar.google.com/calendar/r/day/2026/10/19');
    expect(eventFingerprint(' Design  Review', timing.startLocal)).toBe('design review@2026-10-19T09:00');
  });
});
