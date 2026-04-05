import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  clientToolNeedsConfirm,
  getApprovalStatus,
  getPendingApprovalBySession,
  createStreamingTypewriter,
  finalizeTypewriterAfterStream,
  type StreamingTypewriter,
} from '../api/chat';
import { TypingIndicator } from '../components/TypingIndicator';
import { ClientToolIndicator } from '../components/ClientToolIndicator';
import { useTranslation } from 'react-i18next';

const sessionRailWidth = 260;

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
  const [newSessionDialog, setNewSessionDialog] = useState(false);
  const [renameDialog, setRenameDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [clientToolCall, setClientToolCall] = useState<ClientToolCall | null>(null);
  const [confirmClientTool, setConfirmClientTool] = useState<ClientToolCall | null>(null);
  const [toolResult, setToolResult] = useState('');
  /** Local Tauri tool in progress — use dedicated UI, not TypingIndicator (model streaming). */
  const [clientToolPhase, setClientToolPhase] = useState<null | 'browser' | 'docker'>(null);
  const [approvalPending, setApprovalPending] = useState<{ approvalId: number; toolName: string } | null>(null);
  const [sessionRailOpen, setSessionRailOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  /** 首次发消息会 createSession → selectedSession 触发 useEffect 拉历史；新会话服务端仍为空会覆盖乐观插入。流结束 onDone 再拉全量。 */
  const deferMessagesFetchUntilStreamDoneRef = useRef<string | null>(null);
  const streamingSessionRef = useRef<string | null>(null);
  const streamTypewriterRef = useRef<StreamingTypewriter | null>(null);
  /** While true, typewriter uses small per-frame steps (matches web useChatPage during SSE). */
  const streamTypingActiveRef = useRef(false);
  const streamTypewriterOpts = useMemo(
    () => ({ streaming: () => streamTypingActiveRef.current }),
    [],
  );

  useEffect(() => {
    sessionIdRef.current = selectedSession?.session_id;
  }, [selectedSession]);

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadSessions();
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
    if (!selectedSession?.session_id || approvalPending) return;
    const checkPendingApproval = async () => {
      try {
        const pending = await getPendingApprovalBySession(selectedSession.session_id);
        if (pending) {
          setApprovalPending({ approvalId: pending.id, toolName: pending.tool_name });
        }
      } catch (err) {
        console.error('Failed to check pending approval:', err);
      }
    };
    checkPendingApproval();
  }, [selectedSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, streaming, clientToolPhase, approvalPending]);

  useEffect(() => {
    if (!approvalPending) return;
    const pollApproval = async () => {
      try {
        const status = await getApprovalStatus(approvalPending.approvalId);
        if (status.status === 'approved') {
          setApprovalPending(null);
          const sid = selectedSession?.session_id ?? sessionIdRef.current;
          if (sid) {
            setLoading(false);
            setStreaming(false);
            setStreamContent('');
            void loadMessages({ silent: true, sessionId: sid });
          }
        } else if (status.status === 'rejected') {
          setApprovalPending(null);
          setError(`审批被拒绝: ${status.comment || ''}`);
        } else if (status.status === 'expired') {
          setApprovalPending(null);
          setError('审批已过期，请重新发起请求');
        }
      } catch (err) {
        console.error('Failed to poll approval status:', err);
      }
    };
    const interval = setInterval(pollApproval, 20000);
    return () => clearInterval(interval);
  }, [approvalPending]);

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
      setMessages(data);
    } catch {
      setError('Failed to load messages');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleClientToolIncoming = (call: ClientToolCall): void => {
    const sid = selectedSession?.session_id ?? sessionIdRef.current;
    if (!sid?.trim() || !call.call_id?.trim()) return;
    setStreaming(false);
    streamTypingActiveRef.current = false;
    setLoading(false);
    setClientToolPhase(null);
    streamTypewriterRef.current?.reset();
    streamTypewriterRef.current = null;
    setStreamContent('');
    streamingSessionRef.current = null;
    const needsConfirm = clientToolNeedsConfirm(call.risk_level, call.execution_mode);
    console.log('[DEBUG] handleClientToolIncoming:', { call, needsConfirm });

    const runDockerWithTauri = (): void => {
      void (async () => {
        setClientToolPhase('docker');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const out = await invoke<string>('run_client_docker_operator', { params: call.params });
          setClientToolPhase(null);
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
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setError(e.message);
            },
            handleClientToolIncoming,
          );
        } catch (e) {
          setClientToolPhase(null);
          console.error('[ChatPage] run_client_docker_operator failed', e);
          setError(e instanceof Error ? e.message : String(e));
          setClientToolCall(call);
          setToolResult('');
        }
      })();
    };

    const runBrowserWithTauri = (): void => {
      void (async () => {
        setClientToolPhase('browser');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const out = await invoke<string>('run_client_browser', { params: call.params });
          setClientToolPhase(null);
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
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setError(e.message);
            },
            handleClientToolIncoming,
          );
        } catch (e) {
          setClientToolPhase(null);
          console.error('[ChatPage] run_client_browser failed', e);
          setError(e instanceof Error ? e.message : String(e));
          setClientToolCall(call);
          setToolResult('');
        }
      })();
    };

    if (call.tool_name === 'builtin_docker_operator') {
      if (needsConfirm) {
        setConfirmClientTool(call);
        return;
      }
      runDockerWithTauri();
      return;
    }

    if (call.tool_name === 'builtin_browser') {
      if (needsConfirm) {
        setConfirmClientTool(call);
        return;
      }
      runBrowserWithTauri();
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

    if (call.tool_name === 'builtin_docker_operator') {
      void (async () => {
        setClientToolPhase('docker');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const out = await invoke<string>('run_client_docker_operator', { params: call.params });
          setClientToolPhase(null);
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
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setError(e.message);
            },
            handleClientToolIncoming,
          );
        } catch (e) {
          setClientToolPhase(null);
          console.error('[ChatPage] run_client_docker_operator failed', e);
          setClientToolCall(call);
          setToolResult('');
        }
      })();
    } else if (call.tool_name === 'builtin_browser') {
      void (async () => {
        setClientToolPhase('browser');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const out = await invoke<string>('run_client_browser', { params: call.params });
          setClientToolPhase(null);
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
                if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
              });
            },
            (e) => {
              streamTypingActiveRef.current = false;
              streamTypewriterRef.current?.reset();
              streamTypewriterRef.current = null;
              setStreaming(false);
              setClientToolPhase(null);
              setError(e.message);
            },
            handleClientToolIncoming,
          );
        } catch (e) {
          setClientToolPhase(null);
          console.error('[ChatPage] run_client_browser failed', e);
          setClientToolCall(call);
          setToolResult('');
        }
      })();
    } else {
      setClientToolCall(call);
      setToolResult('');
    }
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
      streamChatMessage(
        { agent_id: selectedAgent.id, message: userMessage, session_id: currentSessionId },
        (content) => {
          streamTypewriterRef.current?.push(content);
        },
        (sessionId) => {
          const sid = sessionId || streamingSessionRef.current || undefined;
          streamingSessionRef.current = null;
          finalizeTypewriterAfterStream(streamTypewriterRef, streamTypingActiveRef, () => {
            setStreaming(false);
            setLoading(false);
            setStreamContent('');
            if (sid) {
              if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
                deferMessagesFetchUntilStreamDoneRef.current = null;
              }
              void loadMessages({ silent: true, sessionId: sid });
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
          setError(err.message);
          if (sid) {
            if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
              deferMessagesFetchUntilStreamDoneRef.current = null;
            }
            void loadMessages({ silent: true, sessionId: sid });
          }
        },
        handleClientToolIncoming,
        (approvalId, toolName) => {
          setApprovalPending({ approvalId, toolName });
        },
      );
    } catch (err: any) {
      const sid = streamingSessionRef.current ?? undefined;
      streamingSessionRef.current = null;
      streamTypingActiveRef.current = false;
      streamTypewriterRef.current?.reset();
      streamTypewriterRef.current = null;
      setStreaming(false);
      setLoading(false);
      if (sid) {
        if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
          deferMessagesFetchUntilStreamDoneRef.current = null;
        }
        void loadMessages({ silent: true, sessionId: sid });
      }
      setError(err.message);
    }
  };

  const handleStop = async () => {
    const sid = streamingSessionRef.current ?? selectedSession?.session_id;
    try {
      if (sid) {
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
      if (sid) {
        if (deferMessagesFetchUntilStreamDoneRef.current === sid) {
          deferMessagesFetchUntilStreamDoneRef.current = null;
        }
        void loadMessages({ silent: true, sessionId: sid });
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
          if (doneSid) flushMessagesAfterToolResult(loadMessages, doneSid);
        });
      },
      (e) => {
        streamTypingActiveRef.current = false;
        streamTypewriterRef.current?.reset();
        streamTypewriterRef.current = null;
        setStreaming(false);
        setLoading(false);
        setError(e.message);
      },
      handleClientToolIncoming,
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

          <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
            {messages.map((msg) => (
              <Paper
                key={msg.id}
                elevation={0}
                sx={{
                  p: 2,
                  mb: 2,
                  maxWidth: '80%',
                  ml: msg.role === 'user' ? 'auto' : 0,
                  mr: msg.role === 'user' ? 0 : 'auto',
                  bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                  color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </Typography>
              </Paper>
            ))}

            {clientToolPhase && (
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  mb: 2,
                  maxWidth: '80%',
                  mr: 'auto',
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <ClientToolIndicator
                  kind={clientToolPhase}
                  label={
                    clientToolPhase === 'browser'
                      ? t('agentDetail.localToolBrowserRunning')
                      : t('agentDetail.localToolDockerRunning')
                  }
                />
              </Paper>
            )}

            {streaming && (
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  mb: 2,
                  maxWidth: '80%',
                  mr: 'auto',
                  bgcolor: 'background.paper',
                }}
              >
                {!streamContent.trim() ? (
                  <TypingIndicator />
                ) : (
                  <>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                      {streamContent}
                    </Typography>
                    <CircularProgress size={16} sx={{ mt: 1 }} />
                  </>
                )}
              </Paper>
            )}

            {!messages.length && !streaming && !clientToolPhase && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Typography color="text.secondary">
                  Select an agent and start a conversation
                </Typography>
              </Box>
            )}

            <div ref={messagesEndRef} />
          </Box>

          {approvalPending && (
            <Alert severity="info" sx={{ m: 2 }}>
              正在审批中，请稍候... (工具: {approvalPending.toolName}, 审批ID: {approvalPending.approvalId})
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

      <Dialog open={!!confirmClientTool} onClose={() => setConfirmClientTool(null)} maxWidth="sm" fullWidth>
        <DialogTitle>确认本地执行</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            工具 <strong>{confirmClientTool?.tool_name}</strong> 的风险级别为{' '}
            <strong>{confirmClientTool?.risk_level || 'medium'}</strong>
            {confirmClientTool?.tool_name === 'builtin_docker_operator'
              ? '，确认后将在本机执行 docker（白名单只读操作）。'
              : confirmClientTool?.tool_name === 'builtin_browser'
                ? '，确认后将在本机连接并驱动可见的 Chrome/Chromium 窗口执行自动化。'
                : '，确认后请在下个对话框中粘贴本地执行结果。'}
          </Typography>
          {confirmClientTool?.hint && (
            <Typography variant="caption" color="text.secondary" display="block">
              {confirmClientTool.hint}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClientTool(null)}>取消</Button>
          <Button onClick={handleConfirmRiskyClientTool} variant="contained">
            确认
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!clientToolCall} onClose={() => setClientToolCall(null)} maxWidth="md" fullWidth>
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
          <Button onClick={() => setClientToolCall(null)}>Cancel</Button>
          <Button onClick={handleToolCallSubmit} variant="contained">
            Submit Result
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChatPage;
