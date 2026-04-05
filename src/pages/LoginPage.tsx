import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Alert,
  InputAdornment,
  IconButton,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Visibility,
  VisibilityOff,
  SmartToy,
  Refresh,
  Settings as SettingsIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  Language as LanguageIcon,
  PersonOutline,
  LockOutlined,
  PinOutlined,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import i18n from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { useThemeMode } from '../contexts/ThemeModeContext';
import { getCaptcha } from '../api/auth';
import { getServerUrl, saveServerUrl } from '../api/config';

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { mode, toggleMode } = useThemeMode();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const toggleLanguage = () => {
    void i18n.changeLanguage(i18n.language === 'en' ? 'zh' : 'en');
  };

  const fetchCaptcha = async () => {
    setCaptchaLoading(true);
    setError('');
    try {
      const data = await getCaptcha();
      setCaptchaToken(data.token);
      setCaptchaImage(data.image);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load captcha';
      setError(
        `${msg} — Check server URL (must match API, e.g. http://localhost:9000) and that /api/v1/auth/captcha is reachable.`
      );
      setCaptchaToken('');
      setCaptchaImage('');
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    void getServerUrl().then((url) => {
      setServerUrl(url);
      setUrlInput(url);
    });
    void fetchCaptcha();
  }, []);

  const openSettings = () => {
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    await saveServerUrl(urlInput);
    setServerUrl(urlInput);
    setSettingsOpen(false);
    void fetchCaptcha();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password, captchaToken, captchaCode);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 4,
        position: 'relative',
        overflow: 'hidden',
        background: (th) =>
          th.palette.mode === 'dark'
            ? `linear-gradient(145deg, ${alpha('#020617', 1)} 0%, ${th.palette.background.default} 50%, ${alpha('#0c4a6e', 0.25)} 100%)`
            : `linear-gradient(145deg, #ecfeff 0%, #f0fdfa 35%, #f8fafc 70%, #e0f2fe 100%)`,
      }}
    >
      {/* Background accents */}
      <Box
        sx={{
          position: 'absolute',
          width: { xs: 280, sm: 420 },
          height: { xs: 280, sm: 420 },
          borderRadius: '50%',
          filter: 'blur(80px)',
          opacity: (th) => (th.palette.mode === 'dark' ? 0.35 : 0.5),
          top: { xs: -100, sm: -120 },
          right: { xs: -120, sm: -100 },
          bgcolor: 'primary.main',
          pointerEvents: 'none',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: { xs: 240, sm: 360 },
          height: { xs: 240, sm: 360 },
          borderRadius: '50%',
          filter: 'blur(72px)',
          opacity: (th) => (th.palette.mode === 'dark' ? 0.28 : 0.45),
          bottom: { xs: -100, sm: -140 },
          left: { xs: -80, sm: -100 },
          bgcolor: 'info.main',
          pointerEvents: 'none',
        }}
      />

      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 16, right: 16, zIndex: 2 }}>
        <Tooltip title={t('nav.languageToggle')}>
          <IconButton
            onClick={toggleLanguage}
            aria-label={t('nav.languageToggle')}
            size="small"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: (th) => alpha(th.palette.background.paper, 0.85),
              backdropFilter: 'blur(8px)',
            }}
          >
            <LanguageIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={mode === 'dark' ? t('nav.themeUseLight') : t('nav.themeUseDark')}>
          <IconButton
            onClick={toggleMode}
            aria-label={t('nav.themeToggle')}
            size="small"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: (th) => alpha(th.palette.background.paper, 0.85),
              backdropFilter: 'blur(8px)',
            }}
          >
            {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          position: 'relative',
          zIndex: 1,
          p: { xs: 3, sm: 4 },
          width: '100%',
          maxWidth: 420,
          borderRadius: 3,
          border: '1px solid',
          borderColor: (th) => alpha(th.palette.divider, 0.9),
          bgcolor: (th) => alpha(th.palette.background.paper, th.palette.mode === 'dark' ? 0.75 : 0.92),
          backdropFilter: 'blur(16px)',
          boxShadow: (th) =>
            th.palette.mode === 'dark'
              ? `0 24px 48px ${alpha('#000', 0.45)}`
              : `0 25px 50px -12px ${alpha('#0f172a', 0.12)}, 0 0 0 1px ${alpha('#0f172a', 0.04)}`,
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Box
            sx={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 2.5,
              mx: 'auto',
              mb: 2,
              background: (th) =>
                `linear-gradient(145deg, ${th.palette.primary.main}, ${alpha(th.palette.primary.dark, 0.95)})`,
              boxShadow: (th) => `0 14px 32px ${alpha(th.palette.primary.main, 0.4)}`,
            }}
          >
            <SmartToy sx={{ fontSize: 40, color: 'primary.contrastText' }} />
            <Tooltip title={t('login.serverSettings')}>
              <IconButton
                size="small"
                onClick={openSettings}
                sx={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 30,
                  height: 30,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
                aria-label={t('login.serverSettings')}
              >
                <SettingsIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <Typography variant="h5" fontWeight={800} letterSpacing="-0.03em" gutterBottom>
            {t('app.name')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, mx: 'auto', lineHeight: 1.6 }}>
            {t('login.subtitle')}
          </Typography>
        </Box>

        <Box
          sx={{
            mb: 2,
            py: 0.75,
            px: 1.5,
            borderRadius: 2,
            bgcolor: (th) => alpha(th.palette.primary.main, 0.06),
            border: '1px solid',
            borderColor: (th) => alpha(th.palette.primary.main, 0.12),
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 500 }}>
            {t('login.server')}
          </Typography>
          <Typography
            variant="caption"
            component="div"
            sx={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '0.75rem',
              wordBreak: 'break-all',
              color: 'text.primary',
              mt: 0.25,
            }}
          >
            {serverUrl || '—'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('login.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            margin="dense"
            required
            autoComplete="username"
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <PersonOutline sx={{ color: 'action.active', fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />

          <TextField
            fullWidth
            label={t('login.password')}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="dense"
            required
            autoComplete="current-password"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlined sx={{ color: 'action.active', fontSize: 22 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small" aria-label="toggle password">
                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />

          <Box sx={{ display: 'flex', gap: 1.5, mt: 1, mb: 1, alignItems: 'stretch' }}>
            <TextField
              fullWidth
              label={t('login.captcha')}
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              required
              autoComplete="off"
              placeholder={t('login.captchaPlaceholder')}
              inputProps={{ maxLength: 4, inputMode: 'numeric', pattern: '[0-9]*' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <PinOutlined sx={{ color: 'action.active', fontSize: 20 }} />
                  </InputAdornment>
                ),
              }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Tooltip title={t('login.refreshCaptcha')}>
              <Box
                sx={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  width: 124,
                  height: 56,
                  alignSelf: 'center',
                  bgcolor: 'action.hover',
                  borderRadius: 2,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    boxShadow: (th) => `0 0 0 1px ${alpha(th.palette.primary.main, 0.35)}`,
                  },
                  '&:hover .refresh-overlay': { opacity: 1 },
                }}
                onClick={() => void fetchCaptcha()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void fetchCaptcha();
                }}
              >
                {captchaLoading ? (
                  <CircularProgress size={24} />
                ) : (
                  <Box
                    component="img"
                    src={captchaImage}
                    alt=""
                    sx={{ height: 40, maxWidth: '100%', objectFit: 'contain' }}
                  />
                )}
                <Box
                  className="refresh-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    bgcolor: 'rgba(0,0,0,0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <Refresh sx={{ color: 'common.white', fontSize: 22 }} />
                </Box>
              </Box>
            </Tooltip>
          </Box>

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disableElevation
            sx={{
              mt: 2,
              mb: 0,
              py: 1.35,
              borderRadius: 2,
              fontWeight: 700,
              fontSize: '0.95rem',
              textTransform: 'none',
              boxShadow: (th) => `0 8px 24px ${alpha(th.palette.primary.main, 0.35)}`,
            }}
            disabled={loading}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : t('login.signIn')}
          </Button>
        </form>
      </Paper>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('login.serverSettings')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('login.serverSettingsHint')}
          </Typography>
          <TextField
            fullWidth
            label={t('login.serverUrlLabel')}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:8080"
            helperText={t('login.server') + ': ' + serverUrl}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSettingsOpen(false)} sx={{ textTransform: 'none' }}>
            {t('login.cancel')}
          </Button>
          <Button onClick={() => void saveSettings()} variant="contained" disableElevation sx={{ textTransform: 'none', borderRadius: 2 }}>
            {t('login.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LoginPage;
