import { unstable_batchedUpdates } from 'react-dom';
import { getApiUrl } from './config';
import { GENERIC_STREAM_FAILURE_ZH } from '../utils/chatStreamDisplay';
import type { ChatRequest, ChatResponse, ChatSession, ChatHistoryMessage, Agent, ClientToolCall } from '../types';

/** True only when assistant text is exactly the server placeholder line (not empty). */
function isExactGenericStreamFailureZh(s: string): boolean {
  const t = String(s ?? '')
    .replace(/\s+/g, '')
    .trim();
  if (t === '') return false;
  return t === GENERIC_STREAM_FAILURE_ZH.replace(/\s+/g, '');
}

/** AbortController for the active POST /chat/stream body reader (EventSource cannot do POST + Bearer). */
let currentStreamAbort: AbortController | null = null;

let clientModeToolsCache: Set<string> | null = null;

/** Clears the in-memory skill list so the next `loadClientModeTools` refetches `/skills`. */
export function invalidateClientModeToolsCache(): void {
  clientModeToolsCache = null;
}

export async function loadClientModeTools(): Promise<void> {
  if (clientModeToolsCache) return;
  try {
    const apiUrl = await getApiUrl();
    const response = await fetch(`${apiUrl}/skills`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
    });
    const json = await response.json();
    const skills = json.data || [];
    clientModeToolsCache = new Set(
      skills
        .filter((s: any) => s.execution_mode === 'client')
        .map((s: any) => s.key)
    );
  } catch {
    clientModeToolsCache = new Set();
  }
}

/** Refetch client-mode skill keys (e.g. after login or server URL / skill metadata changes). */
export async function reloadClientModeTools(): Promise<void> {
  invalidateClientModeToolsCache();
  await loadClientModeTools();
}

export function isClientModeTool(toolName: string): boolean {
  if (!clientModeToolsCache) {
    console.warn('[isClientModeTool] client mode tools not loaded yet');
    return false;
  }
  if (clientModeToolsCache.has(toolName)) {
    return true;
  }
  // /skills returns keys like builtin_skill.datetime; SSE tool_call uses builtin_datetime
  if (toolName.startsWith('builtin_') && !toolName.startsWith('builtin_skill.')) {
    const asSkillKey = `builtin_skill.${toolName.replace(/^builtin_/, '')}`;
    if (clientModeToolsCache.has(asSkillKey)) {
      return true;
    }
  }
  return false;
}

/**
 * Tauri / desktop: whether to show the local **risk confirmation** dialog before running a client tool.
 * - `low` → no dialog
 * - `medium` → show dialog (user taps OK on the device)
 * - `high` / `critical` → no dialog here; gating is **agent approval** (Approvals) only, not a second popup
 * `execution_mode === 'server'` → no desktop dialog (server-side path).
 */
export function clientToolNeedsConfirm(
  riskLevel: string | undefined,
  executionMode?: string,
): boolean {
  const m = (executionMode || '').trim().toLowerCase();
  if (m === 'server') {
    return false;
  }
  const r = (riskLevel || 'medium').toLowerCase();
  return r === 'medium';
}

/** Normalize ReAct SSE or service JSON into ClientToolCall. */
export function normalizeClientToolPayload(parsed: Record<string, unknown>): ClientToolCall {
  const callId = String(parsed.call_id ?? '');
  const toolName = String(parsed.tool_name ?? parsed.tool ?? '');
  let params: Record<string, unknown> = {};
  if (parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)) {
    params = parsed.params as Record<string, unknown>;
  } else if (typeof parsed.arguments === 'string' && parsed.arguments.trim()) {
    try {
      params = JSON.parse(parsed.arguments) as Record<string, unknown>;
    } catch {
      params = {};
    }
  }
  const riskLevel = typeof parsed.risk_level === 'string' ? parsed.risk_level : undefined;
  const executionMode = typeof parsed.execution_mode === 'string' ? parsed.execution_mode : undefined;
  let approvalId: number | undefined;
  const rawAid = parsed.approval_id;
  if (typeof rawAid === 'number' && Number.isFinite(rawAid)) {
    approvalId = rawAid;
  } else if (typeof rawAid === 'string' && /^\d+$/.test(rawAid.trim())) {
    approvalId = Number(rawAid.trim());
  }
  if (import.meta.env.DEV) {
    console.debug('[normalizeClientToolPayload]', { callId, toolName, riskLevel, executionMode, approvalId });
  }
  return {
    call_id: callId,
    tool_name: toolName,
    params,
    hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
    risk_level: riskLevel,
    execution_mode: executionMode,
    ...(approvalId != null && approvalId > 0 ? { approval_id: approvalId } : {}),
  };
}

