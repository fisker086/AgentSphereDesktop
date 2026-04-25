import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Typography,
  IconButton,
  TextField,
  Paper,
  CircularProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  AppBar,
  Toolbar,
  Avatar,
  Chip,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  ArrowBack as ArrowBackIcon,
  SmartToy as SmartToyIcon,
  Chat as ChatIcon,
  Psychology as PsychologyIcon,
  AttachFile as AttachFileIcon,
  Image as ImageIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Agent, ChatSession, ChatHistoryMessage, ChatRequest, ClientToolCall } from '../types';
import {
  listAgents,
  createSession,
  listSessions,
  deleteSession,
  updateSessionTitle,
  getSessionMessages,
  streamChatMessage,
  stopChatStream,
  closeStream,
  submitToolResultStream,
  flushMessagesAfterToolResult,
  flushMessagesAfterChatStream,
  loadClientModeTools,
  clientToolNeedsConfirm,
  uploadChatFile,
  createStreamingTypewriter,
  finalizeTypewriterAfterStream,
  getApprovalStatus,
  getPendingApprovalBySession,
  reconcileDeferredApprovalsFromStorage,
  saveApprovalDeferredCall,
  loadApprovalDeferredCall,
  clearApprovalDeferredCall,
  type StreamingTypewriter,
  type ReActEvent,
} from '../api/chat';
import { resolveChatAttachmentUrl } from '../api/config';
import { isTauri } from '@tauri-apps/api/core';
import { pickChatDocumentsTauri, pickChatImagesTauri } from '../utils/tauriFilePicker';
import { TypingIndicator } from '../components/TypingIndicator';
import { ClientToolIndicator } from '../components/ClientToolIndicator';
import {
  PlanExecuteTaskPanel,
  applyPlanReActEventToRows,
  type PlanTaskRow,
} from '../components/PlanExecuteTaskPanel';
import { invokeBuiltinClientTool, isBuiltinClientToolName } from '../utils/builtinClientTools';
import { formatClientToolProgressLabel } from '../utils/clientToolProgressLabel';
import { onChatInputEnterToSend } from '../utils/chatComposer';
import { useChatScrollToBottom } from '../hooks/useChatScrollToBottom';
import {
  groupSessionsByDay,
  mergeSessionsById,
  sortSessionsByUpdatedDesc,
  formatSessionTimeLine,
  type SessionDayBucket,
} from '../utils/sessionList';
import { alpha } from '@mui/material/styles';
import { USER_ATTACHMENT_SUMMARY_RE, userMessageTextToDisplay } from '../utils/chatMessageDisplay';
import {
  isGenericStreamFailureText,
  shouldHideSupersededPlanAssistantBubble,
  shouldRenderPlanCardForAssistantMessage,
  shouldHideAssistantBubbleForGenericFailure,
} from '../utils/chatStreamDisplay';
import { getPlanExecuteTasksFromReactSteps } from '../utils/hydrateReactStepsPlan';
import { finalizeStoppedPlanMessages } from '../utils/finalizeStoppedPlan';
import { markRunningPlanTasksError } from '../utils/planExecuteMerge';

const sessionRailWidth = 300;
/** Temporarily 10 for pagination testing; restore to 30 when done. */
const SESSIONS_PAGE_SIZE = 30;

/** 桌面 Agent 对话：仅用户列略窄，助手不变 */
const CHAT_USER_MESSAGE_COLUMN_MAX_WIDTH = 'min(50%, 400px)';
const CHAT_ASSISTANT_MESSAGE_COLUMN_MAX_WIDTH = 'min(59%, 382px)';

const markdownBoxSx = (opts: { userBubble: boolean }) => ({
  fontSize: '0.9375rem',
  lineHeight: 1.65,
  wordBreak: 'break-word' as const,
  '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
  '& ul, & ol': { my: 0.5, pl: 2.25 },
  '& li': { mb: 0.35 },
  '& blockquote': {
    m: 0,
    my: 1,
    pl: 1.5,
    borderLeft: '3px solid',
    borderColor: opts.userBubble ? 'rgba(255,255,255,0.45)' : 'divider',
    color: opts.userBubble ? 'rgba(255,255,255,0.92)' : 'text.secondary',
  },
  '& a': {
    color: opts.userBubble ? 'rgba(255,255,255,0.98)' : 'primary.main',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  '& pre': {
    fontSize: '0.8125rem',
    p: 1.25,
    borderRadius: 1.5,
    overflow: 'auto',
    maxWidth: '100%',
    // 助手气泡为浅色底：与 Web chat-md-root 的 pre 一致
    bgcolor: opts.userBubble ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.05)',
    color: opts.userBubble ? undefined : 'text.primary',
    border: opts.userBubble ? '1px solid rgba(255,255,255,0.12)' : '1px solid',
    borderColor: opts.userBubble ? 'transparent' : 'divider',
  },
  '& pre code': {
    bgcolor: 'transparent',
    color: opts.userBubble ? undefined : 'inherit',
    p: 0,
    fontSize: 'inherit',
  },
  '& :not(pre) > code': {
    fontSize: '0.8125rem',
    px: 0.5,
    py: 0.125,
    borderRadius: 0.5,
    bgcolor: opts.userBubble ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.06)',
    color: opts.userBubble ? undefined : 'text.primary',
  },
  '& table': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.875rem',
    my: 1,
  },
  '& th, & td': {
    border: '1px solid',
    borderColor: opts.userBubble ? 'rgba(255,255,255,0.25)' : 'divider',
    px: 1,
    py: 0.5,
  },
});

/** 气泡上方：本地时:分:秒（与 Web 端一致，不含年月日）。 */
function formatMessageClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const MAX_CHAT_IMAGES = 12;
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

/** 与后端 `/chat/upload` 允许的图片类型一致；勿用 `image/*`（会包含 svg、bmp 等）。 */
const IMAGE_BUTTON_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp';

const IMAGE_BUTTON_EXT = /\.(png|jpe?g|gif|webp)$/i;

function isAllowedImageButtonFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase().trim();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif' || mime === 'image/webp') {
    return true;
  }
  if (mime.startsWith('image/')) {
    return false;
  }
  return IMAGE_BUTTON_EXT.test(file.name);
}

/** 后端 `/chat/upload` 允许的文档：pdf / txt / md / json（不含图片，图片请用「上传图片」）。 */
const DOCUMENT_BUTTON_ACCEPT =
  '.pdf,.txt,.md,.json,application/pdf,text/plain,text/markdown,text/x-markdown,application/json';

const DOCUMENT_BUTTON_EXT = /\.(pdf|txt|md|json)$/i;

function isAllowedDocumentButtonFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase().trim();
  if (mime.startsWith('image/')) return false;
  if (mime === 'application/pdf') return true;
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/x-markdown') return true;
  if (mime === 'application/json') return true;
  return DOCUMENT_BUTTON_EXT.test(file.name);
}

/** 侧栏会话标题：不展示「[图片×N]」「[文件×N]」等前缀（新会话由后端生成，旧数据客户端兜底）。 */
function sessionTitleForDisplay(title: string | undefined): string {
  const s = (title ?? '').trim();
  if (!s) return '';
  return s.replace(USER_ATTACHMENT_SUMMARY_RE, '').trim();
}

function formatPendingFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const AgentDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  /** 当前流式助手气泡的起始时间（用于气泡上显示时:分:秒）。 */
  const [streamReplyStartedAt, setStreamReplyStartedAt] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [clientToolCall, setClientToolCall] = useState<ClientToolCall | null>(null);
  const [confirmClientTool, setConfirmClientTool] = useState<ClientToolCall | null>(null);
  const [toolResult, setToolResult] = useState('');
  const [clientToolPhase, setClientToolPhase] = useState<null | 'system'>(null);
  const [clientToolName, setClientToolName] = useState<string>('');
  const [clientToolDetail, setClientToolDetail] = useState<string>('');
  /** Server-side tool call waiting for Approvals API (SSE `approval_status: pending`). */
  const [approvalPending, setApprovalPending] = useState<{ approvalId: number; toolName: string } | null>(null);
  /** Plan-and-execute mode: checklist from SSE `plan_tasks` / `plan_step`. */
  const [planExecuteTasks, setPlanExecuteTasks] = useState<PlanTaskRow[] | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  /** Active session for client-side tool submit / resume (must match ChatPage). */
  const sessionIdRef = useRef<string | undefined>(undefined);
  /** Backend returned `approval_id` on client_tool_call — wait for Approvals before local confirm/Tauri. */
  const pendingClientToolAfterApprovalRef = useRef<ClientToolCall | null>(null);
  const handleClientToolIncomingRef = useRef<(call: ClientToolCall) => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Active stream session id (covers first-message session creation). */
  const streamingSessionRef = useRef<string | null>(null);
  const streamTypewriterRef = useRef<StreamingTypewriter | null>(null);
  /** While true, typewriter uses small per-frame steps (matches web useChatPage during SSE). */
  const streamTypingActiveRef = useRef(false);
  /** True after SSE `client_tool_call` — next [DONE] must not wipe the plan checklist. */
  const planPauseForClientToolRef = useRef(false);
  const streamTypewriterOpts = useMemo(
    () => ({ streaming: () => streamTypingActiveRef.current }),
    [],
  );

  const handleApprovalPending = useCallback((approvalId: number, toolName: string) => {
    setApprovalPending({ approvalId, toolName });
  }, []);

  const handlePlanReActEvent = useCallback((evt: ReActEvent) => {
    setPlanExecuteTasks((prev) => applyPlanReActEventToRows(prev, evt));
  }, []);

  const clearPlanAfterStreamFinish = useCallback(() => {
    if (!planPauseForClientToolRef.current) {
      setPlanExecuteTasks(null);
    } else {
      planPauseForClientToolRef.current = false;
    }
  }, []);

  const handleStopRef = useRef<() => Promise<void>>(async () => {});
  const { t, i18n } = useTranslation();
  const [sessionsLoading, setSessionsLoading] = useState(false);
  /** Next `offset` for GET /chat/sessions (server returns updated_at DESC). */
  const [nextSessionOffset, setNextSessionOffset] = useState(0);
  /** True if the last fetch returned a full page (there may be more on the server). */
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  /** Pending images (Web-style: preview + upload via /chat/upload + image_parts on stream). */
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ file: File }[]>([]);
  /** Full-screen preview for chat images (resolved attachment URL). */
  const [imageLightboxSrc, setImageLightboxSrc] = useState<string | null>(null);
  /**
   * 首次发消息会 createSession → selectedSession 变化触发 useEffect 拉取历史；
   * 新会话服务端仍为空，会覆盖乐观插入的用户消息。
   * 在「该 session 的首次流式结束」前不拉取（onDone 会带 sessionId 拉全量）。
   * 用 session_id 而非 boolean，避免 React Strict Mode 下 effect 跑两次时第二次仍拉空列表。
   */
  const deferMessagesFetchUntilStreamDoneRef = useRef<string | null>(null);
  const manuallyStoppedPlanSessionRef = useRef<string | null>(null);

  /** `silent`: 不显示全屏 loading；`sessionId` 解决流结束回调里 selectedSession 尚未更新的闭包问题。 */
  const loadMessages = async (opts?: { silent?: boolean; sessionId?: string }) => {
    const sid = opts?.sessionId ?? selectedSession?.session_id;
    if (!sid) return;
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await getSessionMessages(sid);
      setMessages(
        manuallyStoppedPlanSessionRef.current === sid ? finalizeStoppedPlanMessages(data) : data,
      );
    } catch {
      setError(t('errors.loadMessagesFailed'));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  /**
   * Server may auto-set session title after the first exchange. Merge the first list page
   * into state without resetting pagination (unlike loadSessions).
   */
  const refreshSessionsHead = async () => {
    if (!agent) return;
    try {
      const data = await listSessions(agent.id, SESSIONS_PAGE_SIZE, 0);
      setSessions((prev) => mergeSessionsById(prev, data));
    } catch {
      // best-effort sidebar sync
    }
  };

  const loadMessagesAndSyncSessionList = async (opts?: { silent?: boolean; sessionId?: string }) => {
    await loadMessages(opts);
    await refreshSessionsHead();
  };

  useEffect(() => {
    setPendingImages((prev) => {
      for (const p of prev) {
        if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview);
      }
      return [];
    });
    setPendingFiles([]);
    setAgent(null);
    setSessions([]);
    setNextSessionOffset(0);
    setHasMoreSessions(false);
    setSelectedSession(null);
    setMessages([]);
    void loadAgent();
  }, [agentId]);

  useEffect(() => {
    if (agent) {
      void loadSessions();
    }
  }, [agent]);

  useEffect(() => {
    if (!selectedSession) return;
    if (deferMessagesFetchUntilStreamDoneRef.current === selectedSession.session_id) {
      return;
    }
    void loadMessages();
  }, [selectedSession]);

  useChatScrollToBottom(
    chatScrollContainerRef,
    [messages, streamContent, streaming, clientToolPhase, approvalPending, planExecuteTasks],
    'AgentDetailPage',
    () => ({
      messagesLen: messages.length,
      streamLen: streamContent.length,
      planLen: planExecuteTasks?.length ?? 0,
      planSig: planExecuteTasks?.map((r) => `${r.index}:${r.status}`).join(',') ?? '',
    }),
  );

  useEffect(() => {
    sessionIdRef.current = selectedSession?.session_id;
  }, [selectedSession]);

  useEffect(() => {
    const syncDeferredApprovals = async () => {
      const sid = selectedSession?.session_id ?? sessionIdRef.current;
      if (!sid?.trim()) return;
      try {
        const r = await reconcileDeferredApprovalsFromStorage(sid);
        if (r.type === 'run_approved') {
          pendingClientToolAfterApprovalRef.current = null;
          setApprovalPending(null);
          const { approval_id: _a, skip_local_confirm: _s, ...rest } = r.call;
          handleClientToolIncomingRef.current({
            ...(rest as ClientToolCall),
            skip_local_confirm: true,
          });
          return;
        }
        if (r.type === 'still_pending') {
          pendingClientToolAfterApprovalRef.current = r.deferred;
          setApprovalPending({ approvalId: r.approvalId, toolName: r.toolName });
          return;
        }

        const pending = await getPendingApprovalBySession(sid);
        if (pending) {
          const restored = loadApprovalDeferredCall(sid, pending.id);
          if (restored?.call_id?.trim()) {
            pendingClientToolAfterApprovalRef.current = restored;
          }
          setApprovalPending({ approvalId: pending.id, toolName: pending.tool_name });
        }
      } catch {
        /* best-effort */
      }
    };

    void syncDeferredApprovals();

    const onFocus = () => {
      void syncDeferredApprovals();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncDeferredApprovals();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedSession?.session_id]);

  useEffect(() => {
    if (!approvalPending) return;
    const pollApproval = async () => {
      try {
        const status = await getApprovalStatus(approvalPending.approvalId);
        const ap = approvalPending;
        const sid = selectedSession?.session_id ?? sessionIdRef.current;
        if (status.status === 'approved') {
          let deferred = pendingClientToolAfterApprovalRef.current;
          if ((!deferred || !deferred.call_id?.trim()) && sid) {
            const restored = loadApprovalDeferredCall(sid, ap.approvalId);
            if (restored?.call_id?.trim()) {
              deferred = restored;
              pendingClientToolAfterApprovalRef.current = restored;
            }
          }
          if (deferred && ap && Number(deferred.approval_id) === Number(ap.approvalId)) {
            if (sid) clearApprovalDeferredCall(sid, ap.approvalId);
            pendingClientToolAfterApprovalRef.current = null;
            setApprovalPending(null);
            const { approval_id: _aid, skip_local_confirm: _sk, ...withoutApproval } = deferred;
            handleClientToolIncomingRef.current({
              ...(withoutApproval as ClientToolCall),
              skip_local_confirm: true,
            });
            return;
          }
          if (sid) clearApprovalDeferredCall(sid, ap.approvalId);
          setApprovalPending(null);
          if (sid) {
            setLoading(false);
            setStreaming(false);
            setStreamContent('');
            setStreamReplyStartedAt(null);
            void loadMessagesAndSyncSessionList({ silent: true, sessionId: sid });
          }
        } else if (status.status === 'rejected') {
          if (sid) clearApprovalDeferredCall(sid, ap.approvalId);
          if (pendingClientToolAfterApprovalRef.current?.approval_id === approvalPending?.approvalId) {
            pendingClientToolAfterApprovalRef.current = null;
          }
          setApprovalPending(null);
          setError(t('agentDetail.approvalRejected', { comment: status.comment || '—' }));
        } else if (status.status === 'expired') {
          if (sid) clearApprovalDeferredCall(sid, ap.approvalId);
          if (pendingClientToolAfterApprovalRef.current?.approval_id === approvalPending?.approvalId) {
            pendingClientToolAfterApprovalRef.current = null;
          }
          setApprovalPending(null);
          setError(t('agentDetail.approvalExpired'));
        }
      } catch {
        // transient network errors; next interval retries
      }
    };
    void pollApproval();
    const interval = window.setInterval(pollApproval, 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pollApproval();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [approvalPending, t]);

  const loadAgent = async () => {
    try {
      const agents = await listAgents();
      const found = agents.find((a) => a.id === Number(agentId));
      if (found) {
        setAgent(found);
      } else {
        setError(t('errors.agentNotFound'));
      }
    } catch {
      setError(t('errors.loadAgentFailed'));
    }
  };

  /** First page only (or refresh list from scratch). */
  const loadSessions = async () => {
    if (!agent) return;
    setSessionsLoading(true);
    try {
      const data = await listSessions(agent.id, SESSIONS_PAGE_SIZE, 0);
      setSessions(data);
      setNextSessionOffset(data.length);
      setHasMoreSessions(data.length === SESSIONS_PAGE_SIZE);
    } catch {
      setError(t('errors.loadSessionsFailed'));
    } finally {
      setSessionsLoading(false);
    }
  };

  /** Append next page; merges by session_id so new local sessions stay consistent. */
  const loadMoreSessions = async () => {
    if (!agent || sessionsLoading || !hasMoreSessions) return;
    setSessionsLoading(true);
    try {
      const data = await listSessions(agent.id, SESSIONS_PAGE_SIZE, nextSessionOffset);
      if (data.length === 0) {
        setHasMoreSessions(false);
        return;
      }
      setSessions((prev) => mergeSessionsById(prev, data));
      setNextSessionOffset((o) => o + data.length);
      setHasMoreSessions(data.length === SESSIONS_PAGE_SIZE);
    } catch {
      setError(t('errors.loadSessionsFailed'));
    } finally {
      setSessionsLoading(false);
    }
  };

  const sortedSessions = useMemo(
    () => sortSessionsByUpdatedDesc(sessions),
    [sessions],
  );

  const groupedSessions = useMemo(
    () => groupSessionsByDay(sortedSessions),
    [sortedSessions],
  );

  const sessionGroups: { bucket: SessionDayBucket; labelKey: string }[] = [
    { bucket: 'today', labelKey: 'agentDetail.sessionGroupToday' },
    { bucket: 'yesterday', labelKey: 'agentDetail.sessionGroupYesterday' },
    { bucket: 'earlier', labelKey: 'agentDetail.sessionGroupEarlier' },
  ];

  const handleNewSession = async () => {
    if (!agent) return;
    try {
      const session = await createSession(agent.id);
      setSessions((prev) => [session, ...prev]);
      setSelectedSession(session);
      setMessages([]);
    } catch {
      setError(t('errors.createSessionFailed'));
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (selectedSession?.session_id === sessionId) {
        setSelectedSession(null);
        setMessages([]);
      }
    } catch {
      setError(t('errors.deleteSessionFailed'));
    }
  };

  const handleRenameSession = async () => {
    if (!selectedSession || !newTitle.trim()) return;
    try {
      await updateSessionTitle(selectedSession.session_id, newTitle);
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === selectedSession.session_id ? { ...s, title: newTitle } : s
        )
      );
      setSelectedSession((prev) => (prev ? { ...prev, title: newTitle } : null));
      setRenameDialog(false);
    } catch {
      setError(t('errors.renameSessionFailed'));
    }
  };

  const handleClientToolIncoming = (call: ClientToolCall): void => {
    const sid = selectedSession?.session_id ?? sessionIdRef.current;
    if (!sid?.trim() || !call.call_id?.trim()) return;
    planPauseForClientToolRef.current = true;
    if (call.approval_id != null && call.approval_id > 0) {
      pendingClientToolAfterApprovalRef.current = call;
      saveApprovalDeferredCall(sid, call);
      setApprovalPending({ approvalId: call.approval_id, toolName: call.tool_name });
      return;
    }
    setStreaming(false);
    setLoading(false);
    setClientToolPhase(null);
    setClientToolName('');
    setClientToolDetail('');
    streamTypingActiveRef.current = false;
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = null;
    setStreamContent('');
    setStreamReplyStartedAt(null);
    streamingSessionRef.current = null;
    const needsConfirm =
      !call.skip_local_confirm && clientToolNeedsConfirm(call.risk_level, call.execution_mode);
    if (import.meta.env.DEV) {
      console.debug('[AgentDetailPage handleClientToolIncoming]', { call, needsConfirm });
    }

    const runBuiltinClientTool = (toolName: string): void => {
      // Sync with setStreaming(false) above so React batches one commit; async boundary deferred
      // "system" phase to the next microtask and caused tall→short scrollHeight (visible jitter).
      setClientToolPhase('system');
      setClientToolName(toolName.replace('builtin_', ''));
      setClientToolDetail(formatClientToolProgressLabel(toolName, call.params as Record<string, unknown>));
      void (async () => {
        try {
          const out = await invokeBuiltinClientTool(toolName, call.params as Record<string, unknown>);
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
          setStreamReplyStartedAt(new Date().toISOString());
          submitToolResultStream(
            sid,
            call.call_id,
            out,
            undefined,
            (c) => streamTypewriterRef.current?.push(c),
            (doneSid) => {
              finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
                setStreaming(false);
                setStreamContent('');
                setStreamReplyStartedAt(null);
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setClientToolName('');
              setClientToolDetail('');
              setError(e.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            handlePlanReActEvent,
          );
        } catch (e) {
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          const toolFailMsg = e instanceof Error ? e.message : String(e);
          console.error(`[AgentDetailPage] builtin client tool failed: ${toolName}`, e);
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
          setStreamReplyStartedAt(new Date().toISOString());
          submitToolResultStream(
            sid,
            call.call_id,
            '',
            toolFailMsg,
            (c) => streamTypewriterRef.current?.push(c),
            (doneSid) => {
              finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
                setStreaming(false);
                setStreamContent('');
                setStreamReplyStartedAt(null);
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
              });
            },
            (err) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setClientToolName('');
              setClientToolDetail('');
              setStreamReplyStartedAt(null);
              setError(err.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            handlePlanReActEvent,
          );
        }
      })();
    };

    if (isBuiltinClientToolName(call.tool_name)) {
      if (needsConfirm) {
        setConfirmClientTool(call);
        return;
      }
      runBuiltinClientTool(call.tool_name);
      return;
    }

    if (needsConfirm) {
      setConfirmClientTool(call);
      return;
    }
    setClientToolCall(call);
    setToolResult('');
  };

  const handleConfirmRiskyClientTool = (): void => {
    if (!confirmClientTool) return;
    const call = confirmClientTool;
    setConfirmClientTool(null);
    const sid = selectedSession?.session_id ?? sessionIdRef.current;
    if (!sid?.trim() || !call.call_id?.trim()) {
      setError(t('errors.sessionOrCallMissing'));
      return;
    }

    const confirmRunBuiltinClientTool = (toolName: string): void => {
      void (async () => {
        setClientToolPhase('system');
        setClientToolName(toolName.replace('builtin_', ''));
        setClientToolDetail(formatClientToolProgressLabel(toolName, call.params as Record<string, unknown>));
        try {
          const out = await invokeBuiltinClientTool(toolName, call.params as Record<string, unknown>);
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
          setStreamReplyStartedAt(new Date().toISOString());
          submitToolResultStream(
            sid,
            call.call_id,
            out,
            undefined,
            (c) => streamTypewriterRef.current?.push(c),
            (doneSid) => {
              finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
                setStreaming(false);
                setStreamContent('');
                setStreamReplyStartedAt(null);
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setClientToolName('');
              setClientToolDetail('');
              setError(e.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            handlePlanReActEvent,
          );
        } catch (e) {
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          const toolFailMsg = e instanceof Error ? e.message : String(e);
          console.error(`[AgentDetailPage] confirm builtin client tool failed: ${toolName}`, e);
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
          setStreamReplyStartedAt(new Date().toISOString());
          submitToolResultStream(
            sid,
            call.call_id,
            '',
            toolFailMsg,
            (c) => streamTypewriterRef.current?.push(c),
            (doneSid) => {
              finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
                setStreaming(false);
                setStreamContent('');
                setStreamReplyStartedAt(null);
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
              });
            },
            (err) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setClientToolName('');
              setClientToolDetail('');
              setStreamReplyStartedAt(null);
              setError(err.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            handlePlanReActEvent,
          );
        }
      })();
    };

    if (isBuiltinClientToolName(call.tool_name)) {
      confirmRunBuiltinClientTool(call.tool_name);
    } else {
      setClientToolCall(call);
      setToolResult('');
    }
  };

  /** 向服务端提交「用户取消本次客户端工具」，结束等待并刷新消息；先清顶部 Alert，避免旧错误与本次取消叠在一起。 */
  const submitClientToolCancelled = (call: ClientToolCall | null): void => {
    setError('');
    if (!call?.call_id?.trim()) return;
    const sid = selectedSession?.session_id ?? sessionIdRef.current;
    if (!sid?.trim()) {
      setError(t('errors.sessionOrCallMissing'));
      return;
    }
    const cancelText = t('agentDetail.clientToolCancelledByUser');
    setPlanExecuteTasks((prev) => markRunningPlanTasksError(prev, cancelText));
    setStreaming(true);
    streamTypingActiveRef.current = true;
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
    setStreamReplyStartedAt(new Date().toISOString());
    submitToolResultStream(
      sid,
      call.call_id,
      '',
      cancelText,
      (c) => streamTypewriterRef.current?.push(c),
      (doneSid) => {
        finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
          setStreaming(false);
          setStreamContent('');
          setStreamReplyStartedAt(null);
          planPauseForClientToolRef.current = false;
          if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
        });
      },
      (e) => {
        streamTypingActiveRef.current = false;
        streamTypewriterRef.current?.reset();
        streamTypewriterRef.current = null;
        setStreaming(false);
        setStreamReplyStartedAt(null);
        setStreamContent('');
        setError(e.message);
      },
      handleClientToolIncoming,
      handleApprovalPending,
      handlePlanReActEvent,
    );
  };

  /** 用户关闭风险确认弹窗（取消 / 点遮罩 / Esc）时向服务端提交工具错误，便于会话继续且历史中有迹可循。 */
  const dismissConfirmClientTool = (): void => {
    const call = confirmClientTool;
    setConfirmClientTool(null);
    submitClientToolCancelled(call);
  };

  /** 粘贴结果弹窗取消时同样上报取消；此前仅关弹窗未上报，会话会卡在等待工具，界面像「提示不消失」。 */
  const dismissPasteClientTool = (): void => {
    const call = clientToolCall;
    setClientToolCall(null);
    setToolResult('');
    submitClientToolCancelled(call);
  };

  const handleToolCallSubmit = (): void => {
    if (!clientToolCall || !selectedSession) return;
    const call = clientToolCall;
    if (!call.call_id?.trim()) {
      setError(t('errors.sessionOrCallMissing'));
      return;
    }
    const sid = selectedSession.session_id;
    const result = toolResult;
    setClientToolCall(null);
    setToolResult('');
    setStreaming(true);
    streamTypingActiveRef.current = true;
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
    setStreamReplyStartedAt(new Date().toISOString());
    submitToolResultStream(
      sid,
      call.call_id,
      result,
      undefined,
      (c) => streamTypewriterRef.current?.push(c),
      (doneSid) => {
        finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
          setStreaming(false);
          setStreamContent('');
          setStreamReplyStartedAt(null);
          clearPlanAfterStreamFinish();
          if (doneSid) flushMessagesAfterToolResult(loadMessagesAndSyncSessionList, doneSid);
        });
      },
      (e) => {
        streamTypingActiveRef.current = false;
        streamTypewriterRef.current?.reset();
        streamTypewriterRef.current = null;
        setStreaming(false);
        setLoading(false);
        planPauseForClientToolRef.current = false;
        setPlanExecuteTasks(null);
        setError(e.message);
      },
      handleClientToolIncoming,
      handleApprovalPending,
      handlePlanReActEvent,
    );
  };

  handleClientToolIncomingRef.current = handleClientToolIncoming;

  const handleSend = async () => {
    if (!agent || streaming || clientToolPhase) return;
    const text = input.trim();
    const imgsSnap = [...pendingImages];
    const filesSnap = [...pendingFiles];
    if (!text && imgsSnap.length === 0 && filesSnap.length === 0) return;

    const userLabel =
      text !== ''
        ? text
        : imgsSnap.length > 0
          ? t('agentDetail.imageOnlyMessage')
          : t('agentDetail.fileOnlyMessage');

    let currentSessionId = selectedSession?.session_id;

    if (!currentSessionId) {
      try {
        const session = await createSession(agent.id);
        deferMessagesFetchUntilStreamDoneRef.current = session.session_id;
        setSessions((prev) => [session, ...prev]);
        setSelectedSession(session);
        currentSessionId = session.session_id;
        sessionIdRef.current = currentSessionId;
      } catch {
        setError(t('errors.createSessionFailed'));
        return;
      }
    } else {
      sessionIdRef.current = currentSessionId;
    }

    setInput('');
    setPendingImages([]);
    setPendingFiles([]);
    for (const im of imgsSnap) {
      if (im.preview.startsWith('blob:')) URL.revokeObjectURL(im.preview);
    }
    setError('');
    manuallyStoppedPlanSessionRef.current = null;
    planPauseForClientToolRef.current = false;
    setPlanExecuteTasks(null);

    const streamReq: ChatRequest = {
      agent_id: agent.id,
      message: userLabel,
      session_id: currentSessionId,
    };

    try {
      const uploadedImageUrls: string[] = [];
      for (const { file } of imgsSnap) {
        const uploaded = await uploadChatFile(file);
        if (uploaded) uploadedImageUrls.push(uploaded.url);
      }
      const uploadedFileUrls: string[] = [];
      for (const { file } of filesSnap) {
        const uploaded = await uploadChatFile(file);
        if (uploaded) uploadedFileUrls.push(uploaded.url);
      }
      if (imgsSnap.length > 0 && uploadedImageUrls.length < imgsSnap.length) {
        setError(t('agentDetail.partialImageUploadFailed'));
      }
      if (imgsSnap.length > 0 && uploadedImageUrls.length === 0) {
        throw new Error(t('agentDetail.partialImageUploadFailed'));
      }
      if (uploadedImageUrls.length > 0) {
        streamReq.image_urls = uploadedImageUrls;
      }
      if (uploadedFileUrls.length > 0) {
        streamReq.file_urls = uploadedFileUrls;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'user',
          content: userLabel,
          image_urls: uploadedImageUrls,
          file_urls: uploadedFileUrls,
          created_at: new Date().toISOString(),
        },
      ]);

      setLoading(true);
      setStreaming(true);
      streamTypingActiveRef.current = true;
      streamTypewriterRef.current?.reset();
      streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
      setStreamReplyStartedAt(new Date().toISOString());
      streamingSessionRef.current = currentSessionId;

      await loadClientModeTools();
      streamChatMessage(
        streamReq,
        (content) => {
          streamTypewriterRef.current?.push(content);
        },
        handlePlanReActEvent,
        (sessionId) => {
          const sid = sessionId || streamingSessionRef.current || undefined;
          streamingSessionRef.current = null;
          finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
            setStreaming(false);
            setLoading(false);
            setStreamContent('');
            setStreamReplyStartedAt(null);
            clearPlanAfterStreamFinish();
            if (sid) {
              if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
                deferMessagesFetchUntilStreamDoneRef.current = null;
              }
              flushMessagesAfterChatStream(loadMessagesAndSyncSessionList, sid);
            }
          });
        },
        (err) => {
          const sid = streamingSessionRef.current ?? undefined;
          streamingSessionRef.current = null;
          streamTypingActiveRef.current = false;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = null;
          setStreaming(false);
          setLoading(false);
          setStreamReplyStartedAt(null);
          planPauseForClientToolRef.current = false;
          setPlanExecuteTasks(null);
          setError(err?.message || String(err));
          if (sid) {
            if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
              deferMessagesFetchUntilStreamDoneRef.current = null;
            }
            flushMessagesAfterChatStream(loadMessagesAndSyncSessionList, sid);
          }
        },
        handleClientToolIncoming,
        handleApprovalPending,
      );
    } catch (err: unknown) {
      setInput(text);
      setPendingImages(imgsSnap.map(({ file }) => ({ file, preview: URL.createObjectURL(file) })));
      setPendingFiles(filesSnap);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = async () => {
    const sid = streamingSessionRef.current ?? selectedSession?.session_id;
    try {
      if (sid) {
        manuallyStoppedPlanSessionRef.current = sid;
        await stopChatStream(sid);
      } else {
        closeStream();
      }
    } catch {
      closeStream();
    } finally {
      streamingSessionRef.current = null;
      streamTypingActiveRef.current = false;
      streamTypewriterRef.current?.reset();
      streamTypewriterRef.current = null;
      setStreaming(false);
      setLoading(false);
      setStreamContent('');
      setStreamReplyStartedAt(null);
      planPauseForClientToolRef.current = false;
      setPlanExecuteTasks(null);
      if (sid) {
        if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
          deferMessagesFetchUntilStreamDoneRef.current = null;
        }
        flushMessagesAfterChatStream(loadMessagesAndSyncSessionList, sid);
      }
    }
  };

  handleStopRef.current = handleStop;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && streaming) {
        e.preventDefault();
        void handleStopRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [streaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    onChatInputEnterToSend(e, handleSend);
  };

  const appendPendingImageFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    setPendingImages((prev) => {
      let next = [...prev];
      for (const file of picked) {
        if (!isAllowedImageButtonFile(file)) {
          setError(t('agentDetail.imageTypeNotAllowed'));
          continue;
        }
        if (file.size > MAX_CHAT_IMAGE_BYTES) {
          setError(t('agentDetail.imageTooLarge'));
          continue;
        }
        if (next.length >= MAX_CHAT_IMAGES) {
          setError(t('agentDetail.maxImages', { n: MAX_CHAT_IMAGES }));
          break;
        }
        next = [...next, { file, preview: URL.createObjectURL(file) }];
      }
      return next;
    });
  };

  const appendPendingDocumentFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    setPendingFiles((prev) => {
      let next = [...prev];
      for (const file of picked) {
        if (!isAllowedDocumentButtonFile(file)) {
          setError(t('agentDetail.documentTypeNotAllowed'));
          continue;
        }
        if (file.size > MAX_CHAT_FILE_BYTES) {
          setError(t('agentDetail.fileTooLarge'));
          continue;
        }
        next = [...next, { file }];
      }
      return next;
    });
  };

  const openImagePicker = async () => {
    if (isTauri()) {
      try {
        const files = await pickChatImagesTauri();
        appendPendingImageFiles(files);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    imageInputRef.current?.click();
  };

  const openFilePicker = async () => {
    if (isTauri()) {
      try {
        const files = await pickChatDocumentsTauri();
        appendPendingDocumentFiles(files);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    appendPendingImageFiles(picked);
  };

  /** 文档专用：仅 PDF / TXT / MD / JSON（与后端上传白名单一致）；图片请用「上传图片」。 */
  const handleGeneralFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    appendPendingDocumentFiles(picked);
  };

  /** Clipboard: images only (aligned with Web `onComposerPaste`). */
  const handlePaste = (e: React.ClipboardEvent) => {
    const cd = e.clipboardData;
    if (!cd) return;

    const tryImage = (file: File | null): boolean => {
      if (!file || file.size === 0) return false;
      if (!isAllowedImageButtonFile(file)) return false;
      e.preventDefault();
      if (file.size > MAX_CHAT_IMAGE_BYTES) {
        setError(t('agentDetail.imageTooLarge'));
        return true;
      }
      setPendingImages((prev) => {
        if (prev.length >= MAX_CHAT_IMAGES) {
          setError(t('agentDetail.maxImages', { n: MAX_CHAT_IMAGES }));
          return prev;
        }
        return [...prev, { file, preview: URL.createObjectURL(file) }];
      });
      return true;
    };

    const { files } = cd;
    if (files && files.length > 0) {
      let any = false;
      for (let i = 0; i < files.length; i++) {
        if (tryImage(files[i])) any = true;
      }
      if (any) return;
    }

    const { items } = cd;
    if (!items?.length) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const mime = item.type || '';
      if (mime !== '' && !mime.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (tryImage(file)) return;
    }
  };

  const handleRemovePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(index, 1);
      if (removed?.preview.startsWith('blob:')) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  };

  const handleRemovePendingFile = (index: number) => {
    setPendingFiles((prev) => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });
  };

  if (!agent) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  const sessionActionIconSx = {
    color: 'text.primary',
    p: 0.5,
    '&:hover': {
      color: 'primary.main',
      bgcolor: 'action.hover',
    },
    '&:focus-visible': {
      color: 'primary.main',
      bgcolor: 'action.selected',
    },
  } as const;

  const renderSessionRow = (session: ChatSession, bucket: SessionDayBucket) => (
    <ListItem key={session.session_id} disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        selected={selectedSession?.session_id === session.session_id}
        onClick={() => setSelectedSession(session)}
        sx={{
          borderRadius: 2,
          '& .session-row-actions': {
            opacity: 0,
            transition: 'opacity 0.15s ease',
          },
          /* 与是否当前选中无关：悬停显示；Tab 到按钮时由 focus-within 显示 */
          '&:hover .session-row-actions': {
            opacity: 1,
          },
          '& .session-row-actions:focus-within': {
            opacity: 1,
          },
          '@media (hover: none)': {
            '& .session-row-actions': {
              opacity: 1,
            },
          },
          '&:hover': {
            bgcolor: 'action.hover',
          },
          '&.Mui-selected': {
            bgcolor: 'action.selected',
            '&:hover': {
              bgcolor: 'action.selected',
            },
            '& .session-row-actions .MuiIconButton-root': {
              color: 'primary.light',
            },
            '&:hover .session-row-actions .MuiIconButton-root': {
              color: 'primary.main',
              bgcolor: 'action.hover',
            },
          },
        }}
      >
        <ListItemText
          primary={
            <Typography
              variant="body2"
              fontWeight={selectedSession?.session_id === session.session_id ? 600 : 400}
              noWrap
            >
              {sessionTitleForDisplay(session.title) || t('agentDetail.newChat')}
            </Typography>
          }
          secondary={
            <Typography variant="caption" color="text.secondary">
              {formatSessionTimeLine(session, bucket, i18n.language)}
            </Typography>
          }
        />
        <Box
          className="session-row-actions"
          sx={{
            display: 'flex',
            flexShrink: 0,
          }}
        >
          <Tooltip title={t('agentDetail.rename')}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedSession(session);
                setNewTitle(sessionTitleForDisplay(session.title) || session.title);
                setRenameDialog(true);
              }}
              sx={sessionActionIconSx}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('agentDetail.delete')}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteSession(session.session_id);
              }}
              sx={sessionActionIconSx}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </ListItemButton>
    </ListItem>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'transparent',
      }}
    >
      <AppBar position="static" elevation={0}>
        <Toolbar variant="dense">
          <Tooltip title={t('agentDetail.backToAgents')}>
            <IconButton edge="start" color="default" onClick={() => navigate('/agents')}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 1 }}>
            <Avatar
              sx={{
                width: 36,
                height: 36,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <SmartToyIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight="600" color="text.primary">
                {agent.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {agent.category || 'AI Assistant'}
              </Typography>
            </Box>
          </Box>
          
          <Box sx={{ flex: 1 }} />
          
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleNewSession}
            size="small"
            sx={{ textTransform: 'none' }}
          >
            {t('agentDetail.newChat')}
          </Button>
        </Toolbar>
      </AppBar>

      {error && (
        <Alert severity="error" sx={{ m: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <Drawer
          variant="permanent"
          sx={{
            width: sessionRailWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: sessionRailWidth,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
            },
          }}
        >
          <Box
            sx={{
              p: 1.5,
              bgcolor: (t) => alpha(t.palette.background.default, 0.85),
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <ChatIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight="600" sx={{ flex: 1, minWidth: 0 }}>
                {t('agentDetail.sessions')}
              </Typography>
              <Chip
                label={hasMoreSessions ? `${sessions.length}+` : sessions.length}
                size="small"
                title={hasMoreSessions ? t('agentDetail.sessionsHasMoreTitle') : undefined}
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Box>
          </Box>

          <List
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              p: 1,
              pt: 0,
            }}
          >
            {sessionsLoading && sessions.length === 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={28} />
              </Box>
            )}
            {sessions.length > 0 &&
              sessionGroups.map(({ bucket, labelKey }) => {
                const items = groupedSessions[bucket];
                if (items.length === 0) return null;
                return (
                  <React.Fragment key={bucket}>
                    <ListSubheader
                      disableSticky
                      sx={{
                        bgcolor: 'transparent',
                        lineHeight: 2,
                        py: 0.5,
                        mt: bucket === 'today' ? 0 : 0.5,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: 'text.secondary',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {t(labelKey)}
                    </ListSubheader>
                    {items.map((session) => renderSessionRow(session, bucket))}
                  </React.Fragment>
                );
              })}
            {!sessionsLoading && sessions.length === 0 && (
              <Box
                sx={{
                  textAlign: 'center',
                  py: 4,
                  px: 2,
                }}
              >
                <ChatIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  {t('agentDetail.noSessions')}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {t('agentDetail.noSessionsHint')}
                </Typography>
              </Box>
            )}
          </List>

          {hasMoreSessions && (
            <Box
              sx={{
                flexShrink: 0,
                px: 1,
                py: 1.25,
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: (th) => alpha(th.palette.background.default, 0.5),
              }}
            >
              <Button
                fullWidth
                size="small"
                variant="outlined"
                color="primary"
                disabled={sessionsLoading}
                onClick={() => void loadMoreSessions()}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {sessionsLoading ? t('agentDetail.sessionListLoading') : t('agentDetail.loadMoreSessions')}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.75 }}>
                {t('agentDetail.sessionsPageHint', { count: SESSIONS_PAGE_SIZE })}
              </Typography>
            </Box>
          )}
        </Drawer>

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
          <Box
            ref={chatScrollContainerRef}
            sx={{
              flex: 1,
              overflow: 'auto',
              px: { xs: 2, sm: 3 },
              py: 2.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 2.25,
              width: '100%',
              minWidth: 0,
            }}
          >
            {loading && !streaming && !clientToolPhase ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress size={36} sx={{ color: 'primary.main' }} />
              </Box>
            ) : messages.length === 0 && !streaming && !clientToolPhase ? (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  py: 6,
                }}
              >
                <Box
                  sx={{
                    width: 88,
                    height: 88,
                    borderRadius: '50%',
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                    border: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2.5,
                    boxShadow: (t) => `0 8px 32px ${alpha(t.palette.primary.main, 0.15)}`,
                  }}
                >
                  <PsychologyIcon sx={{ fontSize: 42, color: 'primary.main', opacity: 0.9 }} />
                </Box>
                <Typography variant="h6" color="text.primary" fontWeight={700} gutterBottom>
                  {t('agentDetail.startConversation')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 360 }}>
                  {t('agentDetail.startConversationHint', { name: agent.name })}
                </Typography>
              </Box>
            ) : (
              <>
                {messages
                  .map((msg, idx) => ({ msg, idx }))
                  .filter(
                    (x) => {
                      if (
                        streaming &&
                        (planExecuteTasks?.length ?? 0) > 0 &&
                        x.msg.role === 'assistant' &&
                        shouldRenderPlanCardForAssistantMessage(x.msg, x.idx, messages) &&
                        getPlanExecuteTasksFromReactSteps(x.msg.react_steps).length > 0 &&
                        isGenericStreamFailureText(x.msg.content)
                      ) {
                        return false;
                      }
                      return (
                        !shouldHideAssistantBubbleForGenericFailure(x.msg, x.idx, messages) &&
                        !shouldHideSupersededPlanAssistantBubble(x.msg, x.idx, messages)
                      );
                    },
                  )
                  .map(({ msg, idx }) => (
                  <Box
                    key={msg.id}
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                      width: '100%',
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        mt: 0.25,
                        bgcolor: msg.role === 'user' ? 'primary.main' : 'primary.dark',
                        fontSize: 13,
                        fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(15,23,42,0.12)',
                      }}
                    >
                      {msg.role === 'user' ? (
                        t('agentDetail.user').slice(0, 1)
                      ) : (
                        <SmartToyIcon sx={{ fontSize: 20 }} />
                      )}
                    </Avatar>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minWidth: 0,
                        maxWidth:
                          msg.role === 'user'
                            ? CHAT_USER_MESSAGE_COLUMN_MAX_WIDTH
                            : CHAT_ASSISTANT_MESSAGE_COLUMN_MAX_WIDTH,
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {formatMessageClock(msg.created_at) ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, px: 0.25, lineHeight: 1.2 }}
                        >
                          {formatMessageClock(msg.created_at)}
                        </Typography>
                      ) : null}
                      <Paper
                      elevation={0}
                      sx={{
                        p: 2,
                        width: '100%',
                        bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                        color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                        borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        border: msg.role === 'assistant' ? '1px solid' : 'none',
                        borderColor: 'divider',
                        boxShadow: (t) =>
                          msg.role === 'user'
                            ? `0 4px 18px ${alpha(t.palette.primary.main, 0.35)}`
                            : `0 4px 20px ${alpha(t.palette.common.black, 0.35)}`,
                        backdropFilter: msg.role === 'assistant' ? 'blur(8px)' : 'none',
                      }}
                    >
                      {msg.image_urls && msg.image_urls.filter((u) => u && String(u).trim()).length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                          {msg.image_urls.filter((u) => u && String(u).trim()).map((url, idx) => {
                            const src = resolveChatAttachmentUrl(url);
                            return (
                              <Box
                                key={idx}
                                component="img"
                                src={src}
                                alt=""
                                onClick={() => setImageLightboxSrc(src)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setImageLightboxSrc(src);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                sx={{
                                  display: 'block',
                                  maxWidth: 'min(100%, 220px)',
                                  maxHeight: 140,
                                  width: 'auto',
                                  height: 'auto',
                                  objectFit: 'contain',
                                  borderRadius: 1.5,
                                  cursor: 'zoom-in',
                                }}
                              />
                            );
                          })}
                        </Box>
                      )}
                      {msg.file_urls && msg.file_urls.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                          {msg.file_urls.map((url, idx) => (
                            <Chip
                              key={idx}
                              label={url.split('/').pop()}
                              size="small"
                              variant="outlined"
                              sx={{
                                bgcolor: msg.role === 'user' ? 'rgba(0,0,0,0.12)' : 'background.paper',
                                borderColor: msg.role === 'user' ? 'rgba(255,255,255,0.35)' : 'divider',
                              }}
                            />
                          ))}
                        </Box>
                      )}
                      {msg.role === 'assistant' &&
                        (() => {
                          const planFromHistory = getPlanExecuteTasksFromReactSteps(msg.react_steps);
                          const showPlanCard =
                            shouldRenderPlanCardForAssistantMessage(msg, idx, messages) &&
                            !(streaming && (planExecuteTasks?.length ?? 0) > 0);
                          const hideAssistantMarkdown =
                            isGenericStreamFailureText(msg.content) && planFromHistory.length > 0;
                          return (
                            <>
                              {showPlanCard && planFromHistory.length > 0 && (
                                <Box sx={{ mb: 1.5, width: '100%' }}>
                                  <PlanExecuteTaskPanel
                                    tasks={planFromHistory}
                                    title={t('agentDetail.planExecuteTaskList')}
                                  />
                                </Box>
                              )}
                              {!hideAssistantMarkdown ? (
                                <Box sx={markdownBoxSx({ userBubble: false })}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                </Box>
                              ) : null}
                            </>
                          );
                        })()}
                      {msg.role === 'user' ? (
                        <Box sx={markdownBoxSx({ userBubble: true })}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {userMessageTextToDisplay(msg, t)}
                          </ReactMarkdown>
                        </Box>
                      ) : null}
                    </Paper>
                    </Box>
                  </Box>
                ))}

                {clientToolPhase && (
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      width: '100%',
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        mt: 0.25,
                        bgcolor: 'primary.dark',
                        fontSize: 12,
                        fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(15,23,42,0.12)',
                      }}
                    >
                      <SmartToyIcon sx={{ fontSize: 20 }} />
                    </Avatar>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minWidth: 0,
                        maxWidth: CHAT_ASSISTANT_MESSAGE_COLUMN_MAX_WIDTH,
                        alignItems: 'flex-start',
                      }}
                    >
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          width: '100%',
                          bgcolor: 'background.paper',
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: '18px 18px 18px 4px',
                          boxShadow: (t) => `0 4px 22px ${alpha(t.palette.common.black, 0.35)}`,
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <ClientToolIndicator
                          kind="system"
                          label={t('agentDetail.localToolRunning')}
                          toolName={clientToolName}
                          detail={clientToolDetail || undefined}
                        />
                      </Paper>
                    </Box>
                  </Box>
                )}

                {streaming && (
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      width: '100%',
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 36,
                        height: 36,
                        mt: 0.25,
                        bgcolor: 'primary.dark',
                        fontSize: 12,
                        fontWeight: 700,
                        boxShadow: '0 2px 8px rgba(15,23,42,0.12)',
                      }}
                    >
                      <SmartToyIcon sx={{ fontSize: 20 }} />
                    </Avatar>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minWidth: 0,
                        maxWidth: CHAT_ASSISTANT_MESSAGE_COLUMN_MAX_WIDTH,
                        alignItems: 'flex-start',
                      }}
                    >
                      {streamReplyStartedAt ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mb: 0.5, px: 0.25, lineHeight: 1.2 }}
                        >
                          {formatMessageClock(streamReplyStartedAt)}
                        </Typography>
                      ) : null}
                      {planExecuteTasks && planExecuteTasks.length > 0 && (
                        <PlanExecuteTaskPanel tasks={planExecuteTasks} title={t('agentDetail.planExecuteTaskList')} />
                      )}
                      <Paper
                      elevation={0}
                      sx={{
                        p: 2,
                        width: '100%',
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: '18px 18px 18px 4px',
                        boxShadow: (t) => `0 4px 22px ${alpha(t.palette.common.black, 0.35)}`,
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      {(() => {
                        const effectiveStream =
                          streaming && isGenericStreamFailureText(streamContent.trim())
                            ? ''
                            : streamContent;
                        return !effectiveStream.trim() ? (
                          <TypingIndicator />
                        ) : (
                          <>
                            <Box sx={markdownBoxSx({ userBubble: false })}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{effectiveStream}</ReactMarkdown>
                            </Box>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mt: 1.5,
                                pt: 1.5,
                                borderTop: '1px dashed',
                                borderColor: 'divider',
                              }}
                            >
                              <CircularProgress size={14} thickness={5} />
                              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                                {t('agentDetail.generating')}
                              </Typography>
                            </Box>
                          </>
                        );
                      })()}
                    </Paper>
                    </Box>
                  </Box>
                )}
              </>
            )}

          </Box>

          <Box
            sx={{
              flexShrink: 0,
              px: { xs: 2, sm: 3 },
              pb: 2.5,
              pt: 1,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: (t) => alpha(t.palette.background.paper, 0.92),
            }}
          >
            <Box
              sx={{
                width: '100%',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              {approvalPending && (
                <Alert
                  severity="info"
                  action={
                    <Button
                      component={RouterLink}
                      to="/approvals"
                      size="small"
                      color="inherit"
                      sx={{ textTransform: 'none' }}
                    >
                      {t('agentDetail.openApprovalsPage')}
                    </Button>
                  }
                >
                  {t('agentDetail.approvalPendingBanner', {
                    tool: approvalPending.toolName,
                    id: approvalPending.approvalId,
                  })}
                </Alert>
              )}
              {(pendingImages.length > 0 || pendingFiles.length > 0) && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  {pendingImages.map((item, index) => (
                    <Chip
                      key={`img-${index}`}
                      icon={
                        <Box
                          component="img"
                          src={item.preview}
                          alt=""
                          onClick={(e) => {
                            e.stopPropagation();
                            setImageLightboxSrc(item.preview);
                          }}
                          sx={{
                            width: 22,
                            height: 22,
                            objectFit: 'cover',
                            borderRadius: 0.5,
                            ml: -0.25,
                            cursor: 'zoom-in',
                          }}
                        />
                      }
                      label={item.file.name || t('agentDetail.uploadImage')}
                      size="small"
                      onDelete={() => handleRemovePendingImage(index)}
                      sx={{
                        maxWidth: 260,
                        bgcolor: 'action.hover',
                        border: '1px solid',
                        borderColor: 'divider',
                        '& .MuiChip-icon': { ml: 0.5 },
                      }}
                    />
                  ))}
                  {pendingFiles.map((item, index) => (
                    <Chip
                      key={`f-${index}`}
                      label={`${item.file.name}${item.file.size > 0 ? ` · ${formatPendingFileSize(item.file.size)}` : ''}`}
                      size="small"
                      onDelete={() => handleRemovePendingFile(index)}
                      sx={{
                        maxWidth: 260,
                        bgcolor: 'action.hover',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    />
                  ))}
                </Box>
              )}

              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  alignItems: 'center',
                  bgcolor: (t) => alpha(t.palette.background.default, 0.85),
                  borderRadius: 2.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  p: 1,
                  pl: 0.5,
                  boxShadow: `inset 0 1px 0 ${alpha('#fff', 0.04)}`,
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  '&:focus-within': {
                    borderColor: 'primary.main',
                    boxShadow: (t) =>
                      `0 0 0 1px ${alpha(t.palette.primary.main, 0.45)}, 0 0 20px ${alpha(t.palette.primary.main, 0.12)}`,
                  },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    pl: 0.5,
                  }}
                >
                  <Tooltip title={t('agentDetail.uploadImage')}>
                    <IconButton
                      size="small"
                      onClick={() => void openImagePicker()}
                      sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'primary.main' } }}
                    >
                      <ImageIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('agentDetail.uploadFile')}>
                    <IconButton
                      size="small"
                      onClick={() => void openFilePicker()}
                      sx={{ color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'primary.main' } }}
                    >
                      <AttachFileIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept={IMAGE_BUTTON_ACCEPT}
                    multiple
                    hidden
                    onChange={handleImageInputChange}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={DOCUMENT_BUTTON_ACCEPT}
                    multiple
                    hidden
                    onChange={handleGeneralFileInputChange}
                  />
                </Box>

                <TextField
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={8}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={t('agentDetail.typeMessage')}
                  disabled={streaming || !!clientToolPhase}
                  variant="standard"
                  sx={{ flex: 1, minWidth: 0 }}
                  InputProps={{
                    disableUnderline: true,
                    sx: {
                      alignItems: 'flex-start',
                      py: 0,
                      '& .MuiInputBase-input': {
                        px: 1,
                        py: 0.75,
                        fontSize: '0.9375rem',
                        lineHeight: 1.5,
                        verticalAlign: 'top',
                        '&::placeholder': {
                          color: 'text.disabled',
                          opacity: 1,
                        },
                      },
                    },
                  }}
                />

                {streaming ? (
                  <Tooltip title={t('agentDetail.stopGeneratingHint')}>
                    <Button
                      variant="contained"
                      color="error"
                      size="medium"
                      onClick={() => void handleStop()}
                      startIcon={<StopIcon />}
                      sx={{
                        alignSelf: 'center',
                        flexShrink: 0,
                        textTransform: 'none',
                        fontWeight: 700,
                        px: 1.5,
                        boxShadow: (th) => `0 4px 14px ${alpha(th.palette.error.main, 0.35)}`,
                      }}
                    >
                      {t('agentDetail.stopGenerating')}
                    </Button>
                  </Tooltip>
                ) : (
                  <IconButton
                    color="primary"
                    onClick={handleSend}
                    disabled={
                      (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0) ||
                      loading ||
                      !!clientToolPhase
                    }
                    sx={{
                      alignSelf: 'center',
                      flexShrink: 0,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      width: 40,
                      height: 40,
                      boxShadow: (t) => `0 2px 12px ${alpha(t.palette.primary.main, 0.4)}`,
                      '&:hover': {
                        bgcolor: 'primary.dark',
                      },
                      '&.Mui-disabled': {
                        bgcolor: 'action.disabledBackground',
                        color: 'action.disabled',
                        boxShadow: 'none',
                      },
                    }}
                  >
                    <SendIcon />
                  </IconButton>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      <Dialog
        open={imageLightboxSrc !== null}
        onClose={() => setImageLightboxSrc(null)}
        maxWidth={false}
        fullWidth
        PaperProps={{ sx: { bgcolor: 'rgba(0,0,0,0.92)', m: 1, maxHeight: 'calc(100vh - 16px)' } }}
      >
        <DialogContent sx={{ p: 1, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <IconButton
            aria-label="close"
            onClick={() => setImageLightboxSrc(null)}
            sx={{ position: 'absolute', right: 4, top: 4, color: 'common.white', zIndex: 1 }}
          >
            <CloseIcon />
          </IconButton>
          {imageLightboxSrc ? (
            <Box
              component="img"
              src={imageLightboxSrc}
              alt=""
              sx={{ maxWidth: 'min(96vw, 1400px)', maxHeight: '88vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialog} onClose={() => setRenameDialog(false)}>
        <DialogTitle>{t('agentDetail.renameSession')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            label={t('agentDetail.sessionTitle')}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(false)}>{t('agentDetail.cancel')}</Button>
          <Button onClick={handleRenameSession} variant="contained">
            {t('agentDetail.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!confirmClientTool}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            dismissConfirmClientTool();
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('agentDetail.confirmLocalExecution')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('agentDetail.clientToolRiskLine', {
              tool: confirmClientTool?.tool_name ?? '',
              risk: confirmClientTool?.risk_level || 'medium',
            })}
            {confirmClientTool?.tool_name === 'builtin_docker_operator'
              ? t('agentDetail.dockerConfirmSuffix')
              : confirmClientTool?.tool_name === 'builtin_browser'
                ? t('agentDetail.browserConfirmSuffix')
                : t('agentDetail.pasteResultSuffix')}
          </Typography>
          {confirmClientTool?.hint && (
            <Typography variant="caption" color="text.secondary" display="block">
              {confirmClientTool.hint}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            {t('agentDetail.clientToolLocalVsApprovalHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={dismissConfirmClientTool}>{t('agentDetail.cancel')}</Button>
          <Button onClick={handleConfirmRiskyClientTool} variant="contained">
            {t('agentDetail.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!clientToolCall}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
            dismissPasteClientTool();
          }
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('agentDetail.clientToolPasteTitle', { tool: clientToolCall?.tool_name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {clientToolCall?.hint}
          </Typography>
          <Typography variant="caption" component="pre" sx={{ display: 'block', mb: 2, bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
            {JSON.stringify(clientToolCall?.params, null, 2)}
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            value={toolResult}
            onChange={(e) => setToolResult(e.target.value)}
            label={t('agentDetail.toolResultLabel')}
            placeholder={t('agentDetail.toolResultPlaceholder')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={dismissPasteClientTool}>{t('agentDetail.cancel')}</Button>
          <Button onClick={handleToolCallSubmit} variant="contained">
            {t('agentDetail.submitToolResult')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AgentDetailPage;