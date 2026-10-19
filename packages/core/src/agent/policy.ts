import type {
  ActionCategory,
  AuthorizationRecord,
  PageSnapshot,
  ScreenshotFrame,
  TaskStatus,
  ToolCall,
} from '@nudge/contracts';

import { isConfirmationValid, type Confirmation } from './preview';
import { classifyRisk, type RiskTarget } from './risk';
import { isFrameFresh, type FrameCurrentState } from './screenshot';
import { validateNavigation, type NavigationContext } from './url-policy';

export interface PolicyCtx {
  status: TaskStatus;
  boundTabId: number;
  knownTabIds: number[];
  tabRoles: Record<number, string>;
  documentId: string;
  snapshot?: PageSnapshot | undefined;
  authorization: AuthorizationRecord;
  navigation: Omit<NavigationContext, 'authorization'>;
  frame?: ScreenshotFrame | undefined;
  frameCurrent?: FrameCurrentState | undefined;
  now: number;
  riskLabel?: 'none' | 'consequential' | undefined;
  confirmation?: Confirmation | undefined;
  currentFingerprint?: string | undefined;
  generation?: number | undefined;
  bulkCount?: number | undefined;
  /** Target details for visual actions resolved by the caller (e.g. hit-test). */
  visualTarget?: RiskTarget | undefined;
}

export type PolicyOutcome =
  | { decision: 'allow' }
  | { decision: 'clarify'; question: string }
  | { decision: 'confirm'; reason: string; category: ActionCategory }
  | { decision: 'block'; reason: string };

const ALWAYS_CONFIRM: ReadonlySet<ActionCategory> = new Set(['delete_permanent', 'send_message', 'submit_form']);
const BULK_CONFIRM: ReadonlySet<ActionCategory> = new Set(['move_reversible', 'edit']);

function targetFor(ctx: PolicyCtx, call: ToolCall): RiskTarget | undefined {
  const elementId =
    'elementId' in call && call.elementId ? call.elementId : call.tool === 'drag' ? call.fromElementId : undefined;
  if (elementId) return ctx.snapshot?.elements.find((element) => element.id === elementId);
  return ctx.visualTarget;
}

function elementIds(call: ToolCall): string[] {
  if (call.tool === 'drag') return [call.fromElementId, call.toElementId];
  if (call.tool === 'transfer_code') return [];
  return 'elementId' in call && call.elementId ? [call.elementId] : [];
}

export function evaluateToolCall(ctx: PolicyCtx, call: ToolCall): PolicyOutcome {
  if (ctx.status !== 'running') return { decision: 'block', reason: 'The task is not running.' };

  // Tab binding: the active tab never silently becomes a target.
  if ('tabId' in call) {
    if (!ctx.knownTabIds.includes(call.tabId)) return { decision: 'block', reason: 'That tab is not part of this task.' };
    if (call.tool === 'close_tab') {
      if (ctx.tabRoles[call.tabId] !== 'opened_by_nudge') {
        return { decision: 'block', reason: 'Nudge only closes tabs it opened.' };
      }
      return { decision: 'allow' };
    }
    const tabScoped = !['activate_tab', 'observe_tab'].includes(call.tool);
    if (tabScoped && call.tabId !== ctx.boundTabId) {
      return { decision: 'block', reason: 'Switch to that tab before acting in it.' };
    }
  }

  const staleElement = elementIds(call).find((id) => !id.startsWith(`${ctx.documentId}:`));
  if (staleElement) return { decision: 'block', reason: 'Element reference is from an older page; observe again.' };

  if ('screenshotId' in call) {
    if (!ctx.frame || ctx.frame.screenshotId !== call.screenshotId || !ctx.frameCurrent) {
      return { decision: 'block', reason: 'Unknown screenshot; take a fresh one.' };
    }
    const freshness = isFrameFresh(ctx.frame, ctx.frameCurrent, ctx.now);
    if (!freshness.fresh) return { decision: 'block', reason: freshness.reason };
  }

  if (call.tool === 'open_tab' || call.tool === 'navigate') {
    const navigation = validateNavigation(call.url, { ...ctx.navigation, authorization: ctx.authorization });
    if (navigation.ok === false) return { decision: 'block', reason: navigation.reason };
    if (navigation.ok === 'confirm') {
      if (ctx.confirmation && ctx.currentFingerprint && isConfirmationValid(ctx.confirmation, ctx.currentFingerprint, ctx.generation ?? -1)) {
        return { decision: 'allow' };
      }
      return { decision: 'confirm', reason: navigation.reason, category: 'navigate' };
    }
  }

  const target = targetFor(ctx, call);
  const risk = classifyRisk(target, call);
  if (risk.blocked) return { decision: 'block', reason: risk.blocked };
  if (risk.category === 'purchase' || risk.category === 'auth_challenge') {
    return { decision: 'block', reason: 'This step needs you to do it yourself.' };
  }
  const ordinaryFieldEntry =
    risk.category === 'fill' &&
    (call.tool === 'type_text' ||
      call.tool === 'type_at' ||
      call.tool === 'select_option' ||
      call.tool === 'choose_option' ||
      call.tool === 'press_keys');
  if (!ordinaryFieldEntry && !ctx.authorization.categories.includes(risk.category)) {
    return { decision: 'block', reason: `That would ${risk.category.replace('_', ' ')}, which you did not ask for.` };
  }

  const consequential =
    ALWAYS_CONFIRM.has(risk.category) ||
    (risk.consequential && risk.category !== 'move_reversible') ||
    ctx.riskLabel === 'consequential' ||
    (BULK_CONFIRM.has(risk.category) && (ctx.bulkCount ?? 1) > 1);
  if (consequential) {
    if (
      ctx.confirmation &&
      ctx.currentFingerprint &&
      isConfirmationValid(ctx.confirmation, ctx.currentFingerprint, ctx.generation ?? -1)
    ) {
      return { decision: 'allow' };
    }
    return { decision: 'confirm', reason: 'This changes several items or cannot be undone easily.', category: risk.category };
  }
  return { decision: 'allow' };
}