export type StreamingTypewriter = {
  push: (fullAccumulated: string) => void;
  flush: () => void;
  reset: () => void;
  /**
   * After SSE ends, flip `streaming` to false (fast steps) and keep animating until displayed
   * catches `target` — mirrors useChatPage `thoughtStatus = completed` then tickTypewriter catch-up.
   */
  runCatchUpThen: (onComplete: () => void) => void;
};

/**
 * Call when the HTTP/SSE stream has finished successfully: turns off slow typewriter mode, runs
 * fast catch-up like Web, then resets the typewriter ref and runs `onComplete`.
 */
export function finalizeTypewriterAfterStream(
  twRef: { current: StreamingTypewriter | null },
  streamTypingActiveRef: { current: boolean },
  onComplete: () => void,
): void {
  streamTypingActiveRef.current = false;
  const tw = twRef.current;
  if (!tw) {
    onComplete();
    return;
  }
  tw.runCatchUpThen(() => {
    tw.reset();
    twRef.current = null;
    onComplete();
  });
}

export type CreateStreamingTypewriterOpts = {
  /**
   * While true, cap chars per frame so large SSE bursts still look like typing (align with web useChatPage).
   * When false, use faster catch-up. Default true.
   */
  streaming?: () => boolean;
};

/**
 * SSE `onChunk` passes the full accumulated assistant text each time; this helper reveals it
 * gradually so the UI gets a typewriter effect even when the network delivers large chunks at once.
 */
