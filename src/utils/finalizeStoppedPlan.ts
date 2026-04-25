import type { ChatHistoryMessage } from '../types';
import {
  applyPlanStepStatusToTasks,
  initTasksFromPlanTasksPayload,
} from './planExecuteMerge';

const STOP_DETAIL = '已手动停止回复';

function finalizeStoppedPlanReactSteps(raw: Record<string, any>[] | undefined): Record<string, any>[] | undefined {
  if (!raw?.length) return raw;
  const payloads = raw.map((p) => ({ ...p }));
  const planIdx = payloads.findIndex(
    (p) => p.type === 'plan_tasks' && Array.isArray(p.plan_tasks) && (p.plan_tasks as unknown[]).length > 0,
  );
  if (planIdx < 0) return raw;

  let tasks = initTasksFromPlanTasksPayload(payloads[planIdx]);
  for (let i = planIdx + 1; i < payloads.length; i++) {
    const p = payloads[i];
    if (p.type === 'plan_step') {
      tasks = applyPlanStepStatusToTasks(tasks, p);
    }
  }

  const extras: Record<string, any>[] = [];
  for (const row of tasks) {
    if (row.status !== 'running') continue;
    extras.push(
      { type: 'observation', step: row.index, content: STOP_DETAIL },
      { type: 'plan_step', step: row.index, plan_step_status: 'pending', content: row.task },
    );
  }
  if (extras.length === 0) return raw;
  return [...payloads, ...extras];
}

/** On manual stop, patch the latest assistant plan snapshot so history no longer shows a spinner forever. */
export function finalizeStoppedPlanMessages(messages: ChatHistoryMessage[]): ChatHistoryMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const msg = next[i];
    if (msg.role !== 'assistant') continue;
    const patched = finalizeStoppedPlanReactSteps(msg.react_steps);
    if (patched === msg.react_steps) continue;
    next[i] = { ...msg, react_steps: patched };
    break;
  }
  return next;
}
