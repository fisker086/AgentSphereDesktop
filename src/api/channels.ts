import { getApiUrl } from './config';

export interface NotifyChannel {
  id: number;
  name: string;
  kind: string;
  webhook_url?: string;
  app_id?: string;
  has_app_secret: boolean;
  extra?: Record<string, string>;
  is_active: boolean;
  created_at: string;
}

export interface CreateChannelRequest {
  name: string;
  kind: string;
  webhook_url?: string;
  app_id?: string;
  app_secret?: string;
  extra_json?: string;
  is_active?: boolean;
}

export async function listChannels(): Promise<NotifyChannel[]> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data || [];
}

export async function getChannel(id: number): Promise<NotifyChannel> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels/${id}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data;
}

export async function createChannel(req: CreateChannelRequest): Promise<NotifyChannel> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data;
}

export async function updateChannel(id: number, req: CreateChannelRequest): Promise<NotifyChannel> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.data;
}

export async function deleteChannel(id: number): Promise<void> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export async function testChannel(id: number): Promise<void> {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/channels/${id}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