export function createStreamingTypewriter(
  setDisplayed: (s: string) => void,
  opts?: CreateStreamingTypewriterOpts,
): StreamingTypewriter {
  let target = '';
  let shown = '';
  let raf: number | null = null;
  let catchUpThen: (() => void) | null = null;

  const isStreamingMode = (): boolean => {
    if (opts?.streaming) return opts.streaming();
    return true;
  };

  const finishCatchUpIfDone = (): void => {
    if (shown.length < target.length) return;
    if (catchUpThen) {
      const cb = catchUpThen;
      catchUpThen = null;
      cb();
    }
  };

  const tick = (): void => {
    raf = null;
    if (shown.length >= target.length) {
      finishCatchUpIfDone();
      return;
    }
    const behind = target.length - shown.length;
    let step: number;
    if (isStreamingMode()) {
      // 与 Web useChatPage tickTypewriter（thoughtStatus === running）同一阶梯
      step = behind > 2400 ? 2 : 1;
    } else {
      step =
        behind > 500 ? 16 : behind > 200 ? 8 : behind > 60 ? 4 : behind > 15 ? 2 : 1;
    }
    shown = target.slice(0, shown.length + step);
    setDisplayed(shown);
    if (shown.length >= target.length) {
      finishCatchUpIfDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    push(fullAccumulated: string) {
      target = fullAccumulated;
      if (raf == null) raf = requestAnimationFrame(tick);
    },
    flush() {
      catchUpThen = null;
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      shown = target;
      setDisplayed(shown);
    },
    reset() {
      catchUpThen = null;
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      target = '';
      shown = '';
      setDisplayed('');
    },
    runCatchUpThen(onComplete: () => void) {
      catchUpThen = onComplete;
      if (shown.length >= target.length) {
        catchUpThen = null;
        onComplete();
        return;
      }
      if (raf == null) raf = requestAnimationFrame(tick);
    },
  };
}

/** Payload for SSE `plan_tasks` (plan-and-execute mode). */
export interface PlanTaskItemPayload {
  index: number;
  task: string;
}

export interface ReActEvent {
  type:
    | 'thought'
    | 'action'
    | 'observation'
    | 'reflection'
    | 'final_answer'
    | 'error'
    | 'plan_tasks'
    | 'plan_step';
  content: string;
  step?: number;
  tool?: string;
  /** Set on `plan_tasks` */
  plan_tasks?: PlanTaskItemPayload[];
  /** Set on `plan_step`: running → done | error */
  plan_step_status?: 'running' | 'done' | 'error';
}

/** Go `ReActEvent` uses JSON field `type`; ADK-style lines use `event_type`. Match web `chatParseStreamEvents.ts`. */
const REACT_SSE_KINDS = new Set([
  'thought',
  'action',
  'observation',
  'reflection',
  'final_answer',
  'error',
]);

function reactSseKind(parsed: Record<string, unknown>): string | null {
  const et = typeof parsed.event_type === 'string' ? parsed.event_type : '';
  if (et && REACT_SSE_KINDS.has(et)) return et;
  const t = typeof parsed.type === 'string' ? parsed.type : '';
  if (t && REACT_SSE_KINDS.has(t)) return t;
  return null;
}

function handleSseDataLine(
  data: string,
  opts: {
    onChunk: (content: string) => void;
    onReActEvent?: (event: ReActEvent) => void;
    onClientToolCall?: (call: ClientToolCall) => void;
    onApprovalPending?: (approvalId: number, toolName: string) => void;
    accumulatedRef: { value: string };
    /** e.g. `chat/stream` | `tool_result/stream` — desktop diagnostics */
    streamLogContext?: string;
  },
): void {
  if (data === '[DONE]') {
    return;
  }
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    // normalizeClientToolPayload 的 [DEBUG] 只在 client_tool_call 时触发；服务端工具走 event_type: tool_call | tool_result
    if (import.meta.env.DEV && typeof parsed.event_type === 'string') {
      console.debug('[chat/stream SSE]', parsed.event_type, parsed);
    }
    if (parsed.type === 'client_tool_call') {
      opts.onClientToolCall?.(normalizeClientToolPayload(parsed));
      return;
    }
    if (import.meta.env.DEV && typeof parsed.type === 'string' && parsed.type.length > 0) {
      const clen = typeof parsed.content === 'string' ? parsed.content.length : 0;
      console.debug('[sse frame]', parsed.type, 'contentChars=', clen);
    }
    if (parsed.event_type === 'tool_call') {
      const toolName = String(parsed.tool_name || '');
      if (isClientModeTool(toolName)) {
        console.warn('[chat/stream] client mode tool received on web, skipping:', toolName);
        return;
      }
    }
    if (parsed.event_type === 'tool_result') {
      const approvalId = parsed.approval_id as number | undefined;
      const approvalStatus = parsed.approval_status as string | undefined;
      if (approvalId && approvalStatus === 'pending') {
        opts.onApprovalPending?.(approvalId, String(parsed.tool_name || ''));
        return;
      }
    }
    // Plan-and-execute: structured task list for desktop checklist (not in REACT_SSE_KINDS token stream)
    if (parsed.type === 'plan_tasks' || parsed.type === 'plan_step') {
      const rawTasks = parsed.plan_tasks;
      let plan_tasks: PlanTaskItemPayload[] | undefined;
      if (Array.isArray(rawTasks)) {
        plan_tasks = rawTasks.map((r) => {
          const o = r as Record<string, unknown>;
          const ix = o.index;
          const idx = typeof ix === 'number' ? ix : Number(ix);
          return {
            index: Number.isFinite(idx) ? idx : 0,
            task: String(o.task ?? ''),
          };
        });
      }
      const pss = parsed.plan_step_status;
      const plan_step_status =
        pss === 'running' || pss === 'done' || pss === 'error' ? pss : undefined;
      opts.onReActEvent?.({
        type: parsed.type as 'plan_tasks' | 'plan_step',
        content: String(parsed.content ?? ''),
        step: typeof parsed.step === 'number' ? parsed.step : undefined,
        plan_tasks,
        plan_step_status,
      });
      return;
    }
    // ReAct: server sends `type` (Go ReActEvent) or `event_type` (some ADK payloads)
    const reactKind = reactSseKind(parsed);
    if (reactKind) {
      const reactEvent: ReActEvent = {
        type: reactKind as ReActEvent['type'],
        content: String(parsed.content || ''),
        step: parsed.step as number | undefined,
        tool: parsed.tool as string | undefined,
      };
      if (
        (reactKind === 'final_answer' || reactKind === 'error') &&
        isExactGenericStreamFailureZh(reactEvent.content)
      ) {
        console.warn(
          `[taskmate-desktop][${opts.streamLogContext ?? 'SSE'}] ReAct ${reactKind} 为服务端通用失败占位`,
          { step: reactEvent.step, preview: reactEvent.content.slice(0, 80) },
        );
      }
      opts.onReActEvent?.(reactEvent);
      return;
    }
    if (typeof parsed.content === 'string' && parsed.content) {
      opts.accumulatedRef.value += parsed.content;
      opts.onChunk(opts.accumulatedRef.value);
    }
  } catch {
    opts.accumulatedRef.value += data;
    opts.onChunk(opts.accumulatedRef.value);
  }
}

