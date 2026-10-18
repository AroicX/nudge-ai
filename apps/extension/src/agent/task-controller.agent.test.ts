import type { CandidateProfile, PageElement, ToolCall } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ProfilePort } from './ports';
import { TaskController, type ControllerDeps } from './task-controller';
import { FakeBrowser, FakePlanner, MemoryCheckpoints, collector, element, noScreenshots } from './test-doubles';

// Sunday 18 October 2026, 21:30 in Lagos.
const NOW = Date.parse('2026-10-18T20:30:00Z');
const LAGOS = 'Africa/Lagos';

function make(browser: FakeBrowser, planner: FakePlanner, extra: Partial<ControllerDeps> = {}) {
  const out = collector();
  const controller = new TaskController({
    tabs: browser,
    content: browser,
    planner,
    screenshots: noScreenshots,
    checkpoints: new MemoryCheckpoints(),
    otp: { transfer: vi.fn(async () => ({ ok: true, detail: 'ok' })), cancelAll: vi.fn() },
    clock: () => NOW,
    emit: out.emit,
    provider: () => 'openai',
    capabilities: () => ({ vision: false }),
    timeZone: () => LAGOS,
    ...extra,
  });
  return { controller, out };
}

function profile(overrides: Partial<CandidateProfile> = {}): CandidateProfile {
  const source = { kind: 'document' as const, documentId: 'cv1', filename: 'Ada-CV.pdf', excerpt: 'ada@example.com | +44 7700 900123' };
  return {
    status: 'ready',
    selectedDocumentId: 'cv1',
    selection: 'only_cv',
    documents: [{ id: 'cv1', filename: 'Ada-CV.pdf', createdAt: '2026-10-01', isDefault: false, looksLikeCv: true, attachable: true, parseStatus: 'parsed' }],
    fields: {
      full_name: { value: 'Ada Lovelace', status: 'found', sources: [source] },
      email: { value: 'ada@example.com', status: 'found', sources: [source] },
    },
    employment: [],
    education: [],
    skills: [],
    missing: [],
    askUser: ['work authorization / right to work'],
    notes: [],
    ...overrides,
  };
}

function profilePort(value: CandidateProfile | Error): ProfilePort & { files: string[] } {
  const files: string[] = [];
  return {
    files,
    candidateProfile: vi.fn(async () => {
      if (value instanceof Error) throw value;
      return value;
    }),
    searchCv: vi.fn(async () => []),
    documentFile: vi.fn(async (id: string) => {
      files.push(id);
      return { filename: `${id}.pdf`, mime: 'application/pdf', base64: 'JVBERg==' };
    }),
  };
}

function applicationPage() {
  const page = {
    url: 'https://jobs.test/apply',
    title: 'Apply',
    documentId: 'docA',
    elements: [
      element('docA', 1, 'input', 'Email *', { value: '', required: true }),
      element('docA', 2, 'file', 'Upload CV', { inputType: 'file' }),
    ] as PageElement[],
    text: ['Apply: Frontend Engineer'],
    onExecute: (call: ToolCall) => {
      if (call.tool === 'type_text') {
        const target = page.elements.find((item) => item.id === call.elementId)!;
        target.value = call.text;
      }
    },
  };
  return page;
}

