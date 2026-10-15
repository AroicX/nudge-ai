/**
 * Scripted planner scenarios for the acceptance runs. Each step is a tool-call template the
 * test-only planner resolves against the live observation (element names, tab URLs, latest
 * screenshot). Nudge still scopes, validates, executes and verifies every step for real.
 */
const ORIGIN = 'http://127.0.0.1:4173';
const bound = { bound: true };
const scope = (goal: string, categories: string[], extra: Record<string, unknown> = {}) => ({
  goal,
  origins: [ORIGIN],
  categories,
  destinations: [],
  exclusions: [],
  limits: {},
  ...extra,
});

export const emailSummary = {
  scenarios: [
    {
      match: 'unread emails about invoices',
      scope: scope('Summarize unread invoice emails', ['read', 'navigate', 'fill']),
      steps: [
        { call: { tool: 'type_text', tabId: bound, elementId: { byName: 'Search mail' }, text: 'invoice', mode: 'replace' } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Search', kind: 'button' } }, expectation: { kind: 'text_present', text: 'matching “invoice”' } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Unread only', kind: 'checkbox' } }, expectation: { kind: 'text_present', text: '4 conversations' } },
        {
          when: { textPresent: '4 conversations' },
          call: {
            tool: 'finish',
            summary:
              'You have 4 unread emails about invoices: Invoice INV-1001 for September (Acme Billing), Invoice INV-2044 is ready (Globex Accounts), Invoice overdue reminder (Umbrella Supplies) and Invoice for October usage (Hooli Cloud).',
            evidence: ['Mailbox shows 4 conversations matching “invoice” with Unread only'],
          },
        },
      ],
    },
  ],
};

export const bulkTrash = {
  scenarios: [
    {
      match: 'emails about invoices to trash',
      scope: scope('Move invoice emails to Trash', ['read', 'navigate', 'fill', 'move_reversible']),
      steps: [
        { call: { tool: 'type_text', tabId: bound, elementId: { byName: 'Search mail' }, text: 'invoice', mode: 'replace' } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Search', kind: 'button' } } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Select all matching' } }, expectation: { kind: 'text_present', text: '5 selected' } },
        {
          when: { textPresent: '5 selected' },
          call: {
            tool: 'request_confirmation',
            preview: { operation: 'Move to Trash', location: 'Inbox · ada@example.test', criteria: 'Emails matching “invoice”', count: 5, samples: [], reversible: true, permanent: false },
          },
        },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Move to Trash' } } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Move to Trash' } }, expectation: { kind: 'text_present', text: 'Trash (6)' } },
        {
          when: { textPresent: 'Trash (6)' },
          call: { tool: 'finish', summary: 'Moved 6 invoice emails to Trash. They can be restored from Trash.', evidence: ['Trash (6)'] },
        },
      ],
    },
  ],
};

export const otpTransfer = {
  scenarios: [
    {
      match: 'sign-in code',
      scope: scope('Copy the Acme sign-in code into the verification page', ['read', 'navigate', 'transfer_code']),
      steps: [
        {
          call: {
            tool: 'transfer_code',
            sourceTabId: { byUrl: '/mailbox' },
            service: 'Acme',
            destinationTabId: bound,
            destinationElementId: { byName: 'One-time code' },
          },
        },
        {
          when: { textPresent: 'Input length: 6' },
          call: { tool: 'finish', summary: 'I entered the Acme sign-in code. I did not submit the form.', evidence: ['Input length: 6'] },
        },
      ],
    },
  ],
};

export const timedScroll = {
  scenarios: [
    {
      match: 'every three seconds',
      scope: scope('Scroll this page every three seconds until stopped', ['read', 'navigate']),
      steps: [
        {
          call: {
            tool: 'start_timed_repeat',
            tabId: bound,
            action: { kind: 'scroll', direction: 'down', amount: 'viewport' },
            intervalMs: 3000,
            maxDurationMs: 600000,
          },
        },
      ],
    },
  ],
};