async function consumeEventStream(
  response: Response,
  opts: {
    onChunk: (content: string) => void;
    onReActEvent?: (event: ReActEvent) => void;
    onDone: () => void;
    onError: (e: Error) => void;
    onClientToolCall?: (call: ClientToolCall) => void;
    onApprovalPending?: (approvalId: number, toolName: string) => void;
    signal: AbortSignal;
    /** Desktop: label streams so logs show whether failure came from initial chat or tool_result resume. */
    streamLogContext?: string;
  },
): Promise<void> {
  const accumulatedRef = { value: '' };
  let sawDone = false;
  let buffer = '';
  let loggedGenericTokenPath = false;

  const ctx = opts.streamLogContext ?? 'SSE';

  /** ReAct `type` / plan_* counts — plain `content` token 不会进这里，故可与 accumulatedChars 对照 */
  const reactFrameCounts: Record<string, number> = {};
  let clientToolCallsInStream = 0;

  const onChunkForward = (full: string): void => {
    if (!loggedGenericTokenPath && isExactGenericStreamFailureZh(full)) {
      loggedGenericTokenPath = true;
      console.warn(`[taskmate-desktop][${ctx}] 主文本区出现通用失败占位 (content 累加路径)`, {
        chars: full.length,
      });
    }
    opts.onChunk(full);
  };

  const onReActWrapped = (evt: ReActEvent): void => {
    reactFrameCounts[evt.type] = (reactFrameCounts[evt.type] ?? 0) + 1;
    opts.onReActEvent?.(evt);
  };

  const onClientToolWrapped = (call: ClientToolCall): void => {
    clientToolCallsInStream += 1;
    opts.onClientToolCall?.(call);
  };

  const onDoneWithLog = (): void => {
    const acc = accumulatedRef.value;
    const hasReactOnly =
      acc.length === 0 && Object.keys(reactFrameCounts).length > 0;
    console.info(`[taskmate-desktop][${ctx}] 流结束`, {
      accumulatedChars: acc.length,
      isOnlyGenericFailure: isExactGenericStreamFailureZh(acc),
      preview: acc.length ? acc.slice(0, 200) : '(empty)',
      reactFrames: reactFrameCounts,
      clientToolCalls: clientToolCallsInStream,
      ...(hasReactOnly
        ? {
            note: '无 plain content 累加属正常：本段 SSE 只有 ReAct/工具帧（常见于暂停等客户端工具或紧接着下一轮 tool）',
          }
        : {}),
    });
    opts.onDone();
  };

  const handleDataLine = (line: string): void => {
    if (line === '[DONE]') {
      sawDone = true;
      onDoneWithLog();
      return;
    }
    handleSseDataLine(line, {
      onChunk: onChunkForward,
      onReActEvent: onReActWrapped,
      onClientToolCall: onClientToolWrapped,
      onApprovalPending: opts.onApprovalPending,
      accumulatedRef,
      streamLogContext: ctx,
    });
  };

  const consumeBuffer = (): void => {
    unstable_batchedUpdates(() => {
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split('\n')) {
          const trimmed = line.replace(/\r$/, '');
          if (!trimmed.startsWith('data:')) continue;
          handleDataLine(trimmed.slice(5).trimStart());
        }
      }
    });
  };

  const reader = response.body?.getReader();
  if (!reader) {
    opts.onError?.(new Error('No response body'));
    return;
  }

  const decoder = new TextDecoder();

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      consumeBuffer();
      if (done) break;
    }

    if (opts.signal.aborted) return;

    if (!sawDone) {
      if (buffer.trim()) {
        unstable_batchedUpdates(() => {
          for (const line of buffer.split('\n')) {
            const trimmed = line.replace(/\r$/, '');
            if (trimmed.startsWith('data:')) {
              handleDataLine(trimmed.slice(5).trimStart());
            }
          }
        });
      }
      if (!sawDone) {
        if (accumulatedRef.value) {
          onDoneWithLog();
        } else {
          opts.onError?.(new Error('Stream connection failed'));
        }
      }
    }
  } catch (err: unknown) {
    if (!opts.signal.aborted) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** Current user's permitted agents (RBAC via role → agent). Use /agents, not /agents/all. */
export const listAgents = async (): Promise<Agent[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/agents`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const createSession = async (agentId: number): Promise<ChatSession> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ agent_id: agentId }),
  });
  const json = await response.json();
  return json.data;
};

export const listSessions = async (agentId: number, limit = 50, offset = 0): Promise<ChatSession[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/chat/sessions?agent_id=${agentId}&limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
};

export const updateSessionTitle = async (sessionId: string, title: string): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/chat/sessions/${sessionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ title }),
  });
};

/** POST /chat/upload — same as web `uploadFile` (multipart). */
export async function uploadChatFile(
  file: File,
): Promise<{ url: string; filename: string } | null> {
  const apiUrl = await getApiUrl();
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await fetch(`${apiUrl}/chat/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      body: formData,
    });
    const json = await response.json();
    if (json.code === 0 && json.data?.url) {
      return { url: json.data.url as string, filename: String(json.data.filename ?? file.name) };
    }
    return null;
  } catch {
    return null;
  }
}

