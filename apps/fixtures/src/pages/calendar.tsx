import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Calendar-style fixture: a large grid (hundreds of role elements) and an
 * event editor dialog appended at the end of <body>, a time combobox with a
 * listbox of slots, a date input that commits on blur, and a Save button that
 * can be slow (?slowSave=1) so a "timed-out" save still creates the event.
 */
const SLOTS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? '30' : '00';
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12}:${minute}${suffix}`;
});

export interface FixtureEvent {
  title: string;
  date: string;
  start: string;
}

export function CalendarFixture({ slowSaveMs }: { slowSaveMs?: number } = {}) {
  const params = new URLSearchParams(window.location.search);
  const slow = slowSaveMs ?? (params.get('slowSave') ? 2_500 : 0);
  const [events, setEvents] = useState<FixtureEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('Mon, 19 Oct 2026');
  const [dateDraft, setDateDraft] = useState('Mon, 19 Oct 2026');
  const [start, setStart] = useState('10:00am');
  const [startDraft, setStartDraft] = useState('10:00am');
  const [timesOpen, setTimesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const save = () => {
    setSaving(true);
    const commit = () => {
      setEvents((current) => [...current, { title: title || '(No title)', date, start }]);
      setSaving(false);
      setEditing(false);
      setToast('Event saved');
    };
    if (slow) window.setTimeout(commit, slow);
    else commit();
  };

  return (
    <main className="calendar">
      <header>
        <h1>Fixture Calendar</h1>
        <button type="button" onClick={() => { setEditing(true); setTitle(''); }}>Create</button>
      </header>
      <div role="grid" aria-label="Week of 19 October 2026">
        {Array.from({ length: 7 * 48 }, (_, index) => (
          <div key={index} role="gridcell" aria-label={`Slot ${index}`}>{' '}</div>
        ))}
      </div>
      <section aria-label="Events">
        {events.map((event, index) => (
          <div key={index} role="button" aria-label={`${event.start}, ${event.title}, ${event.date}`}>
            {event.start} {event.title}
          </div>
        ))}
      </section>
      {toast ? <div role="status">{toast}</div> : null}
      {editing
        ? createPortal(
            <div role="dialog" aria-modal="true" aria-label="Event details">
              <input aria-label="Add title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <input
                aria-label="Start date"
                value={dateDraft}
                onChange={(event) => setDateDraft(event.target.value)}
                onBlur={() => (/^\w{3}, \d{1,2} \w{3} \d{4}$/.test(dateDraft) ? setDate(dateDraft) : setDateDraft(date))}
              />
              <input
                aria-label="Start time"
                role="combobox"
                aria-expanded={timesOpen}
                aria-controls="time-slots"
                value={startDraft}
                onFocus={() => setTimesOpen(true)}
                onChange={(event) => {
                  setStartDraft(event.target.value);
                  setTimesOpen(true);
                }}
              />
              {timesOpen ? (
                <ul id="time-slots" role="listbox" aria-label="Start time options">
                  {SLOTS.filter((slot) => !startDraft || slot.startsWith(startDraft.replace(/\s/g, '')) || startDraft === start).map((slot) => (
                    <li key={slot} role="option" aria-selected={slot === start} onClick={() => { setStart(slot); setStartDraft(slot); setTimesOpen(false); }}>
                      {slot}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p>Time zone: (GMT+01:00) West Africa Time - Lagos</p>
              <button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
