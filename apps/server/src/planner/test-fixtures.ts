import type { PlannerRequest } from '@nudge/contracts';

export function plannerRequest(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return {
    requestId: 'req_1',
    taskId: 'task_1',
    generation: 0,
    instructionVersion: 0,
    goal: 'Find remote frontend jobs',
    memory: {
      goal: 'Find remote frontend jobs',
      constraints: [],
      userData: [],
      plan: [],
      steps: [],
      tabs: [],
      recordFields: ['title'],
      recordCount: 0,
      sources: [],
      issues: [],
    },
    authorization: {
      taskId: 'task_1',
      instruction: 'Find remote frontend jobs',
      origins: 'browse_web',
      categories: ['read', 'navigate'],
      destinations: [],
      exclusions: [],
      limits: {},
    },
    observation: {
      tabId: 4,
      snapshot: {
        snapshotId: 'snap_1',
        documentId: 'doc_1',
        capturedAt: '2026-10-15T18:00:00.000Z',
        url: 'http://127.0.0.1:4173/jobs',
        title: 'Jobs',
        viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0, pageHeight: 1600 },
        elements: [
          { id: 'doc_1:1', kind: 'link', name: 'Next page', visible: true, disabled: false, href: 'http://127.0.0.1:4173/jobs?page=2' },
          { id: 'doc_1:2', kind: 'canvas', name: 'Design canvas', visible: true, disabled: false, rect: { x: 100, y: 50, width: 800, height: 500 } },
        ],
        text: ['Senior Frontend Engineer'],
        truncated: false,
        inaccessible: [],
      },
    },
    tabs: [
      { tabId: 4, windowId: 1, active: true, url: 'http://127.0.0.1:4173/jobs', title: 'Jobs', domain: '127.0.0.1', discarded: false, lastSeenAt: '2026-10-15T18:00:00.000Z' },
      { tabId: 5, windowId: 1, active: false, url: 'http://127.0.0.1:4173/sheet', title: 'Sheet', domain: '127.0.0.1', discarded: false, lastSeenAt: '2026-10-15T18:00:00.000Z' },
    ],
    capabilities: { vision: true, trustedInput: false },
    notes: [],
    ...overrides,
  };
}

export const SCREENSHOT = 'data:image/jpeg;base64,/9j/AAAA';