export const getSessionMessages = async (sessionId: string, limit = 100): Promise<ChatHistoryMessage[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/chat/sessions/${sessionId}/messages?limit=${limit}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const sendChatMessage = async (req: ChatRequest): Promise<ChatResponse> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(req),
  });
  const json = await response.json();
  return json.data;
};

export const stopChatStream = async (sessionId: string): Promise<void> => {
  closeStream();
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/chat/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
};

/**
 * After `/chat/tool_result/stream` finishes: refetch messages. First call uses `silent: false` so the
 * thread shows the loading spinner instead of the empty-state (streaming just ended and DB may lag).
 * Second call retries once after 500ms for async `recordConversationAsync` completion.
 */
export function flushMessagesAfterToolResult(
  loadMessages: (opts?: { silent?: boolean; sessionId?: string }) => void | Promise<void>,
  sessionId: string,
): void {
  void loadMessages({ silent: false, sessionId });
  window.setTimeout(() => {
    void loadMessages({ silent: true, sessionId });
  }, 500);
}

/**
 * After POST /chat/stream ends with [DONE]: the server persists the turn in `recordConversationAsync`
 * (goroutine). The first GET /messages can run before the DB write finishes, so the UI would clear
 * the typewriter and show history without the new assistant row — looks like the reply vanished.
 * Mirror tool_result retries so history catches up shortly after.
 */
export function flushMessagesAfterChatStream(
  loadMessages: (opts?: { silent?: boolean; sessionId?: string }) => void | Promise<void>,
  sessionId: string,
): void {
  void loadMessages({ silent: true, sessionId });
  window.setTimeout(() => {
    void loadMessages({ silent: true, sessionId });
  }, 450);
  window.setTimeout(() => {
    void loadMessages({ silent: true, sessionId });
  }, 1200);
}

/** Same as POST /chat/stream — Tauri must send `desktop` so resume ReAct saves `client_tool` state with client_type. */
async function resolveClientTypeForApi(): Promise<'web' | 'desktop'> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    if (typeof isTauri === 'function' && isTauri()) {
      return 'desktop';
    }
  } catch {
    /* not Tauri */
  }
  return 'web';
}

