import { getApiUrl } from './config';
import type { ApprovalRequest } from '../types';

export interface ListApprovalResponse {
  requests: ApprovalRequest[];
  total: number;
  page: number;
}

export async function listApprovals(filter: {
  status?: string;
  agent_id?: number;
  session_id?: string;
  page?: number;
  page_size?: number;
}): Promise<ListApprovalResponse> {
  const apiUrl = await getApiUrl();
  const params = new URLSearchParams();
  if (filter.status) params.append('status', filter.status);
  if (filter.agent_id) params.append('agent_id', String(filter.agent_id));
  if (filter.session_id) params.append('session_id', filter.session_id);
  if (filter.page) params.append('page', String(filter.page));
  if (filter.page_size) params.append('page_size', String(filter.page_size));

  const response = await fetch(`${apiUrl}/approvals?${params}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data || { requests: [], total: 0, page: 1 };
}

export async function getApproval(id: number): Promise<ApprovalRequest> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/approvals/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data;
}

export async function approveRequest(id: number, comment?: string): Promise<void> {
  const apiUrl = await getApiUrl();
  const params = new URLSearchParams();
  if (comment) params.append('comment', comment);

  const response = await fetch(`${apiUrl}/approvals/${id}/approve?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function rejectRequest(id: number, comment?: string): Promise<void> {
  const apiUrl = await getApiUrl();
  const params = new URLSearchParams();
  if (comment) params.append('comment', comment);

  const response = await fetch(`${apiUrl}/approvals/${id}/reject?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
