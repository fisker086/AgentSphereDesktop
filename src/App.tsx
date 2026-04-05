import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
        </Route>
      </Route>
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;