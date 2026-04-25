/** Align with PlanExecuteTaskPanel: per-step SSE detail lines (mirrors web `planExecuteMerge.ts`). */

export type PlanDetailTone = 'error' | 'muted';

export interface PlanDetailLine {
  text: string;
  tone: PlanDetailTone;
}

export interface PlanTaskRowWeb {
  index: number;
  task: string;
  status: 'pending' | 'running' | 'done' | 'error';
  details?: PlanDetailLine[];
}

const DETAIL_MAX_CHARS = 900;

function truncateDetailText(s: string): string {
  const t = s.trim();
  if (t.length <= DETAIL_MAX_CHARS) return t;
  return `${t.slice(0, DETAIL_MAX_CHARS)}…`;
}

function dedupePushDetail(row: PlanTaskRowWeb, text: string, tone: PlanDetailTone): PlanTaskRowWeb {
  const t = truncateDetailText(text);
  if (!t) return row;
  const d = row.details ?? [];
  if (d.some((x) => x.text === t && x.tone === tone)) return row;
  return { ...row, details: [...d, { text: t, tone }] };
}

function shouldSkipThoughtForRow(content: string, taskTitle: string): boolean {
  const s = content.trim();
  if (/^正在生成执行计划/.test(s)) return true;
  if (/^正在综合所有步骤/.test(s)) return true;
  if (/^正在直接回复/.test(s)) return true;
  if (/^当前请求无需多步执行/.test(s)) return true;
  const m = /^执行步骤\s+\d+\/\d+\s*:\s*(.+)$/s.exec(s);
  if (m && m[1].trim() === taskTitle.trim()) return true;
  return false;
}

function isGenericStepDoneObservation(content: string): boolean {
  return /^步骤\s*\d+\s*完成\s*$/u.test(content.trim());
}

export function mergePlanDetailFromReActPayload(
  tasks: PlanTaskRowWeb[],
  payload: Record<string, unknown>,
): PlanTaskRowWeb[] | null {
  const reactType = payload.type as string;
  const stepNum = payload.step as number | undefined;
  if (stepNum == null || stepNum < 1) return null;
  const idx = stepNum - 1;
  if (idx < 0 || idx >= tasks.length) return null;
  const row = tasks[idx];
  const content = String(payload.content ?? '');
  const tool = payload.tool as string | undefined;

  if (reactType === 'error' && content) {
    const line = tool ? `${tool}: ${content}` : content;
    return tasks.map((t, i) => (i === idx ? dedupePushDetail(t, line, 'error') : t));
  }
  if (reactType === 'observation' && content) {
    if (isGenericStepDoneObservation(content)) return null;
    const line = tool ? `${tool}: ${content}` : content;
    return tasks.map((t, i) => (i === idx ? dedupePushDetail(t, line, 'muted') : t));
  }
  if (reactType === 'action' && content) {
    const line = tool ? `${tool} · ${content}` : content;
    return tasks.map((t, i) => (i === idx ? dedupePushDetail(t, line, 'muted') : t));
  }
  if (reactType === 'thought' && content) {
    if (shouldSkipThoughtForRow(content, row.task)) return null;
    return tasks.map((t, i) => (i === idx ? dedupePushDetail(t, content, 'muted') : t));
  }
  return null;
}

export function initTasksFromPlanTasksPayload(p: Record<string, unknown>): PlanTaskRowWeb[] {
  const raw = p.plan_tasks as { index?: number; task?: string }[] | undefined;
  if (!raw?.length) return [];
  return raw.map((t) => ({
    index: typeof t.index === 'number' ? t.index : 0,
    task: String(t.task ?? ''),
    status: 'pending' as const,
  }));
}

export function applyPlanStepStatusToTasks(
  tasks: PlanTaskRowWeb[],
  payload: Record<string, unknown>,
): PlanTaskRowWeb[] {
  const st = payload.plan_step_status as string | undefined;
  const stepNum = payload.step as number | undefined;
  if (stepNum == null || !st) return tasks;
  const idx = stepNum - 1;
  if (idx < 0 || idx >= tasks.length) return tasks;
  const next = [...tasks];
  const cur = next[idx];
  let nextStatus: PlanTaskRowWeb['status'] = cur.status;
  if (st === 'running') nextStatus = 'running';
  else if (st === 'pending') nextStatus = 'pending';
  else if (st === 'done') nextStatus = 'done';
  else if (st === 'error') nextStatus = 'error';
  next[idx] = { ...cur, status: nextStatus };
  return next;
}

export function markRunningPlanTasksError(
  tasks: PlanTaskRowWeb[] | null,
  detailText: string,
): PlanTaskRowWeb[] | null {
  if (!tasks?.length) return tasks;
  const text = detailText.trim();
  return tasks.map((row) => {
    if (row.status !== 'running') return row;
    if (!text) return { ...row, status: 'error' };
    return dedupePushDetail({ ...row, status: 'error' }, text, 'error');
  });
}
