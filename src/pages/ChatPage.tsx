import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  IconButton,
  TextField,
  Button,
  Paper,
  CircularProgress,
  Divider,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import type { Agent, ChatSession, ChatHistoryMessage, ClientToolCall } from '../types';
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
  getApprovalStatus,
  getPendingApprovalBySession,
  reconcileDeferredApprovalsFromStorage,
  saveApprovalDeferredCall,
  loadApprovalDeferredCall,
  clearApprovalDeferredCall,
  createStreamingTypewriter,
  finalizeTypewriterAfterStream,
  type StreamingTypewriter,
  type ReActEvent,
} from '../api/chat';
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
import { userMessageTextToDisplay } from '../utils/chatMessageDisplay';
import {
  isGenericStreamFailureText,
  shouldHideSupersededPlanAssistantBubble,
  shouldRenderPlanCardForAssistantMessage,
  shouldHideAssistantBubbleForGenericFailure,
} from '../utils/chatStreamDisplay';
import { getPlanExecuteTasksFromReactSteps } from '../utils/hydrateReactStepsPlan';
import { finalizeStoppedPlanMessages } from '../utils/finalizeStoppedPlan';
import { markRunningPlanTasksError } from '../utils/planExecuteMerge';
import { resolveChatAttachmentUrl } from '../api/config';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';

const sessionRailWidth = 260;
/** 桌面客户端主聊天：用户气泡单独略窄，助手不变 */
const CHAT_USER_BUBBLE_MAX_WIDTH = 'min(50%, 400px)';
const CHAT_ASSISTANT_BUBBLE_MAX_WIDTH = 'min(50%, 372px)';