export const submitToolResult = async (sessionId: string, callId: string, result: string, error?: string): Promise<void> => {
  const apiUrl = await getApiUrl();
  const clientType = await resolveClientTypeForApi();
  await fetch(`${apiUrl}/chat/tool_result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ session_id: sessionId, call_id: callId, result, error, client_type: clientType }),
  });
};

/** Resume agent loop after a client tool result (SSE). Same line format as /chat/stream. */
export const submitToolResultStream = (
  sessionId: string,
  callId: string,
  result: string,
  toolError: string | undefined,
  onChunk: (content: string) => void,
  onDone: (sessionId: string) => void,
  onError: (error: Error) => void,
  onClientToolCall?: (call: ClientToolCall) => void,
  onApprovalPending?: (approvalId: number, toolName: string) => void,
  /** Plan-and-execute: same as POST /chat/stream — merge `plan_tasks` / `plan_step` into the checklist. */
  onReActEvent?: (event: ReActEvent) => void,
): void => {
  closeStream();

  const connect = async () => {
    const sid = String(sessionId ?? '').trim();
    const cid = String(callId ?? '').trim();
    if (!sid || !cid) {
      onError?.(new Error('Missing session_id or call_id'));
      return;
    }
    const apiUrl = await getApiUrl();
    const token = localStorage.getItem('access_token');
    const abort = new AbortController();
    currentStreamAbort = abort;
    const { signal } = abort;

    const url = `${apiUrl}/chat/tool_result/stream`;
    const sidShort = sid.length > 12 ? `${sid.slice(0, 12)}…` : sid;
    const cidShort = cid.length > 24 ? `${cid.slice(0, 24)}…` : cid;
    const clientType = await resolveClientTypeForApi();
    console.info('[tool_result/stream] posting client tool result to server', {
      url,
      session_id: sidShort,
      call_id: cidShort,
      resultChars: result.length,
      hasToolError: Boolean(toolError?.trim()),
      client_type: clientType,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ session_id: sid, call_id: cid, result, error: toolError, client_type: clientType }),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[tool_result/stream] HTTP error', response.status, text?.slice(0, 200));
        onError?.(new Error(text || `HTTP ${response.status}`));
        return;
      }

      console.info('[tool_result/stream] response OK, consuming SSE until [DONE]');

      await consumeEventStream(response, {
        onChunk,
        // Go ReAct SSE uses `type` (not `event_type`); errors must still reach the typewriter.
        onReActEvent: (evt) => {
          onReActEvent?.(evt);
          if (evt.type === 'error') {
            onChunk(evt.content);
          }
        },
        onClientToolCall,
        onApprovalPending,
        onDone: () => {
          console.info('[tool_result/stream] SSE finished; server resumed agent loop');
          onDone(sid);
        },
        onError: (e) => {
          console.warn('[tool_result/stream] SSE consumer error', e.message);
          onError(e);
        },
        signal,
        streamLogContext: 'tool_result/stream',
      });
    } catch (err: unknown) {
      if (!signal.aborted) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.warn('[tool_result/stream] fetch or stream failed', e.message);
        onError(e);
      }
    } finally {
      if (currentStreamAbort === abort) {
        currentStreamAbort = null;
      }
    }
  };

  void connect();
};

export const streamChatMessage = (
  req: ChatRequest,
  onChunk: (content: string) => void,
  onReActEvent?: (event: ReActEvent) => void,
  onDone?: (sessionId: string) => void,
  onError?: (error: Error) => void,
  onClientToolCall?: (call: ClientToolCall) => void,
  onApprovalPending?: (approvalId: number, toolName: string) => void,
): void => {
  closeStream();

  const connect = async () => {
    const apiUrl = await getApiUrl();
    const token = localStorage.getItem('access_token');
    const abort = new AbortController();
    currentStreamAbort = abort;
    const { signal } = abort;

    const clientType = await resolveClientTypeForApi();

    try {
      const response = await fetch(`${apiUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ...req, client_type: clientType }),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        onError?.(new Error(text || `HTTP ${response.status}`));
        return;
      }

      await consumeEventStream(response, {
        onChunk,
        onReActEvent,
        onClientToolCall,
        onApprovalPending,
        onDone: () => onDone?.(req.session_id || ''),
        onError: (e: Error) => onError?.(e),
        signal,
        streamLogContext: 'chat/stream',
      });
    } catch (err: unknown) {
      if (!signal.aborted) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (currentStreamAbort === abort) {
        currentStreamAbort = null;
      }
    }
  };

  void connect();
};

export const closeStream = (): void => {
  if (currentStreamAbort) {
    currentStreamAbort.abort();
    currentStreamAbort = null;
  }
};

/** Persist ClientToolCall while waiting for external (web) approval so refresh / session restore can resume. */
export function approvalDeferredStorageKey(sessionId: string, approvalId: number): string {
  return `aitaskmeta:approval_deferred:${sessionId}:${approvalId}`;
}

export function saveApprovalDeferredCall(sessionId: string, call: ClientToolCall): void {
  if (!sessionId.trim() || !call.approval_id || call.approval_id <= 0) return;
  try {
    const key = approvalDeferredStorageKey(sessionId, call.approval_id);
    sessionStorage.setItem(key, JSON.stringify(call));
    sessionStorage.removeItem(`sya:approval_deferred:${sessionId}:${call.approval_id}`);
  } catch {
    /* quota / private mode */
  }
}

