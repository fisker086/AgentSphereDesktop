import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  CircularProgress,
  Collapse,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReActEvent } from '../api/chat';

export type PlanTaskRowStatus = 'pending' | 'running' | 'done' | 'error';

export type PlanDetailTone = 'error' | 'muted';

export interface PlanDetailLine {
  text: string;
  tone: PlanDetailTone;
}

export interface PlanTaskRow {
  index: number;
  task: string;
  status: PlanTaskRowStatus;
  /** Per-step tool / error lines (SSE order), shown under the task title */
  details?: PlanDetailLine[];
}

const DETAIL_MAX_CHARS = 900;

function truncateDetailText(s: string): string {
  const t = s.trim();
  if (t.length <= DETAIL_MAX_CHARS) return t;
  return `${t.slice(0, DETAIL_MAX_CHARS)}…`;
}

function dedupePushDetail(row: PlanTaskRow, text: string, tone: PlanDetailTone): PlanTaskRow {
  const t = truncateDetailText(text);
  if (!t) return row;
  const d = row.details ?? [];
  if (d.some((x) => x.text === t && x.tone === tone)) return row;
  return { ...row, details: [...d, { text: t, tone }] };
}

/** Skip thoughts that duplicate the checklist title or global phase lines */
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

/** Merge plan-and-execute SSE events into checklist rows (Cursor-style) + per-step detail lines */
export function applyPlanReActEventToRows(prev: PlanTaskRow[] | null, evt: ReActEvent): PlanTaskRow[] | null {
  if (evt.type === 'plan_tasks' && evt.plan_tasks && evt.plan_tasks.length > 0) {
    const incoming = evt.plan_tasks.map((t) => ({
      index: t.index,
      task: t.task,
      status: 'pending' as const,
    }));
    // Resume stream (e.g. after POST /chat/tool_result/stream) re-emits `plan_tasks`; replacing the
    // list resets every step to pending and looks like a duplicate card. Keep status + details when
    // the checklist is the same as the one we already have (matches web useChatPage merge behavior).
    if (
      prev &&
      prev.length === incoming.length &&
      prev.every((p, i) => p.task === incoming[i].task)
    ) {
      return prev.map((p, i) => ({
        ...p,
        index: incoming[i].index,
        task: incoming[i].task,
      }));
    }
    return incoming;
  }
  if (evt.type === 'plan_step' && evt.step != null && evt.plan_step_status) {
    if (!prev) return prev;
    const idx = evt.step - 1;
    if (idx < 0 || idx >= prev.length) return prev;
    const next = [...prev];
    const st = evt.plan_step_status;
    if (st === 'running') {
      next[idx] = { ...next[idx], status: 'running' };
    } else if (st === 'done') {
      next[idx] = { ...next[idx], status: 'done' };
    } else if (st === 'error') {
      next[idx] = { ...next[idx], status: 'error' };
    }
    return next;
  }

  if (!prev || prev.length === 0) return prev;
  const step = evt.step;
  if (step == null || step < 1) return prev;
  const idx = step - 1;
  if (idx < 0 || idx >= prev.length) return prev;
  const row = prev[idx];

  if (evt.type === 'error' && evt.content) {
    const line = evt.tool ? `${evt.tool}: ${evt.content}` : evt.content;
    const next = [...prev];
    next[idx] = dedupePushDetail(row, line, 'error');
    return next;
  }

  if (evt.type === 'observation' && evt.content) {
    if (isGenericStepDoneObservation(evt.content)) return prev;
    const line = evt.tool ? `${evt.tool}: ${evt.content}` : evt.content;
    const next = [...prev];
    next[idx] = dedupePushDetail(row, line, 'muted');
    return next;
  }

  if (evt.type === 'action' && evt.content) {
    const line = evt.tool ? `${evt.tool} · ${evt.content}` : evt.content;
    const next = [...prev];
    next[idx] = dedupePushDetail(row, line, 'muted');
    return next;
  }

  if (evt.type === 'thought' && evt.content) {
    if (shouldSkipThoughtForRow(evt.content, row.task)) return prev;
    const next = [...prev];
    next[idx] = dedupePushDetail(row, evt.content, 'muted');
    return next;
  }

  return prev;
}

const LONG_PLAN_THRESHOLD = 8;
/** At or above this step count, each step uses an accordion (foldable row). */
const STEP_ACCORDION_THRESHOLD = 5;

function StepStatusIcon({ status }: { status: PlanTaskRowStatus }) {
  if (status === 'done') {
    return <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />;
  }
  if (status === 'error') {
    return <ErrorOutlineIcon sx={{ fontSize: 20, color: 'error.main' }} />;
  }
  if (status === 'running') {
    return <CircularProgress size={18} thickness={5} sx={{ color: 'primary.main' }} />;
  }
  return <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: 'action.disabled' }} />;
}

