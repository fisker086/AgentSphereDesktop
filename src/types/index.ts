export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: string;
  is_admin: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Agent {
  id: number;
  name: string;
  /** Matches API field `description` (see schema.Agent Desc). */
  description: string;
  category: string;
  is_builtin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One vision image in POST /chat/stream (matches server `ChatImagePart`). */
export interface ChatImagePart {
  base64: string;
  mime: string;
}

export interface ChatRequest {
  agent_id: number;
  message: string;
  session_id?: string;
  image_parts?: ChatImagePart[];
  image_urls?: string[];
  file_urls?: string[];
}

export interface ChatResponse {
  message: string;
  session_id: string;
  agent_id: number;
  duration_ms?: number;
}

export interface ChatSession {
  session_id: string;
  agent_id: number;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatHistoryMessage {
  id: number;
  role: string;
  content: string;
  image_urls: string[];
  file_urls: string[];
  react_steps?: Record<string, any>[];
  created_at: string;
}

export interface Schedule {
  id: number;
  name: string;
  description: string;
  agent_id: number;
  agent_name?: string;
  channel_id?: number;
  schedule_kind: string;
  cron_expr?: string;
  at?: string;
  every_ms?: number;
  timezone?: string;
  wake_mode: string;
  session_target: string;
  chat_session_id?: string;
  prompt: string;
  enabled: boolean;
  stagger_ms: number;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleRequest {
  name: string;
  description?: string;
  agent_id: number;
  channel_id?: number;
  schedule_kind: string;
  cron_expr?: string;
  at?: string;
  every_ms?: number;
  timezone?: string;
  wake_mode: string;
  session_target: string;
  prompt: string;
  stagger_ms?: number;
  enabled?: boolean;
}

export interface UpdateScheduleRequest {
  name?: string;
  description?: string;
  agent_id?: number;
  channel_id?: number;
  schedule_kind?: string;
  cron_expr?: string;
  at?: string;
  every_ms?: number;
  timezone?: string;
  wake_mode?: string;
  session_target?: string;
  prompt?: string;
  stagger_ms?: number;
  enabled?: boolean;
}

export interface ScheduleExecution {
  id: number;
  schedule_id: number;
  status: string;
  result?: string;
  error?: string;
  duration_ms: number;
  started_at: string;
  finished_at?: string;
}

export interface ClientToolCall {
  call_id: string;
  tool_name: string;
  params: Record<string, any>;
  hint?: string;
  /** Server-side risk: `low` → auto-run when supported; `medium` / `high` / `critical` → confirm first */
  risk_level?: string;
  /** `client` | `server` from skill/tool metadata; desktop confirms only client + risk > low */
  execution_mode?: string;
  /** When set, smart体审批策略要求先走 Approvals，通过后再执行本地 Tauri */
  approval_id?: number;
  /** Set only after external approval resolved — skip desktop risk confirmation dialog */
  skip_local_confirm?: boolean;
}

export interface APIResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface ApprovalRequest {
  id: number;
  agent_id: number;
  /** Display name from server; prefer over raw id in UI */
  agent_name?: string;
  /** Usernames configured on the agent as approvers */
  designated_approvers?: string[];
  /** Whether the current session user may approve/reject this pending request */
  can_approve?: boolean;
  session_id: string;
  user_id: string;
  tool_name: string;
  risk_level: string;
  input: string;
  status: string;
  approver_id: string;
  comment: string;
  approved_at: string | null;
  created_at: string;
  approval_type: string;
  external_id: string;
  expires_at: string;
}
