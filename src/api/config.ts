import { invoke } from '@tauri-apps/api/core';

const DEFAULT_SERVER_URL = 'http://localhost:8080';

export const getServerUrl = async (): Promise<string> => {
  try {
    const configUrl = await invoke<string>('get_server_url');
    if (configUrl && configUrl.trim()) {
      return configUrl.trim();
    }
  } catch (e) {
    console.log('Tauri not available, using localStorage:', e);
  }
  
  const storedUrl = localStorage.getItem('server_url');
  if (storedUrl && storedUrl.trim()) {
    return storedUrl.trim();
  }
  
  return DEFAULT_SERVER_URL;
};

export const saveServerUrl = async (url: string): Promise<void> => {
  const cleanUrl = url.trim().replace(/\/$/, '');
  localStorage.setItem('server_url', cleanUrl);
  try {
    await invoke('save_server_url', { url: cleanUrl });
  } catch (e) {
    console.log('Failed to save to config file:', e);
  }
};

export const getConfigPath = async (): Promise<string> => {
  try {
    return await invoke<string>('get_config_path');
  } catch {
    return '';
  }
};

export const getBaseUrl = async (): Promise<string> => {
  const serverUrl = await getServerUrl();
  return serverUrl;
};

export const getApiUrl = async (): Promise<string> => {
  const serverUrl = await getServerUrl();
  return `${serverUrl}/api/v1`;
};

/** Sync base URL for resolving uploaded file paths (matches stored `server_url` / default). */
export function getServerUrlSync(): string {
  try {
    const stored = localStorage.getItem('server_url');
    if (stored?.trim()) return stored.trim().replace(/\/$/, '');
  } catch {
    /* ignore */
  }
  return DEFAULT_SERVER_URL.replace(/\/$/, '');
}

/**
 * Turn API-relative paths like `/api/v1/chat/files/...` into absolute URLs for img src / links.
 */
export function resolveChatAttachmentUrl(pathOrUrl: string | undefined): string {
  if (!pathOrUrl) return '';
  const t = pathOrUrl.trim();
  if (t.startsWith('data:') || t.startsWith('blob:')) return t;
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  if (t.startsWith('/')) {
    return `${getServerUrlSync()}${t}`;
  }
  return t;
}