export function loadApprovalDeferredCall(sessionId: string, approvalId: number): ClientToolCall | null {
  try {
    const key = approvalDeferredStorageKey(sessionId, approvalId);
    let raw = sessionStorage.getItem(key);
    if (!raw) {
      raw = sessionStorage.getItem(`sya:approval_deferred:${sessionId}:${approvalId}`);
    }
    if (!raw) return null;
    return JSON.parse(raw) as ClientToolCall;
  } catch {
    return null;
  }
}

export function clearApprovalDeferredCall(sessionId: string, approvalId: number): void {
  try {
    sessionStorage.removeItem(approvalDeferredStorageKey(sessionId, approvalId));
    sessionStorage.removeItem(`sya:approval_deferred:${sessionId}:${approvalId}`);
  } catch {
    /* */
  }
}

/** Approval ids for which we have a persisted ClientToolCall in sessionStorage. */
export function listDeferredApprovalIdsForSession(sessionId: string): number[] {
  if (!sessionId.trim()) return [];
  const prefixes = [
    `aitaskmeta:approval_deferred:${sessionId}:`,
    `sya:approval_deferred:${sessionId}:`,
  ];
  const ids: number[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const id = Number(key.slice(prefix.length));
          if (Number.isFinite(id) && id > 0) ids.push(id);
        }
      }
    }
  } catch {
    /* */
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

export type ReconcileDeferredApprovalsResult =
  | { type: 'run_approved'; call: ClientToolCall }
  | {
      type: 'still_pending';
      approvalId: number;
      toolName: string;
      deferred: ClientToolCall;
    }
  | { type: 'idle' };

/**
 * Re-check server approval for each locally persisted deferred client tool.
 * Use when the user left the chat (no SSE) while someone approved elsewhere: the request is no longer
 * `pending`, so getPendingApprovalBySession is empty, but we must still run the Tauri handler.
 */
export async function reconcileDeferredApprovalsFromStorage(
  sessionId: string,
): Promise<ReconcileDeferredApprovalsResult> {
  const ids = listDeferredApprovalIdsForSession(sessionId);
  let firstPending: { approvalId: number; toolName: string; deferred: ClientToolCall } | null = null;

  for (const approvalId of ids) {
    let st: string;
    try {
      st = (await getApprovalStatus(approvalId)).status;
    } catch {
      continue;
    }
    if (st === 'approved') {
      const deferred = loadApprovalDeferredCall(sessionId, approvalId);
      clearApprovalDeferredCall(sessionId, approvalId);
      if (deferred?.call_id?.trim()) {
        return { type: 'run_approved', call: deferred };
      }
      continue;
    }
    if (st === 'rejected' || st === 'expired') {
      clearApprovalDeferredCall(sessionId, approvalId);
      continue;
    }
    if (st === 'pending') {
      const deferred = loadApprovalDeferredCall(sessionId, approvalId);
      if (deferred?.call_id?.trim() && !firstPending) {
        firstPending = { approvalId, toolName: deferred.tool_name, deferred };
      }
    }
  }

  if (firstPending) {
    return {
      type: 'still_pending',
      approvalId: firstPending.approvalId,
      toolName: firstPending.toolName,
      deferred: firstPending.deferred,
    };
  }
  return { type: 'idle' };
}

export async function getApprovalStatus(approvalId: number): Promise<{ status: string; approver_id?: string; comment?: string }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/approvals/${approvalId}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = (await response.json()) as { data?: Record<string, unknown> };
  const payload = (data?.data ?? data) as Record<string, unknown>;
  const rawStatus = payload?.status;
  const status =
    typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
  return {
    status,
    approver_id: typeof payload.approver_id === 'string' ? payload.approver_id : undefined,
    comment: typeof payload.comment === 'string' ? payload.comment : undefined,
  };
}

export async function getPendingApprovalBySession(sessionId: string): Promise<{ id: number; tool_name: string } | null> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/approvals?session_id=${sessionId}&status=pending`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  if (data.data?.requests?.length > 0) {
    return { id: data.data.requests[0].id, tool_name: data.data.requests[0].tool_name };
  }
  return null;
}
