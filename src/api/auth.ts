import { getApiUrl } from './config';
import type { User } from '../types';

export const getAuthConfig = async (): Promise<{ auth_type: string; captcha_disabled: boolean }> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/auth/config`);
  if (!response.ok) {
    return { auth_type: 'password', captcha_disabled: false };
  }
  const json = (await response.json()) as Record<string, unknown>;
  // Backend returns fields at top level; some clients may wrap in `data`.
  const cfg = (json.data as Record<string, unknown> | undefined) ?? json;
  return {
    auth_type: typeof cfg.auth_type === 'string' ? cfg.auth_type : 'password',
    captcha_disabled: Boolean(cfg.captcha_disabled),
  };
};

export const getCaptcha = async (): Promise<{ token: string; image: string }> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/auth/captcha`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Failed to get captcha (${response.status}): ${text.slice(0, 200) || response.statusText}`
    );
  }
  return response.json();
};

export const login = async (data: { username: string; password: string; captchaToken?: string; captchaCode?: string }): Promise<any> => {
  const apiUrl = await getApiUrl();
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: data.username,
      password: data.password,
      captcha_token: data.captchaToken,
      captcha_code: data.captchaCode,
    }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Login failed');
  }
  return response.json();
};

function parseUser (raw: Record<string, unknown>): User {
  return {
    id: Number(raw.id),
    username: String(raw.username ?? ''),
    email: String(raw.email ?? ''),
    full_name: raw.full_name != null && raw.full_name !== '' ? String(raw.full_name) : null,
    avatar_url: raw.avatar_url != null && raw.avatar_url !== '' ? String(raw.avatar_url) : null,
    status: String(raw.status ?? ''),
    is_admin: Boolean(raw.is_admin),
  };
}

/** GET /auth/me — body is `{ user }` (not wrapped in `data`). */
export async function fetchMe (): Promise<User> {
  const baseUrl = await getApiUrl();
  const token = localStorage.getItem('access_token');
  if (!token) {
    throw new Error('Not authenticated');
  }
  const response = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const inner = (json.data as Record<string, unknown> | undefined) ?? json;
  const u = inner.user as Record<string, unknown> | undefined;
  if (!u || typeof u !== 'object') {
    throw new Error('Invalid /auth/me response');
  }
  return parseUser(u);
}

export async function updateProfile (body: { email?: string; full_name?: string }): Promise<User> {
  const baseUrl = await getApiUrl();
  const token = localStorage.getItem('access_token');
  const response = await fetch(`${baseUrl}/auth/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Update failed');
  }
  const json = (await response.json()) as Record<string, unknown>;
  const inner = (json.data as Record<string, unknown> | undefined) ?? json;
  const u = inner.user as Record<string, unknown> | undefined;
  if (!u) {
    return fetchMe();
  }
  return parseUser(u);
}

export async function changePassword (currentPassword: string, newPassword: string): Promise<void> {
  const baseUrl = await getApiUrl();
  const token = localStorage.getItem('access_token');
  const response = await fetch(`${baseUrl}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Change password failed');
  }
}

export const refreshToken = async (refreshTokenStr: string): Promise<any> => {
  const baseUrl = await getApiUrl();
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshTokenStr }),
  });
  return response.json();
};
