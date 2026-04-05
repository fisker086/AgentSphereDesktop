import { getApiUrl } from './config';

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}` };
}

export interface ChatStats {
  total_chats: number;
  total_sessions: number;
  total_messages: number;
  total_agents: number;
}

export interface RecentChatRow {
  session_id: string;
  agent_id: number;
  agent_public_id?: string;
  agent_name: string;
  updated_at: string;
  title?: string;
}

export interface ActivityItem {
  date: string;
  count: number;
}

export async function getChatStats(): Promise<ChatStats> {
  const apiUrl = await getApiUrl();
  const res = await fetch(`${apiUrl}/chat/stats`, { headers: authHeaders() });
  const json = (await res.json()) as { data?: ChatStats };
  return json.data ?? {
    total_chats: 0,
    total_sessions: 0,
    total_messages: 0,
    total_agents: 0,
  };
}

export async function getRecentChats(): Promise<RecentChatRow[]> {
  const apiUrl = await getApiUrl();
  const res = await fetch(`${apiUrl}/chat/recent`, { headers: authHeaders() });
  const json = (await res.json()) as { data?: RecentChatRow[] };
  return json.data ?? [];
}

/** Server currently returns activity for the last 7 days (see `GetChatActivity`). */
export async function getChatActivity(): Promise<ActivityItem[]> {
  const apiUrl = await getApiUrl();
  const res = await fetch(`${apiUrl}/chat/activity`, { headers: authHeaders() });
  const json = (await res.json()) as { data?: unknown[] };
  const raw = json.data ?? [];
  return raw.map((row) => {
    const r = row as { date?: string; count?: number };
    return {
      date: String(r.date ?? ''),
      count: Number(r.count ?? 0),
    };
  });
}
