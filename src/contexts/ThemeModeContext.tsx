import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import type { PaletteMode } from '@mui/material';
import { createAppTheme } from '../theme';

const STORAGE_KEY = 'aitaskmeta_theme_mode';
const LEGACY_STORAGE_KEY = 'sya_theme_mode';

function readStoredMode(): PaletteMode {
  try {
    let v = localStorage.getItem(STORAGE_KEY);
    if (v !== 'light' && v !== 'dark') {
      v = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (v === 'light' || v === 'dark') {
        localStorage.setItem(STORAGE_KEY, v);
      }
    }
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignore */
  }
  return 'dark';
}

type ThemeModeContextValue = {
  mode: PaletteMode;
  toggleMode: () => void;
  setMode: (m: PaletteMode) => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export const ThemeModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<PaletteMode>(readStoredMode);

  useEffect(() => {
    document.documentElement.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
  }, [mode]);

  const setMode = useCallback((m: PaletteMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeModeContext.Provider value={{ mode, toggleMode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within ThemeModeProvider');
  }
  return ctx;
}
