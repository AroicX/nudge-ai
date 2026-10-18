import type {
  ContentRequest,
  ContentResult,
  PageSnapshot,
  PlannerRequest,
  PlannerResponse,
  ScopeRequest,
  ScopeResponse,
  ScreenshotFrame,
  TabReference,
} from '@nudge/contracts';
import type { Checkpoint } from '@nudge/core';
import type { CandidateProfile } from '@nudge/contracts';

export interface TabsPort {
  list(): Promise<TabReference[]>;
  activate(tabId: number): Promise<TabReference>;
  open(url: string): Promise<TabReference>;
  navigate(tabId: number, url: string): Promise<void>;
  goBack(tabId: number): Promise<void>;
  goForward(tabId: number): Promise<void>;
  reload(tabId: number): Promise<void>;
  close(tabId: number): Promise<void>;
  waitForComplete(tabId: number, timeoutMs: number): Promise<void>;
  onRemoved(listener: (tabId: number) => void): () => void;
  onUpdated(listener: (tabId: number, info: { url?: string | undefined; status?: string | undefined }) => void): () => void;
}

export interface ContentPort {
  send(tabId: number, request: ContentRequest, signal?: AbortSignal): Promise<ContentResult>;
}

export interface ScreenshotPort {
  capture(tabId: number, snapshot: PageSnapshot): Promise<{ frame: ScreenshotFrame; dataUrl: string }>;
}

export interface CheckpointPort {
  save(checkpoint: Checkpoint): Promise<void>;
  load(): Promise<Checkpoint | undefined>;
  clear(): Promise<void>;
}

export interface PlannerPort {
  scope(request: ScopeRequest, signal: AbortSignal, provider?: 'openai' | 'ollama'): Promise<ScopeResponse>;
  plan(request: PlannerRequest, signal: AbortSignal, provider?: 'openai' | 'ollama'): Promise<PlannerResponse>;
}

export interface CdpPort {
  available(): Promise<boolean>;
  attach(tabId: number): Promise<void>;
  detach(): Promise<void>;
  click(x: number, y: number, options?: { double?: boolean }): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  key(chord: string): Promise<void>;
  insertText(text: string): Promise<void>;
  captureScreenshot(): Promise<string>;
  attachedTabId(): number | undefined;
  onLost(listener: (reason: string) => void): () => void;
}

/** The signed-in user's saved profile and documents (local paired server). Read-only. */
export interface ProfilePort {
  candidateProfile(signal?: AbortSignal): Promise<CandidateProfile>;
  searchCv(query: string, signal?: AbortSignal): Promise<Array<{ documentId: string; filename: string; excerpt: string }>>;
  documentFile(documentId: string, signal?: AbortSignal): Promise<{ filename: string; mime: string; base64: string }>;
}