export const blocker = {
  scenarios: [
    {
      match: 'newsletter',
      scope: scope('Sign up for the newsletter', ['read', 'navigate', 'fill', 'submit_form']),
      steps: [
        { call: { tool: 'type_text', tabId: bound, elementId: { byName: 'Email address' }, text: 'ada@example.test', mode: 'replace' } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Continue' } }, expectation: { kind: 'text_present', text: 'Verify you are human' } },
        { when: { textPresent: 'Verify you are human' }, call: { tool: 'click', tabId: bound, elementId: { byName: "I'm not a robot" } } },
        {
          call: {
            tool: 'report_partial',
            done: ['Entered ada@example.test and continued'],
            remaining: ['Complete the human-verification check'],
            reason: 'The site requires a human-verification check, which Nudge leaves to you.',
          },
        },
      ],
    },
  ],
};

const job = (id: number, title: string, company: string, location: string, salary: string) => ({
  fields: [
    { name: 'title', value: title },
    { name: 'company', value: company },
    { name: 'location', value: location },
    { name: 'salary', value: salary },
  ],
  sourceUrl: `${ORIGIN}/jobs/${id}?utm_source=board&ref=listing`,
});

const RESEARCH_JOBS = [
  { id: 101, page: 1, title: 'Senior Frontend Engineer', company: 'Acme Labs', location: 'Remote', salary: '$150k–$180k' },
  { id: 201, page: 2, title: 'Frontend Engineer, Design Systems', company: 'Hooli', location: 'Remote', salary: '$165k' },
  { id: 301, page: 3, title: 'Frontend Platform Engineer', company: 'Wonka', location: 'Remote', salary: '$170k' },
];

function writeRows(rows: Array<{ id: number; title: string; company: string; location: string }>) {
  return rows.flatMap((row, index) => {
    const line = index + 2;
    const values: Array<[string, string]> = [
      ['A', row.title],
      ['B', row.company],
      ['C', row.location],
      ['E', `${ORIGIN}/jobs/${row.id}?ref=listing`],
    ];
    return values.map(([column, text]) => ({
      call: { tool: 'type_text', tabId: bound, elementId: { byName: `${column}${line}`, kind: 'gridcell' }, text, mode: 'replace' },
    }));
  });
}

export const researchSheet = {
  scenarios: [
    {
      match: 'remote frontend jobs',
      scope: scope('Collect remote frontend jobs into the sheet', ['read', 'navigate', 'fill', 'create_records'], {
        destinations: ['Job tracker sheet tab'],
        recordFields: ['title', 'company', 'location', 'salary'],
      }),
      steps: [
        { call: { tool: 'record_items', records: [job(101, 'Senior Frontend Engineer', 'Acme Labs', 'Remote', '$150k–$180k')] } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Next page' } }, expectation: { kind: 'url_changed' } },
        { when: { urlIncludes: 'page=2' }, call: { tool: 'record_items', records: [job(201, 'Frontend Engineer, Design Systems', 'Hooli', 'Remote', '$165k')] } },
        { call: { tool: 'click', tabId: bound, elementId: { byName: 'Next page' } }, expectation: { kind: 'url_changed' } },
        {
          when: { urlIncludes: 'page=3' },
          // The board shows no salary for some roles; the planner claims one anyway to prove grounding.
          call: { tool: 'record_items', records: [job(301, 'Frontend Platform Engineer', 'Wonka', 'Remote', '$170k'), job(303, 'Junior Frontend Developer', 'Cyberdyne', 'Austin, TX', '$999k')] },
        },
        { call: { tool: 'activate_tab', tabId: { byUrl: '/sheet' } } },
        ...writeRows(RESEARCH_JOBS),
        { call: { tool: 'export_records', format: 'csv' } },
        {
          when: { textPresent: 'Rows filled: 3' },
          call: { tool: 'finish', summary: 'Added 3 remote frontend jobs to the sheet with source links.', evidence: ['Sheet shows Rows filled: 3'] },
        },
      ],
    },
  ],
};

export const voiceCorrection = {
  scenarios: [
    {
      match: 'find frontend jobs and add them',
      scope: scope('Collect frontend jobs into the sheet', ['read', 'navigate', 'fill', 'create_records'], {
        recordFields: ['title', 'company', 'location', 'salary'],
      }),
      steps: [
        {
          call: {
            tool: 'record_items',
            records: [
              job(101, 'Senior Frontend Engineer', 'Acme Labs', 'Remote', '$150k–$180k'),
              job(102, 'Frontend Developer', 'Globex', 'Berlin, Germany', '€70k'),
            ],
          },
        },
        // Waiting here gives the test a deterministic window to speak a correction.
        { call: { tool: 'wait_for', tabId: bound, condition: { kind: 'text_present', text: 'never appears' }, timeoutMs: 6000 } },
        { call: { tool: 'activate_tab', tabId: { byUrl: '/sheet' } } },
        ...writeRows([
          { id: 101, title: 'Senior Frontend Engineer', company: 'Acme Labs', location: 'Remote' },
          { id: 102, title: 'Frontend Developer', company: 'Globex', location: 'Berlin, Germany' },
        ]),
        { call: { tool: 'finish', summary: 'Added 2 jobs.', evidence: ['Rows filled: 2'] } },
      ],
      versions: {
        '1': [
          { call: { tool: 'activate_tab', tabId: { byUrl: '/sheet' } } },
          ...writeRows([{ id: 101, title: 'Senior Frontend Engineer', company: 'Acme Labs', location: 'Remote' }]),
          {
            when: { textPresent: 'Rows filled: 1' },
            call: { tool: 'finish', summary: 'Added 1 remote frontend job; skipped the Berlin role after your correction.', evidence: ['Rows filled: 1'] },
          },
        ],
      },
    },
  ],
};

const canvas = { byName: 'Design canvas' };
const at = (dx: number, dy: number) => ({ x: { relativeTo: canvas, offset: dx }, y: { relativeTo: canvas, offset: dy, axis: 'y' } });

export const canvasEdit = {
  scenarios: [
    {
      match: 'text box',
      scope: scope('Move the text box right and change its text', ['read', 'navigate', 'edit', 'fill']),
      steps: [
        { call: { tool: 'observe_tab', tabId: bound, screenshot: true } },
        {
          call: { tool: 'drag_at', tabId: bound, screenshotId: { latest: true }, from: at(200, 110), to: at(400, 110) },
          expectation: { kind: 'text_present', text: 'x=280' },
        },
        { call: { tool: 'observe_tab', tabId: bound, screenshot: true } },
        { call: { tool: 'double_click_at', tabId: bound, screenshotId: { latest: true }, ...at(400, 110) }, expectation: { kind: 'text_present', text: 'editing' } },
        { call: { tool: 'observe_tab', tabId: bound, screenshot: true } },
        {
          call: { tool: 'type_at', tabId: bound, screenshotId: { latest: true }, ...at(400, 110), text: 'Grand Opening' },
          expectation: { kind: 'text_present', text: 'text: Grand Opening' },
        },
        {
          when: { textPresent: 'text: Grand Opening' },
          call: { tool: 'finish', summary: 'Moved the text box to the right and changed its text to “Grand Opening”.', evidence: ['Status shows x=280 and text: Grand Opening'] },
        },
      ],
    },
  ],
};
