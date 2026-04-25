import React, { useState, useEffect, useCallback } from 'react';
import type { User } from '../types';
import { login as apiLogin, fetchMe } from '../api/auth';
import { getServerUrl, saveServerUrl } from '../api/config';
import { invalidateClientModeToolsCache, reloadClientModeTools } from '../api/chat';
import { AuthContext } from './auth-context';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('access_token'));
  const [serverUrl, setServerUrlState] = useState<string>('http://localhost:8080');

  useEffect(() => {
    const init = async () => {
      const url = await getServerUrl();
      setServerUrlState(url);
      
      const token = localStorage.getItem('access_token');
      const storedUser = localStorage.getItem('user');
      if (token && storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          setAccessToken(token);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
        }
      }
    };
    init();
  }, []);

  const setServerUrl = useCallback(async (url: string) => {
    const cleanUrl = url.trim().replace(/\/$/, '');
    localStorage.setItem('server_url', cleanUrl);
    setServerUrlState(cleanUrl);
    await saveServerUrl(cleanUrl);
    void reloadClientModeTools();
  }, []);

  const login = useCallback(async (username: string, password: string, captchaToken?: string, captchaCode?: string) => {
    const response = await apiLogin({ username, password, captchaToken, captchaCode });
    localStorage.setItem('access_token', response.access_token);
    localStorage.setItem('refresh_token', response.refresh_token);
    localStorage.setItem('user', JSON.stringify(response.user));
    setAccessToken(response.access_token);
    setUser(response.user);
  }, []);

  const completeSsoLogin = useCallback(async (token: string, refresh?: string) => {
    localStorage.setItem('access_token', token);
    if (refresh) {
      localStorage.setItem('refresh_token', refresh);
    }
    const me = await fetchMe();
    localStorage.setItem('user', JSON.stringify(me));
    setAccessToken(token);
    setUser(me);
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    localStorage.setItem('user', JSON.stringify(me));
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    invalidateClientModeToolsCache();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        serverUrl,
        login,
        completeSsoLogin,
        refreshUser,
        logout,
        isAuthenticated: !!accessToken,
        setServerUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