const ChatPage: React.FC = () => {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [reactSteps, setReactSteps] = useState<ReActEvent[]>([]);
  const [reactStepsExpanded, setReactStepsExpanded] = useState(true);
  const [planExecuteTasks, setPlanExecuteTasks] = useState<PlanTaskRow[] | null>(null);
  const [newSessionDialog, setNewSessionDialog] = useState(false);
  const [renameDialog, setRenameDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [clientToolCall, setClientToolCall] = useState<ClientToolCall | null>(null);
  const [confirmClientTool, setConfirmClientTool] = useState<ClientToolCall | null>(null);
  const [toolResult, setToolResult] = useState('');
  /** Local Tauri tool in progress — use dedicated UI, not TypingIndicator (model streaming). */
  const [clientToolPhase, setClientToolPhase] = useState<null | 'system'>(null);
  const [clientToolName, setClientToolName] = useState<string>('');
  const [clientToolDetail, setClientToolDetail] = useState<string>('');
  const [approvalPending, setApprovalPending] = useState<{ approvalId: number; toolName: string } | null>(null);
  const handleApprovalPending = useCallback((approvalId: number, toolName: string) => {
    setApprovalPending({ approvalId, toolName });
  }, []);
  const [sessionRailOpen, setSessionRailOpen] = useState(true);
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const pendingClientToolAfterApprovalRef = useRef<ClientToolCall | null>(null);
  const handleClientToolIncomingRef = useRef<(call: ClientToolCall) => void>(() => {});
  const manuallyStoppedPlanSessionRef = useRef<string | null>(null);
  /** 首次发消息会 createSession → selectedSession 触发 useEffect 拉历史；新会话服务端仍为空会覆盖乐观插入。流结束 onDone 再拉全量。 */
  const deferMessagesFetchUntilStreamDoneRef = useRef<string | null>(null);
  const streamingSessionRef = useRef<string | null>(null);
  const streamTypewriterRef = useRef<StreamingTypewriter | null>(null);
  /** While true, typewriter uses small per-frame steps (matches web useChatPage during SSE). */
  const streamTypingActiveRef = useRef(false);
  /** True after SSE `client_tool_call` for this turn — next stream [DONE] must not wipe the plan checklist. */
  const planPauseForClientToolRef = useRef(false);
  const streamTypewriterOpts = useMemo(
    () => ({ streaming: () => streamTypingActiveRef.current }),
    [],
  );

  useEffect(() => {
    sessionIdRef.current = selectedSession?.session_id;
  }, [selectedSession]);

  useEffect(() => {
    void loadAgents();
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      void loadSessions();
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedSession) return;
    if (deferMessagesFetchUntilStreamDoneRef.current === selectedSession.session_id) {
      return;
    }
    void loadMessages();
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
      } catch (err) {
        console.error('Failed to sync deferred approvals:', err);
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

  useChatScrollToBottom(
    chatScrollContainerRef,
    [
      messages,
      streamContent,
      streaming,
      clientToolPhase,
      approvalPending,
      planExecuteTasks,
      reactSteps,
      reactStepsExpanded,
    ],
    'ChatPage',
    () => ({
      messagesLen: messages.length,
      streamLen: streamContent.length,
      planLen: planExecuteTasks?.length ?? 0,
      reactStepsLen: reactSteps.length,
      reactStepsExpanded,
    }),
  );

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
            void loadMessages({ silent: true, sessionId: sid });
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
      } catch (err) {
        console.error('Failed to poll approval status:', err);
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

  const loadAgents = async () => {
    try {
      const data = await listAgents();
      setAgents(data);
      if (data.length > 0 && !selectedAgent) {
        setSelectedAgent(data[0]);
      }
    } catch (err: any) {
      setError('Failed to load agents');
    }
  };

  const loadSessions = async () => {
    if (!selectedAgent) return;
    try {
      const data = await listSessions(selectedAgent.id);
      setSessions(data);
    } catch {
      setError('Failed to load sessions');
    }
  };

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
      setError('Failed to load messages');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const mergeStreamReActEvent = useCallback((event: ReActEvent) => {
    if (!event) return;
    setPlanExecuteTasks((prev) => applyPlanReActEventToRows(prev, event));
    if (event.type === 'plan_tasks' || event.type === 'plan_step') {
      return;
    }
    if (
      event.type === 'thought' ||
      event.type === 'action' ||
      event.type === 'observation' ||
      event.type === 'reflection'
    ) {
      setReactSteps((prev) => [...prev, event]);
    } else if (event.type === 'final_answer') {
      setReactSteps([]);
    }
  }, []);

  /** Call when any chat/tool_result SSE finishes with [DONE]. Preserves plan rows if stream paused for client tool. */
  const clearPlanAfterStreamFinish = useCallback(() => {
    if (!planPauseForClientToolRef.current) {
      setPlanExecuteTasks(null);
    } else {
      planPauseForClientToolRef.current = false;
    }
  }, []);

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
    streamTypingActiveRef.current = false;
    setLoading(false);
    setClientToolPhase(null);
    setClientToolName('');
    setClientToolDetail('');
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = null;
    setStreamContent('');
    streamingSessionRef.current = null;
    const needsConfirm =
      !call.skip_local_confirm && clientToolNeedsConfirm(call.risk_level, call.execution_mode);
    if (import.meta.env.DEV) {
      console.debug('[handleClientToolIncoming]', { call, needsConfirm });
    }

    const runBuiltinClientTool = (toolName: string): void => {
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
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
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
            mergeStreamReActEvent,
          );
        } catch (e) {
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          const toolFailMsg = e instanceof Error ? e.message : String(e);
          console.error(`[ChatPage] builtin client tool failed: ${toolName}`, e);
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
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
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
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
              setError(err.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            mergeStreamReActEvent,
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
      setError('Missing session or tool call id. Try sending a message again.');
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
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
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
            mergeStreamReActEvent,
          );
        } catch (e) {
          setClientToolPhase(null);
          setClientToolName('');
          setClientToolDetail('');
          const toolFailMsg = e instanceof Error ? e.message : String(e);
          console.error(`[ChatPage] confirm builtin client tool failed: ${toolName}`, e);
          setStreaming(true);
          streamTypingActiveRef.current = true;
          streamTypewriterRef.current?.reset();
          streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
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
                clearPlanAfterStreamFinish();
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
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
              setError(err.message);
            },
            handleClientToolIncoming,
            handleApprovalPending,
            mergeStreamReActEvent,
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
          planPauseForClientToolRef.current = false;
          if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
        });
      },
      (e) => {
        streamTypingActiveRef.current = false;
        streamTypewriterRef.current?.reset();
        streamTypewriterRef.current = null;
        setStreaming(false);
        setStreamContent('');
        setError(e.message);
      },
      handleClientToolIncoming,
      handleApprovalPending,
      mergeStreamReActEvent,
    );
  };

  const dismissConfirmClientTool = (): void => {
    const call = confirmClientTool;
    setConfirmClientTool(null);
    submitClientToolCancelled(call);
  };

  const dismissPasteClientTool = (): void => {
    const call = clientToolCall;
    setClientToolCall(null);
    setToolResult('');
    submitClientToolCancelled(call);
  };

  const handleNewSession = async () => {
    if (!selectedAgent) return;
    try {
      const session = await createSession(selectedAgent.id);
      setSessions((prev) => [session, ...prev]);
      setSelectedSession(session);
      setMessages([]);
      setNewSessionDialog(false);
    } catch {
      setError('Failed to create session');
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
      setError('Failed to delete session');
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
      setError('Failed to rename session');
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedAgent || streaming || clientToolPhase) return;

    const userMessage = input.trim();
    setInput('');
    setError('');
    manuallyStoppedPlanSessionRef.current = null;
    planPauseForClientToolRef.current = false;
    setPlanExecuteTasks(null);

    let currentSessionId = selectedSession?.session_id;

    if (!currentSessionId) {
      try {
        const session = await createSession(selectedAgent.id);
        deferMessagesFetchUntilStreamDoneRef.current = session.session_id;
        setSessions((prev) => [session, ...prev]);
        setSelectedSession(session);
        currentSessionId = session.session_id;
        sessionIdRef.current = currentSessionId;
      } catch {
        setError('Failed to create session');
        return;
      }
    } else {
      sessionIdRef.current = currentSessionId;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: 'user',
        content: userMessage,
        image_urls: [],
        file_urls: [],
        created_at: new Date().toISOString(),
      },
    ]);

    setLoading(true);
    setStreaming(true);
    streamTypingActiveRef.current = true;
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
    streamingSessionRef.current = currentSessionId;

    try {
      await loadClientModeTools();
      streamChatMessage(
        { agent_id: selectedAgent.id, message: userMessage, session_id: currentSessionId },
        (content) => {
          streamTypewriterRef.current?.push(content);
        },
        mergeStreamReActEvent,
        (sessionId) => {
          const sid = sessionId || streamingSessionRef.current || undefined;
          streamingSessionRef.current = null;
          finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
            setStreaming(false);
            setLoading(false);
            setStreamContent('');
            setReactSteps([]);
            clearPlanAfterStreamFinish();
            if (sid) {
              if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
                deferMessagesFetchUntilStreamDoneRef.current = null;
              }
              flushMessagesAfterChatStream(loadMessages, sid);
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
          planPauseForClientToolRef.current = false;
          setPlanExecuteTasks(null);
          setError(err?.message || String(err));
          if (sid) {
            if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
              deferMessagesFetchUntilStreamDoneRef.current = null;
            }
            flushMessagesAfterChatStream(loadMessages, sid);
          }
        },
        handleClientToolIncoming,
        handleApprovalPending,
      );
    } catch (err: any) {
      const sid = streamingSessionRef.current ?? undefined;
      streamingSessionRef.current = null;
      streamTypingActiveRef.current = false;
      streamTypewriterRef.current?.reset();
      streamTypewriterRef.current = null;
      setStreaming(false);
      setLoading(false);
      planPauseForClientToolRef.current = false;
      setPlanExecuteTasks(null);
      if (sid) {
        if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
          deferMessagesFetchUntilStreamDoneRef.current = null;
        }
        flushMessagesAfterChatStream(loadMessages, sid);
      }
      setError(err.message);
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
      planPauseForClientToolRef.current = false;
      setPlanExecuteTasks(null);
      if (sid) {
        if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
          deferMessagesFetchUntilStreamDoneRef.current = null;
        }
        flushMessagesAfterChatStream(loadMessages, sid);
      }
    }
  };

  const handleToolCallSubmit = (): void => {
    if (!clientToolCall || !selectedSession) return;
    const call = clientToolCall;
    const sid = selectedSession.session_id;
    const result = toolResult;
    setClientToolCall(null);
    setToolResult('');
    setStreaming(true);
    streamTypingActiveRef.current = true;
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = createStreamingTypewriter(setStreamContent, streamTypewriterOpts);
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
          clearPlanAfterStreamFinish();
          if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
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
      mergeStreamReActEvent,
    );
  };

  handleClientToolIncomingRef.current = handleClientToolIncoming;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    onChatInputEnterToSend(e, handleSend);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton size="small" onClick={() => setSessionRailOpen(!sessionRailOpen)}>
          {sessionRailOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Agent</InputLabel>
          <Select
            value={selectedAgent?.id || ''}
            label="Agent"
            onChange={(e) => {
              const agent = agents.find((a) => a.id === e.target.value);
              if (agent) {
                setSelectedAgent(agent);
                setSelectedSession(null);
                setMessages([]);
              }
            }}
          >
            {agents.map((agent) => (
              <MenuItem key={agent.id} value={agent.id}>
                {agent.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setNewSessionDialog(true)}
          disabled={!selectedAgent}
        >
          New Session
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sessionRailOpen && (
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
                position: 'relative',
                height: 'auto',
              },
            }}
          >
            <Box sx={{ p: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                Session History
              </Typography>
            </Box>
            <Divider />
            <List sx={{ flex: 1, overflow: 'auto' }}>
              {sessions.map((session) => (
                <ListItem
                  key={session.session_id}
                  disablePadding
                  secondaryAction={
                    <Box>
                      <Tooltip title="Rename">
                        <IconButton
                          size="small"
                          edge="end"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSession(session);
                            setNewTitle(session.title);
                            setRenameDialog(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          edge="end"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.session_id);
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                >
                  <ListItemButton
                    selected={selectedSession?.session_id === session.session_id}
                    onClick={() => setSelectedSession(session)}
                  >
                    <ListItemText
                      primary={session.title || 'New Chat'}
                      secondary={new Date(session.created_at).toLocaleDateString()}
                      primaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
              {sessions.length === 0 && (
                <ListItem>
                  <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>
                    No sessions yet
                  </Typography>
                </ListItem>
              )}
            </List>
          </Drawer>
        )}

        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {error && (
            <Alert severity="error" sx={{ m: 1 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {/* ReAct 推理步骤显示 - 可折叠 */}
          {reactSteps.length > 0 && (
            <Paper
              elevation={0}
              sx={{ mb: 2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}
            >
              <Box
                sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setReactStepsExpanded(!reactStepsExpanded)}
              >
                <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }}>
                  🤖 Thinking ({reactSteps.length} steps)
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {reactStepsExpanded ? '▼' : '▶'}
                </Typography>
              </Box>
              {reactStepsExpanded && (
                <Box sx={{ mt: 1, maxHeight: 300, overflow: 'auto' }}>
                  {reactSteps.map((step, idx) => (
                    <Box key={idx} sx={{ mb: 1, pl: 1, borderLeft: '2px solid', borderColor: step.type === 'action' ? 'primary.main' : step.type === 'observation' ? 'success.main' : 'grey.400' }}>
                      <Typography variant="caption" sx={{ fontWeight: 500, color: step.type === 'action' ? 'primary.main' : step.type === 'observation' ? 'success.main' : 'text.secondary' }}>
                        {step.type === 'thought' ? '💭' : step.type === 'action' ? '🔧' : step.type === 'observation' ? '📊' : '🔄'}
                        {step.step && `[${step.step}] `}{step.type}
                        {step.tool && ` (${step.tool})`}
                      </Typography>
                      <Typography variant="caption" component="pre" sx={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                        {step.content.length > 200 ? step.content.slice(0, 200) + '...' : step.content}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          )}

          <Box ref={chatScrollContainerRef} sx={{ flex: 1, overflow: 'auto', p: 2 }}>
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
              <Paper
                key={msg.id}
                elevation={0}
                sx={{
                  p: 2,
                  mb: 2,
                  maxWidth:
                    msg.role === 'user' ? CHAT_USER_BUBBLE_MAX_WIDTH : CHAT_ASSISTANT_BUBBLE_MAX_WIDTH,
                  ml: msg.role === 'user' ? 'auto' : 0,
                  mr: msg.role === 'user' ? 0 : 'auto',
                  bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                  color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                {msg.role === 'user' && msg.image_urls?.filter((u) => u && String(u).trim()).length ? (
                  <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                    {msg.image_urls.filter((u) => u && String(u).trim()).map((url, idx) => {
                      const src = resolveChatAttachmentUrl(url);
                      return (
                        <Box
                          key={idx}
                          component="img"
                          src={src}
                          alt=""
                          sx={{
                            display: 'block',
                            maxWidth: 'min(100%, 220px)',
                            maxHeight: 140,
                            objectFit: 'contain',
                            borderRadius: 1,
                          }}
                        />
                      );
                    })}
                  </Box>
                ) : null}
                {msg.role === 'user' && msg.file_urls && msg.file_urls.length > 0 ? (
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
                ) : null}
                {msg.role === 'assistant' ? (
                  <>
                    {(() => {
                      const planFromHistory = getPlanExecuteTasksFromReactSteps(msg.react_steps);
                      const showPlanCard =
                        shouldRenderPlanCardForAssistantMessage(msg, idx, messages) &&
                        !(streaming && (planExecuteTasks?.length ?? 0) > 0);
                      const hideAssistantText =
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
                          {!hideAssistantText ? (
                            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                              {msg.content}
                            </Typography>
                          ) : null}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                    {userMessageTextToDisplay(msg, t)}
                  </Typography>
                )}
              </Paper>
            ))}

            {clientToolPhase && (
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  mb: 2,
                  maxWidth: CHAT_ASSISTANT_BUBBLE_MAX_WIDTH,
                  mr: 'auto',
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <ClientToolIndicator
                  kind="system"
                  label={t('agentDetail.localToolRunning')}
                  toolName={clientToolName}
                  detail={clientToolDetail || undefined}
                />
              </Paper>
            )}

            {streaming && (
              <Box
                sx={{
                  mb: 2,
                  maxWidth: CHAT_ASSISTANT_BUBBLE_MAX_WIDTH,
                  mr: 'auto',
                  width: '100%',
                }}
              >
                {planExecuteTasks && planExecuteTasks.length > 0 && (
                  <PlanExecuteTaskPanel tasks={planExecuteTasks} title={t('agentDetail.planExecuteTaskList')} />
                )}
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    maxWidth: CHAT_ASSISTANT_BUBBLE_MAX_WIDTH,
                    mr: 'auto',
                    bgcolor: 'background.paper',
                  }}
                >
                  {(() => {
                    // 流式阶段若主文本仅为服务端占位「抱歉…」，用打字动画代替（含 ReAct 无 plan 时）；避免先闪错误再被成功回复顶掉。
                    const effectiveStream =
                      streaming && isGenericStreamFailureText(streamContent.trim())
                        ? ''
                        : streamContent;
                    return !effectiveStream.trim() ? (
                      <TypingIndicator />
                    ) : (
                      <>
                        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                          {effectiveStream}
                        </Typography>
                        <CircularProgress size={16} sx={{ mt: 1 }} />
                      </>
                    );
                  })()}
                </Paper>
              </Box>
            )}

            {!messages.length && !streaming && !clientToolPhase && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography color="text.secondary">
                  Select an agent and start a conversation
                </Typography>
              </Box>
            )}

          </Box>

          {approvalPending && (
            <Alert
              severity="info"
              sx={{ m: 2 }}
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

          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                multiline
                maxRows={4}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={streaming || !!clientToolPhase || !selectedAgent}
                size="small"
              />
              {streaming ? (
                <IconButton color="error" onClick={handleStop}>
                  <StopIcon />
                </IconButton>
              ) : (
                <IconButton
                  color="primary"
                  onClick={handleSend}
                  disabled={!input.trim() || loading || !!clientToolPhase || !selectedAgent}
                >
                  <SendIcon />
                </IconButton>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Dialog open={newSessionDialog} onClose={() => setNewSessionDialog(false)}>
        <DialogTitle>New Chat Session</DialogTitle>
        <DialogActions>
          <Button onClick={() => setNewSessionDialog(false)}>Cancel</Button>
          <Button onClick={handleNewSession} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={renameDialog} onClose={() => setRenameDialog(false)}>
        <DialogTitle>Rename Session</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            label="Session Title"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(false)}>Cancel</Button>
          <Button onClick={handleRenameSession} variant="contained">
            Save
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
        <DialogTitle>Client Tool Call: {clientToolCall?.tool_name}</DialogTitle>
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
            label="Tool Result"
            placeholder="Paste the result from local execution..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={dismissPasteClientTool}>Cancel</Button>
          <Button onClick={handleToolCallSubmit} variant="contained">
            Submit Result
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChatPage;
