import { getServerUrl } from './config';
import type { APIResponse } from '../types';

export interface VersionInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  download_url: string;
}

export const checkDesktopVersion = async (): Promise<VersionInfo | null> => {
  try {
    const pkg = await import('../../package.json');
    const currentVersion = pkg.default.version;

    const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' :
                   navigator.platform.toLowerCase().includes('win') ? 'windows' : 'linux';

    const serverUrl = await getServerUrl();
    const response = await fetch(`${serverUrl}/api/v1/desktop-version?version=${currentVersion}&platform=${platform}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: APIResponse<VersionInfo> = await response.json();
    return data.data;
  } catch (error) {
    console.warn('Failed to check version:', error);
    return null;
  }
};