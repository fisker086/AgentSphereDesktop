import type { ChatHistoryMessage } from '../types';
import { getPlanExecuteTasksFromReactSteps } from './hydrateReactStepsPlan';

/** Mirrors backend `internal/agent/stream_failure.go` user-visible fallback. */
export const GENERIC_STREAM_FAILURE_ZH = '抱歉，本次回复未能生成。请稍后重试。';

/** True if `s` is empty or only the generic stream-failure line (after normalizing whitespace). */
export function isGenericStreamFailureText(s: string): boolean {
  const t = String(s ?? '')
    .replace(/\s+/g, '')
    .trim();
  if (t === '') return true;
  const g = GENERIC_STREAM_FAILURE_ZH.replace(/\s+/g, '');
  return t === g;
}

/**
 * Hide an assistant bubble that only persisted the generic failure line when a **later**
 * assistant message in the same turn has real text (superseded placeholder).
 * Does **not** hide history while streaming — users should always see prior messages during generation.
 */
export function shouldHideAssistantBubbleForGenericFailure(
  msg: ChatHistoryMessage,
  index: number,
  messages: ChatHistoryMessage[],
): boolean {
  if (msg.role !== 'assistant') return false;
  if (!isGenericStreamFailureText(msg.content)) return false;

  for (let j = index + 1; j < messages.length; j++) {
    const m = messages[j];
    if (m.role === 'user') return false;
    if (m.role !== 'assistant') continue;
    const t = String(m.content ?? '').trim();
    if (t !== '' && !isGenericStreamFailureText(m.content)) {
      return true;
    }
  }
  return false;
}

function hasPlanExecuteTasks(msg: ChatHistoryMessage): boolean {
  return getPlanExecuteTasksFromReactSteps(msg.react_steps).length > 0;
}

/**
 * In one user turn, tool_result resumes can persist multiple consecutive assistant rows, each with
 * its own `react_steps.plan_tasks`. Show the checklist only on the latest assistant row in that
 * assistant streak so the UI updates one card instead of stacking many near-identical plan cards.
 */
export function shouldRenderPlanCardForAssistantMessage(
  msg: ChatHistoryMessage,
  index: number,
  messages: ChatHistoryMessage[],
): boolean {
  if (msg.role !== 'assistant') return false;
  if (!hasPlanExecuteTasks(msg)) return false;
  for (let i = index + 1; i < messages.length; i++) {
    const next = messages[i];
    if (next.role === 'user') return true;
    if (next.role === 'assistant' && hasPlanExecuteTasks(next)) {
      return false;
    }
  }
  return true;
}

/**
 * Hide superseded assistant placeholder bubbles in the same assistant streak. This keeps only the
 * last checklist card visible while still allowing meaningful assistant text to remain.
 */
export function shouldHideSupersededPlanAssistantBubble(
  msg: ChatHistoryMessage,
  index: number,
  messages: ChatHistoryMessage[],
): boolean {
  if (msg.role !== 'assistant') return false;
  if (!hasPlanExecuteTasks(msg)) return false;
  if (shouldRenderPlanCardForAssistantMessage(msg, index, messages)) return false;
  return isGenericStreamFailureText(msg.content);
}