function StepDetailsList({ details, detailMarginLeft }: { details: PlanDetailLine[]; detailMarginLeft?: number }) {
  if (details.length === 0) return null;
  return (
    <Box
      component="ul"
      sx={{
        m: 0,
        mt: 0.5,
        pl: 2.5,
        ml: detailMarginLeft ?? 0,
        listStyle: 'disc',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {details.map((d, di) => (
        <Box
          component="li"
          key={di}
          sx={{
            display: 'list-item',
            py: 0.25,
            color: d.tone === 'error' ? 'error.main' : 'text.secondary',
            fontSize: '0.75rem',
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}
        >
          {d.text}
        </Box>
      ))}
    </Box>
  );
}

export function PlanExecuteTaskPanel({ tasks, title }: { tasks: PlanTaskRow[]; title: string }) {
  const { t } = useTranslation();
  /** Long plans start collapsed so the stream area is not dominated by the checklist. */
  const [expanded, setExpanded] = useState(() => tasks.length <= LONG_PLAN_THRESHOLD);
  const useStepAccordion = tasks.length >= STEP_ACCORDION_THRESHOLD;
  const runningIdx = tasks.findIndex((r) => r.status === 'running');
  const errorIdx = tasks.findIndex((r) => r.status === 'error');
  const prevRunningIdx = useRef<number | null>(null);
  /** Which step row index [0..length) is expanded in accordion mode; only one open at a time. */
  const [openStepIdx, setOpenStepIdx] = useState<number>(() => {
    if (runningIdx >= 0) return runningIdx;
    if (errorIdx >= 0) return errorIdx;
    return 0;
  });

  useEffect(() => {
    if (!useStepAccordion) return;
    if (runningIdx >= 0 && runningIdx !== prevRunningIdx.current) {
      setOpenStepIdx(runningIdx);
      prevRunningIdx.current = runningIdx;
    }
    if (runningIdx < 0) prevRunningIdx.current = null;
  }, [runningIdx, useStepAccordion]);

  const stats = useMemo(() => {
    let done = 0;
    let running = 0;
    let err = 0;
    let pending = 0;
    for (const r of tasks) {
      if (r.status === 'done') done += 1;
      else if (r.status === 'running') running += 1;
      else if (r.status === 'error') err += 1;
      else pending += 1;
    }
    return { done, running, err, pending, total: tasks.length };
  }, [tasks]);

  if (tasks.length === 0) return null;

  return (
    <Box
      sx={{
        width: '100%',
        mb: 1.5,
        p: 1.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            setExpanded((e) => !e);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          cursor: 'pointer',
          userSelect: 'none',
          px: 0.5,
          mb: expanded ? 1 : 0,
          borderRadius: 1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block' }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, opacity: 0.9 }}>
            {t('agentDetail.planExecuteSummary', {
              total: stats.total,
              done: stats.done,
              running: stats.running,
              err: stats.err,
              pending: stats.pending,
            })}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0, pt: 0.25 }}>
          {expanded ? '▼' : '▶'}
        </Typography>
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit={false}>
        {useStepAccordion ? (
          <Box
            sx={{
              maxHeight: 420,
              overflow: 'auto',
              pr: 0.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            {tasks.map((row, i) => {
              const details = row.details ?? [];
              const isOpen = openStepIdx === i;
              return (
                <Accordion
                  key={row.index}
                  disableGutters
                  expanded={isOpen}
                  onChange={(_, next) => setOpenStepIdx(next ? i : -1)}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'transparent',
                    '&:before': { display: 'none' },
                    boxShadow: 'none',
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon sx={{ fontSize: 20 }} />}
                    sx={{
                      minHeight: 40,
                      py: 0.5,
                      px: 1,
                      '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'flex-start', gap: 1 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0, flex: 1 }}>
                      <Box sx={{ pt: 0.2, flexShrink: 0 }}>
                        <StepStatusIcon status={row.status} />
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          color: row.status === 'done' ? 'text.secondary' : 'text.primary',
                          opacity: row.status === 'pending' ? 0.85 : 1,
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: isOpen ? 'unset' : 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.5 }}>
                          {row.index}.
                        </Box>
                        {row.task}
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0, pb: 1, px: 1, pl: 1.5 }}>
                    {isOpen ? <StepDetailsList details={details} detailMarginLeft={3} /> : null}
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        ) : (
          <List
            dense
            disablePadding
            sx={{
              py: 0,
              maxHeight: 360,
              overflow: 'auto',
              pr: 0.5,
            }}
          >
            {tasks.map((row) => (
              <ListItem key={row.index} disableGutters sx={{ py: 0.5, alignItems: 'flex-start', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}>
                  <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                    <StepStatusIcon status={row.status} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{
                          color: row.status === 'done' ? 'text.secondary' : 'text.primary',
                          opacity: row.status === 'pending' ? 0.85 : 1,
                          wordBreak: 'break-word',
                        }}
                      >
                        <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.5 }}>
                          {row.index}.
                        </Box>
                        {row.task}
                      </Typography>
                    }
                  />
                </Box>
                <StepDetailsList details={row.details ?? []} detailMarginLeft={4} />
              </ListItem>
            ))}
          </List>
        )}
      </Collapse>
    </Box>
  );
}
