import { alpha, createTheme, type PaletteMode } from '@mui/material/styles';

const accent = '#2dd4bf';
const accentLightMode = '#0d9488';

const sharedShape = { borderRadius: 10 };

const sharedTypography = {
  fontFamily:
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  h5: { fontWeight: 700, letterSpacing: '-0.02em' },
  h6: { fontWeight: 600 },
  subtitle2: { fontWeight: 600 },
};

function bodyStyleOverrides(mode: PaletteMode) {
  if (mode === 'dark') {
    const bgDefault = '#0a0e14';
    return {
      html: { height: '100%' },
      body: {
        backgroundColor: bgDefault,
        backgroundImage: `
            radial-gradient(ellipse 120% 80% at 50% -20%, ${alpha(accent, 0.09)} 0%, transparent 50%),
            radial-gradient(ellipse 80% 50% at 100% 0%, ${alpha('#38bdf8', 0.05)} 0%, transparent 45%)
          `,
        backgroundAttachment: 'fixed',
      },
    };
  }
  return {
    html: { height: '100%' },
    body: {
      backgroundColor: '#f5f7fa',
      backgroundImage: `
          radial-gradient(ellipse 120% 80% at 50% -25%, ${alpha(accentLightMode, 0.09)} 0%, transparent 52%),
          radial-gradient(ellipse 70% 50% at 100% 0%, ${alpha('#38bdf8', 0.07)} 0%, transparent 48%)
        `,
      backgroundAttachment: 'fixed',
    },
  };
}

export function createAppTheme(mode: PaletteMode) {
  const isDark = mode === 'dark';

  const primaryMain = isDark ? accent : accentLightMode;
  const primaryContrast = isDark ? '#04120f' : '#ffffff';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: primaryMain,
        dark: isDark ? '#14b8a6' : '#0f766e',
        light: isDark ? '#5eead4' : '#14b8a6',
        contrastText: primaryContrast,
      },
      secondary: {
        main: '#64748b',
        light: '#94a3b8',
        dark: '#475569',
      },
      background: isDark
        ? {
            default: '#0a0e14',
            paper: '#111923',
          }
        : {
            default: '#f5f7fa',
            paper: '#ffffff',
          },
      divider: isDark ? alpha('#94a3b8', 0.12) : alpha('#0f172a', 0.08),
      text: isDark
        ? {
            primary: '#e8eef4',
            secondary: '#94a3b8',
            disabled: alpha('#e8eef4', 0.38),
          }
        : {
            primary: '#0f172a',
            secondary: '#64748b',
            disabled: alpha('#0f172a', 0.38),
          },
      success: { main: isDark ? '#34d399' : '#059669' },
      error: { main: isDark ? '#f87171' : '#dc2626' },
      warning: { main: '#fbbf24' },
      info: { main: '#38bdf8' },
      action: isDark
        ? {
            active: alpha('#e8eef4', 0.72),
            hover: alpha('#e8eef4', 0.06),
            selected: alpha(accent, 0.14),
            disabled: alpha('#e8eef4', 0.28),
            disabledBackground: alpha('#e8eef4', 0.08),
          }
        : {
            active: alpha('#0f172a', 0.56),
            hover: alpha('#0f172a', 0.04),
            selected: alpha(accentLightMode, 0.12),
            disabled: alpha('#0f172a', 0.26),
            disabledBackground: alpha('#0f172a', 0.06),
          },
    },
    shape: sharedShape,
    typography: sharedTypography,
    components: {
      MuiCssBaseline: {
        styleOverrides: bodyStyleOverrides(mode),
      },
      MuiAppBar: {
        defaultProps: {
          elevation: 0,
          color: 'inherit',
        },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            borderBottom: `1px solid ${theme.palette.divider}`,
            backdropFilter: 'blur(12px)',
          }),
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            borderRight: `1px solid ${theme.palette.divider}`,
          }),
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: 'none',
          }),
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 10,
          },
          containedPrimary: {
            boxShadow: `0 2px 12px ${alpha(primaryMain, 0.35)}`,
            '&:hover': {
              boxShadow: `0 4px 18px ${alpha(primaryMain, 0.45)}`,
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            '&.Mui-selected': {
              backgroundColor: alpha(theme.palette.primary.main, 0.16),
              '&:hover': {
                backgroundColor: alpha(theme.palette.primary.main, 0.22),
              },
            },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: 'outlined',
        },
      },
    },
  });
}
