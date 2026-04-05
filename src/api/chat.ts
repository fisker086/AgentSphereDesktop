import { getApiUrl } from './config';
import type { ChatRequest, ChatResponse, ChatSession, ChatHistoryMessage, Agent, ClientToolCall } from '../types';

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
  return clientModeToolsCache.has(toolName);
}

/**
 * Tauri / desktop: confirm when the tool runs on the client and risk is above `low`.
 * `execution_mode === 'server'` → no desktop confirmation (server-side path).
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
  return r !== 'low';
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
  console.log('[DEBUG] normalizeClientToolPayload:', { callId, toolName, riskLevel, executionMode, raw: parsed });
  return {
    call_id: callId,
    tool_name: toolName,
    params,
    hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
    risk_level: riskLevel,
    execution_mode: executionMode,
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

function handleSseDataLine(
  data: string,
  opts: {
    onChunk: (content: string) => void;
    onClientToolCall?: (call: ClientToolCall) => void;
    onApprovalPending?: (approvalId: number, toolName: string) => void;
    accumulatedRef: { value: string };
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
    onDone: () => void;
    onError: (e: Error) => void;
    onClientToolCall?: (call: ClientToolCall) => void;
    onApprovalPending?: (approvalId: number, toolName: string) => void;
    signal: AbortSignal;
  },
): Promise<void> {
  const accumulatedRef = { value: '' };
  let sawDone = false;
  let buffer = '';

  const handleDataLine = (line: string): void => {
    if (line === '[DONE]') {
      sawDone = true;
      opts.onDone();
      return;
    }
    handleSseDataLine(line, {
      onChunk: opts.onChunk,
      onClientToolCall: opts.onClientToolCall,
      onApprovalPending: opts.onApprovalPending,
      accumulatedRef,
    });
  };

  const consumeBuffer = (): void => {
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
  };

  const reader = response.body?.getReader();
  if (!reader) {
    opts.onError(new Error('No response body'));
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
        for (const line of buffer.split('\n')) {
          const trimmed = line.replace(/\r$/, '');
          if (trimmed.startsWith('data:')) {
            handleDataLine(trimmed.slice(5).trimStart());
          }
        }
      }
      if (!sawDone) {
        if (accumulatedRef.value) {
          opts.onDone();
        } else {
          opts.onError(new Error('Stream connection failed'));
        }
      }
    }
  } catch (err: unknown) {
    if (!opts.signal.aborted) {
      opts.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export const listAgents = async (): Promise<Agent[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/agents/all`, {
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

export const submitToolResult = async (sessionId: string, callId: string, result: string, error?: string): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/chat/tool_result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ session_id: sessionId, call_id: callId, result, error }),
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
): void => {
  closeStream();

  const connect = async () => {
    const sid = String(sessionId ?? '').trim();
    const cid = String(callId ?? '').trim();
    if (!sid || !cid) {
      onError(new Error('Missing session_id or call_id'));
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
    console.info('[tool_result/stream] posting client tool result to server', {
      url,
      session_id: sidShort,
      call_id: cidShort,
      resultChars: result.length,
      hasToolError: Boolean(toolError?.trim()),
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ session_id: sid, call_id: cid, result, error: toolError }),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[tool_result/stream] HTTP error', response.status, text?.slice(0, 200));
        onError(new Error(text || `HTTP ${response.status}`));
        return;
      }

      console.info('[tool_result/stream] response OK, consuming SSE until [DONE]');

      await consumeEventStream(response, {
        onChunk,
        onClientToolCall,
        onDone: () => {
          console.info('[tool_result/stream] SSE finished; server resumed agent loop');
          onDone(sid);
        },
        onError: (e) => {
          console.warn('[tool_result/stream] SSE consumer error', e.message);
          onError(e);
        },
        signal,
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
  onDone: (sessionId: string) => void,
  onError: (error: Error) => void,
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

    // `import('@tauri-apps/api/core')` succeeds in a normal browser if the package is bundled — it does not mean Tauri is available.
    let clientType: 'web' | 'desktop' = 'web';
    try {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (typeof isTauri === 'function' && isTauri()) {
        clientType = 'desktop';
      }
    } catch {
      clientType = 'web';
    }

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
        onError(new Error(text || `HTTP ${response.status}`));
        return;
      }

      await consumeEventStream(response, {
        onChunk,
        onClientToolCall,
        onApprovalPending,
        onDone: () => onDone(req.session_id || ''),
        onError,
        signal,
      });
    } catch (err: unknown) {
      if (!signal.aborted) {
        onError(err instanceof Error ? err : new Error(String(err)));
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

export async function getApprovalStatus(approvalId: number): Promise<{ status: string; approver_id?: string; comment?: string }> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/approvals/${approvalId}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data || {};
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
