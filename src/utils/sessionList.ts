import type { ChatSession } from '../types';

export type SessionDayBucket = 'today' | 'yesterday' | 'earlier';

const startOfLocalDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Group by calendar day of `updated_at` in local timezone. */
export function groupSessionsByDay(sessions: ChatSession[]): Record<SessionDayBucket, ChatSession[]> {
  const out: Record<SessionDayBucket, ChatSession[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime();
    const dayStart = startOfLocalDay(new Date(t));
    if (dayStart.getTime() === todayStart.getTime()) {
      out.today.push(s);
    } else if (dayStart.getTime() === yesterdayStart.getTime()) {
      out.yesterday.push(s);
    } else {
      out.earlier.push(s);
    }
  }
  return out;
}

/** Newest activity first (matches API ORDER BY updated_at DESC). */
export function sortSessionsByUpdatedDesc(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

/** Merge two lists by session_id (later wins), then sort by updated_at desc. */
export function mergeSessionsById(existing: ChatSession[], incoming: ChatSession[]): ChatSession[] {
  const map = new Map<string, ChatSession>();
  for (const s of existing) map.set(s.session_id, s);
  for (const s of incoming) map.set(s.session_id, s);
  return sortSessionsByUpdatedDesc([...map.values()]);
}

export function formatSessionTimeLine(
  session: ChatSession,
  bucket: SessionDayBucket,
  locale: string,
): string {
  const d = new Date(session.updated_at);
  if (bucket === 'today' || bucket === 'yesterday') {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}
