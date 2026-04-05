import React, { useEffect } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Divider,
  Avatar,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  SmartToy as SmartToyIcon,
  Schedule as ScheduleIcon,
  Dashboard as DashboardIcon,
  Logout as LogoutIcon,
  Language as LanguageIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  VerifiedUser as VerifiedUserIcon,
  Notifications as NotificationsIcon,
  Psychology as PsychologyIcon,
} from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { reloadClientModeTools } from '../api/chat';
import { useThemeMode } from '../contexts/ThemeModeContext';
import { useTranslation } from 'react-i18next';

const drawerWidth = 240;

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, accessToken } = useAuth();

  useEffect(() => {
    if (accessToken) {
      void reloadClientModeTools();
    }
  }, [accessToken]);
  const { mode, toggleMode } = useThemeMode();
  const { t, i18n } = useTranslation();

  const handleLogout = () => {
    logout();
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(newLang);
  };

  const pages = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: <DashboardIcon />, path: '/dashboard' },
    { id: 'agents', label: t('nav.agents'), icon: <SmartToyIcon />, path: '/agents' },
    { id: 'skills', label: t('nav.skills'), icon: <PsychologyIcon />, path: '/skills' },
    { id: 'channels', label: t('nav.channels'), icon: <NotificationsIcon />, path: '/channels' },
    { id: 'schedules', label: t('nav.schedules'), icon: <ScheduleIcon />, path: '/schedules' },
    { id: 'approvals', label: t('nav.approvals'), icon: <VerifiedUserIcon />, path: '/approvals' },
  ];

  const isAgentChatRoute = location.pathname.startsWith('/agent/');

  const currentPage = location.pathname.startsWith('/agent')
    ? 'agents'
    : pages.find((p) => p.path === location.pathname)?.id || 'dashboard';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0}>
        <Toolbar sx={{ minHeight: 56 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.25,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: (th) => `0 0 16px ${th.palette.mode === 'dark' ? 'rgba(45,212,191,0.35)' : 'none'}`,
              }}
            >
              <SmartToyIcon sx={{ color: 'primary.contrastText', fontSize: 20 }} />
            </Box>
            <Typography variant="h6" fontWeight="bold" color="text.primary">
              AgentSphere
            </Typography>
          </Box>

          {isAgentChatRoute && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
              <Tooltip title={t('nav.dashboard')}>
                <IconButton size="small" onClick={() => navigate('/dashboard')} aria-label={t('nav.dashboard')}>
                  <DashboardIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('nav.agents')}>
                <IconButton size="small" color="primary" onClick={() => navigate('/')} aria-label={t('nav.agents')}>
                  <SmartToyIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('nav.schedules')}>
                <IconButton size="small" onClick={() => navigate('/schedules')} aria-label={t('nav.schedules')}>
                  <ScheduleIcon />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          <Box sx={{ flex: 1 }} />

          <Tooltip title={mode === 'dark' ? t('nav.themeUseLight') : t('nav.themeUseDark')}>
            <IconButton onClick={toggleMode} sx={{ mr: 0.5 }} aria-label={t('nav.themeToggle')}>
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title={t('nav.languageToggle')}>
            <IconButton onClick={toggleLanguage} sx={{ mr: 1 }} aria-label={t('nav.languageToggle')}>
              <LanguageIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {!isAgentChatRoute && (
          <Drawer
            variant="permanent"
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              alignSelf: 'stretch',
              '& .MuiDrawer-paper': {
                width: drawerWidth,
                boxSizing: 'border-box',
                borderRight: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                mt: 0,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
              },
            }}
          >
            <List sx={{ flex: 1, overflow: 'auto', pt: 2, px: 0.5 }}>
              {pages.map((page) => (
                <ListItem key={page.id} disablePadding sx={{ px: 1, py: 0.5 }}>
                  <ListItemButton
                    selected={currentPage === page.id}
                    onClick={() => navigate(page.path)}
                    sx={{
                      borderRadius: 2,
                      py: 1.5,
                      '&.Mui-selected': {
                        bgcolor: 'action.selected',
                        '&:hover': {
                          bgcolor: 'action.selected',
                        },
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 40,
                        color: currentPage === page.id ? 'primary.main' : 'text.secondary',
                      }}
                    >
                      {page.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={page.label}
                      primaryTypographyProps={{
                        fontWeight: currentPage === page.id ? 600 : 400,
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
            <Divider />
            <Box
              sx={{
                p: 2,
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: (th) => alpha(th.palette.background.default, 0.6),
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: 'primary.main',
                    fontSize: 16,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {user?.username?.charAt(0).toUpperCase() ?? '?'}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={user?.username}>
                    {user?.username ?? '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap title={user?.email ?? ''}>
                    {user?.email?.trim() ? user.email : '—'}
                  </Typography>
                </Box>
                <Tooltip title={t('nav.logout')}>
                  <IconButton
                    size="small"
                    color="secondary"
                    onClick={handleLogout}
                    aria-label={t('nav.logout')}
                  >
                    <LogoutIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Drawer>
        )}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default Layout;