describe('candidate profile in the agent loop', () => {
  it('retrieves the saved profile and fills from it instead of claiming the details are missing', async () => {
    const browser = new FakeBrowser().addTab(1, applicationPage());
    const planner = new FakePlanner(
      [
        { toolCall: { tool: 'get_candidate_profile' } },
        (request) => {
          const data = JSON.parse(request.lastResult?.data ?? '{}') as CandidateProfile;
          return { toolCall: { tool: 'type_text', tabId: 1, elementId: 'docA:1', text: data.fields.email!.value, mode: 'replace' } };
        },
        { toolCall: { tool: 'finish', summary: 'Filled your email from your CV.', evidence: ['ada@example.com'] } },
      ],
      { categories: ['read', 'navigate', 'fill'] },
    );
    const { controller } = make(browser, planner, { profile: profilePort(profile()) });
    await controller.instruct('Fill in this application with my details', 'text', 1);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('completed'));
    expect(planner.requests[1]?.lastResult).toMatchObject({ tool: 'get_candidate_profile', ok: true, verified: true });
    expect(planner.requests[2]?.lastResult).toMatchObject({ tool: 'type_text', ok: true, verified: true });
    expect(browser.pages.get(1)!.elements[0]!.value).toBe('ada@example.com');
  });

  it('reports a retrieval failure as a failure, not as missing information', async () => {
    const browser = new FakeBrowser().addTab(1, applicationPage());
    const planner = new FakePlanner([{ toolCall: { tool: 'get_candidate_profile' } }]);
    const { controller } = make(browser, planner, { profile: profilePort(new Error('Backend error 503')) });
    await controller.instruct('Apply to this job', 'text', 1);
    await vi.waitFor(() => expect(planner.requests.length).toBeGreaterThan(1));
    expect(planner.requests[1]?.lastResult).toMatchObject({ ok: false, errorCategory: 'retrieval_failed', recoverable: true });
    expect(planner.requests[1]?.lastResult?.detail).toMatch(/503.*retrieval failure, not missing information/);
  });

  it('asks which CV to attach when several exist without a default', async () => {
    const browser = new FakeBrowser().addTab(1, applicationPage());
    const two = profile({
      selection: 'most_recent_cv',
      documents: [
        { id: 'cv1', filename: 'Ada-CV.pdf', createdAt: '2026-10-01', isDefault: false, looksLikeCv: true, attachable: true, parseStatus: 'parsed' },
        { id: 'cv2', filename: 'Ada-Resume-2024.pdf', createdAt: '2024-01-01', isDefault: false, looksLikeCv: true, attachable: true, parseStatus: 'parsed' },
      ],
    });
    const port = profilePort(two);
    const planner = new FakePlanner([{ toolCall: { tool: 'attach_document', tabId: 1, elementId: 'docA:2' } }], { categories: ['read', 'navigate', 'fill'] });
    const { controller } = make(browser, planner, { profile: port });
    await controller.instruct('Apply to this job with my CV', 'text', 1);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('waiting_for_user'));
    expect(controller.snapshot().pendingQuestion).toMatch(/Which CV.*Ada-CV\.pdf.*Ada-Resume-2024\.pdf/);
    expect(port.files).toEqual([]);
  });

  it('attaches the default CV through the upload field', async () => {
    const browser = new FakeBrowser().addTab(1, applicationPage());
    const port = profilePort(profile({ selection: 'default', selectedDocumentId: 'cv1' }));
    const planner = new FakePlanner([{ toolCall: { tool: 'attach_document', tabId: 1, elementId: 'docA:2' } }], { categories: ['read', 'navigate', 'fill'] });
    const { controller } = make(browser, planner, { profile: port });
    await controller.instruct('Apply to this job with my CV', 'text', 1);
    await vi.waitFor(() => expect(planner.requests.length).toBeGreaterThan(1));
    expect(port.files).toEqual(['cv1']);
    expect(browser.sent.some((entry) => entry.request.type === 'attach_file')).toBe(true);
    expect(planner.requests[1]?.lastResult).toMatchObject({ tool: 'attach_document', ok: true });
  });
});

