import { createContext } from 'react';
import type { User } from '../types';

export interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  serverUrl: string;
  login: (username: string, password: string, captchaToken?: string, captchaCode?: string) => Promise<void>;
  /** SSO 回调 URL 中的 access_token / refresh_token 写入本地并拉取用户（与网页端一致） */
  completeSsoLogin: (accessToken: string, refreshToken?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  setServerUrl: (url: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
