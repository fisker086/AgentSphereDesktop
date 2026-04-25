/**
 * Builds plan checklist rows from persisted `agent_memory.extra.react_steps` (same SSE-shaped
 * payloads as web `hydrateReactStepsFromServer`).
 */
import {
  applyPlanStepStatusToTasks,
  initTasksFromPlanTasksPayload,
  mergePlanDetailFromReActPayload,
  type PlanTaskRowWeb,
} from './planExecuteMerge';

export function getPlanExecuteTasksFromReactSteps(raw: unknown[] | undefined | null): PlanTaskRowWeb[] {
  if (!raw?.length) return [];
  const payloads = raw.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');

  const planIdx = payloads.findIndex(
    (p) => p.type === 'plan_tasks' && Array.isArray(p.plan_tasks) && (p.plan_tasks as unknown[]).length > 0,
  );
  if (planIdx < 0) return [];

  let tasks: PlanTaskRowWeb[] = initTasksFromPlanTasksPayload(payloads[planIdx]);
  for (let i = planIdx + 1; i < payloads.length; i++) {
    const p = payloads[i];
    const t = p.type as string | undefined;
    if (t === 'plan_step') {
      tasks = applyPlanStepStatusToTasks(tasks, p);
      continue;
    }
    if (t === 'plan_tasks') {
      continue;
    }
    if (t === 'error' || t === 'observation' || t === 'thought' || t === 'action') {
      const merged = mergePlanDetailFromReActPayload(tasks, p);
      if (merged) {
        tasks = merged;
      }
    }
  }
  return tasks;
}
