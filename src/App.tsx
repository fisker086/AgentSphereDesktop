import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import './i18n';
import LoginPage from './pages/LoginPage';
import Layout from './components/Layout';
import AgentsPage from './pages/AgentsPage';
import AgentDetailPage from './pages/AgentDetailPage';
import SchedulesPage from './pages/SchedulesPage';
import DashboardPage from './pages/DashboardPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ChannelsPage from './pages/ChannelsPage';
import SkillsPage from './pages/SkillsPage';
import ProfilePage from './pages/ProfilePage';
import { VersionCheckDialog, checkDesktopVersion, VersionInfo } from './api/version';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';

const ProtectedRoute: React.FC = () => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agent/:agentId" element={<AgentDetailPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
};

const App: React.FC = () => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const info = await checkDesktopVersion();
        if (info?.has_update) {
          setVersionInfo(info);
          setVersionDialogOpen(true);
        }
      } catch (error) {
        console.warn('Version check failed:', error);
      }
    };

    checkVersion();
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        {versionInfo?.has_update && (
          <Dialog open={versionDialogOpen} onClose={() => setVersionDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>发现新版本</DialogTitle>
            <DialogContent>
              <Box sx={{ pt: 1 }}>
                <Typography variant="body1" gutterBottom>
                  当前版本: {versionInfo.current_version}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  最新版本: {versionInfo.latest_version}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  有可用更新,请下载最新版本以获取新功能和修复。
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setVersionDialogOpen(false)}>稍后</Button>
              <Button onClick={() => window.open(versionInfo.download_url, '_blank')} variant="contained">
                下载更新
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;