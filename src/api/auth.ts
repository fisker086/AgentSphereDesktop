import { getApiUrl } from './config';

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

export const getCurrentUser = async (): Promise<any> => {
  const baseUrl = await getApiUrl();
  const response = await fetch(`${baseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
  });
  const json = await response.json();
  return json.data;
};

export const refreshToken = async (refreshTokenStr: string): Promise<any> => {
  const baseUrl = await getApiUrl();
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshTokenStr }),
  });
  return response.json();
};