describe('Calendar event creation', () => {
  const CALENDAR = 'https://calendar.google.com/calendar/r';
  function calendarBrowser() {
    const browser = new FakeBrowser().addTab(1, {
      url: CALENDAR,
      title: 'Google Calendar',
      documentId: 'cal',
      elements: [element('cal', 1, 'button', 'Create')],
      text: ['Week of 19 October'],
    });
    const navigations: string[] = [];
    const saves: string[] = [];
    browser.navigate = async (tabId: number, url: string) => {
      navigations.push(url);
      const page = browser.pages.get(tabId)!;
      page.url = url;
      page.documentId = `${page.documentId}n`;
      const doc = page.documentId;
      if (url.includes('action=TEMPLATE'))
        Object.assign(page, {
          elements: [
            element(doc, 1, 'input', 'Add title', { value: 'Design review' }),
            element(doc, 2, 'button', 'Save'),
          ],
          text: ['Mon, 19 Oct 2026', '9:00am to 9:45am', '(GMT+01:00) West Africa Time - Lagos'],
          onExecute: (call: ToolCall) => {
            if (call.tool === 'click') saves.push(url); // simulates a save that times out: page unchanged
          },
        });
      if (url.includes('/r/day/'))
        Object.assign(page, {
          elements: [element(doc, 1, 'button', '9am to 9:45am, Design review, Monday, 19 October')],
          text: ['Monday, 19 October'],
          onExecute: undefined,
        });
    };
    return { browser, navigations, saves };
  }

  it('asks for the missing title, time and duration instead of inventing them', async () => {
    const { browser, navigations } = calendarBrowser();
    const planner = new FakePlanner([
      { toolCall: { tool: 'calendar_open_event_editor', tabId: 1, title: 'Meeting', date: 'tomorrow', startTime: '9am', durationMinutes: 60 } },
    ]);
    const { controller } = make(browser, planner);
    await controller.instruct('Schedule a meeting tomorrow', 'text', 1);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('waiting_for_user'));
    expect(controller.snapshot().pendingQuestion).toMatch(/Monday, 19 October 2026.*title, start time, duration or end time/);
    expect(navigations).toEqual([]);
  });

  it('creates the event with a fixed clock and timezone, asks before saving, and never saves twice after an uncertain save', async () => {
    const { browser, navigations, saves } = calendarBrowser();
    const planner = new FakePlanner(
      [
        { toolCall: { tool: 'calendar_open_event_editor', tabId: 1, title: 'Design review', date: 'tomorrow', startTime: '9am', durationMinutes: 45 } },
        (request) => ({ toolCall: { tool: 'click', tabId: 1, elementId: request.observation!.snapshot.elements.find((item) => item.name === 'Save')!.id } }),
        (request) => ({ toolCall: { tool: 'click', tabId: 1, elementId: request.observation!.snapshot.elements.find((item) => item.name === 'Save')!.id } }),
        (request) => ({ toolCall: { tool: 'click', tabId: 1, elementId: request.observation!.snapshot.elements.find((item) => item.name === 'Save')!.id } }),
        { toolCall: { tool: 'finish', summary: 'Saved.', evidence: ['Design review'] } },
        { toolCall: { tool: 'calendar_find_event', tabId: 1, title: 'Design review', date: 'tomorrow' } },
        { toolCall: { tool: 'calendar_open_event_editor', tabId: 1, title: 'Design review', date: 'tomorrow', startTime: '9am', durationMinutes: 45 } },
        { toolCall: { tool: 'finish', summary: 'Design review is on your calendar tomorrow 9:00–9:45.', evidence: ['Design review'] } },
      ],
      { categories: ['read', 'navigate', 'fill', 'submit_form'] },
    );
    const { controller } = make(browser, planner);
    await controller.instruct('Schedule Design review tomorrow at 9am for 45 minutes', 'text', 1);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('waiting_for_confirmation'));
    const template = new URL(navigations[0]!);
    expect(template.searchParams.get('dates')).toBe('20261019T090000/20261019T094500');
    expect(template.searchParams.get('ctz')).toBe(LAGOS);
    expect(planner.requests[0]).toMatchObject({ timeZone: LAGOS, currentTime: expect.stringContaining('2026-10-18T20:30:00.000Z') });
    const preview = controller.snapshot().pendingPreview!;
    expect(preview.operation).toBe('Save calendar event “Design review”');
    expect(preview.criteria).toContain('Monday, 19 October 2026, 09:00–09:45 (Africa/Lagos)');
    expect(saves).toEqual([]);
    controller.confirm(preview.previewId, true);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('completed'));
    expect(saves).toHaveLength(1);
    const results = planner.requests.map((request) => request.lastResult);
    expect(results.some((result) => /already attempted.*calendar_find_event/.test(result?.detail ?? ''))).toBe(true);
    expect(results.some((result) => result?.tool === 'finish' && /not confirmed to exist/.test(result.detail))).toBe(true);
    expect(results.some((result) => /already exists/.test(result?.detail ?? ''))).toBe(true);
    expect(navigations.at(-1)).toContain('/r/day/2026/10/19');
  });
});

describe('recovery and no-progress', () => {
  function stuckPage() {
    return {
      url: 'https://site.test/list',
      title: 'List',
      documentId: 'docS',
      elements: [element('docS', 1, 'button', 'Load more'), element('docS', 2, 'input', 'Search', { value: '' })],
      text: ['10 results'],
    };
  }

  it('refuses to repeat a click that made no progress and stops with the specific blocker', async () => {
    const browser = new FakeBrowser().addTab(1, stuckPage());
    const click = { toolCall: { tool: 'click' as const, tabId: 1, elementId: 'docS:1' } };
    const planner = new FakePlanner([click, click, click, click, click]);
    const { controller } = make(browser, planner);
    await controller.instruct('Load all results on this page', 'text', 1);
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('partially_completed'));
    expect(browser.executes().filter((entry) => entry.call.tool === 'click')).toHaveLength(2);
    expect(planner.requests[3]?.lastResult).toMatchObject({ errorCategory: 'no_progress' });
    expect(controller.snapshot().report?.summary).toMatch(/kept leaving the page unchanged/);
  });

  it('refreshes references after a stale element and reports the category', async () => {
    const page = { ...stuckPage(), onExecute: () => ({ ok: false, detail: 'Element reference is stale; observe again.', errorCategory: 'stale_element' as const }) };
    const browser = new FakeBrowser().addTab(1, page);
    const planner = new FakePlanner([{ toolCall: { tool: 'type_text', tabId: 1, elementId: 'docS:2', text: 'x', mode: 'replace' } }], { categories: ['read', 'navigate', 'fill'] });
    const { controller } = make(browser, planner);
    await controller.instruct('Search this page for x', 'text', 1);
    await vi.waitFor(() => expect(planner.requests.length).toBeGreaterThan(1));
    expect(planner.requests[1]?.lastResult).toMatchObject({ ok: false, errorCategory: 'stale_element', recoverable: true });
    expect(planner.requests[1]?.notes.join(' ')).toMatch(/references were refreshed/);
  });
});
