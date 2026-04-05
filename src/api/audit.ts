import { getApiUrl } from './config';

export interface AuditEntry {
  timestamp: number;
  action: string;
  target: string;
  result: string;
  details?: string;
  ip?: string;
}

export const logSecurityEvent = async (
  action: string,
  target: string,
  result: string,
  details?: string
): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/api/v1/audit/logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify({ action, target, result, details }),
  });
};

export const getAuditLogs = async (limit = 50, offset = 0): Promise<AuditEntry[]> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/v1/audit/logs?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || [];
};

export const getAuditLogsCount = async (): Promise<number> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/api/v1/audit/logs/count`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data || 0;
};

export const clearAuditLogs = async (): Promise<void> => {
  const apiUrl = await getApiUrl();
  await fetch(`${apiUrl}/api/v1/audit/logs`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
};