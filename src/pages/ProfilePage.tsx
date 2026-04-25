import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getAuthConfig, updateProfile, changePassword, fetchMe } from '../api/auth';
import { useAuth } from '../contexts/useAuth';

const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showChangePassword, setShowChangePassword] = useState(true);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await getAuthConfig();
        if (!cancelled) setShowChangePassword(cfg.auth_type === 'password');
        const me = await fetchMe();
        if (!cancelled) {
          setEmail(me.email);
          setFullName(me.full_name ?? '');
        }
      } catch {
        if (!cancelled) setError(t('profile.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const saveProfile = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateProfile({ email, full_name: fullName });
      await refreshUser();
      setSuccess(t('profile.profileUpdated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onChangePassword = async () => {
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      setError(t('profile.passwordFieldsHint'));
      return;
    }
    setPwdSaving(true);
    setError('');
    setSuccess('');
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setSuccess(t('profile.passwordChanged'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('profile.passwordChangeFailed'));
    } finally {
      setPwdSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 520 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
        {t('profile.title')}
      </Typography>
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
          {t('profile.basicInfo')}
        </Typography>
        <TextField
          fullWidth
          label={t('profile.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          margin="dense"
          sx={{ mb: 1 }}
        />
        <TextField
          fullWidth
          label={t('profile.fullName')}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          margin="dense"
          sx={{ mb: 2 }}
        />
        <Button variant="contained" disableElevation onClick={() => void saveProfile()} disabled={saving}>
          {saving ? <CircularProgress size={22} color="inherit" /> : t('profile.save')}
        </Button>
      </Paper>
      {showChangePassword && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            {t('profile.changePassword')}
          </Typography>
          <TextField
            fullWidth
            label={t('profile.currentPassword')}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            margin="dense"
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            label={t('profile.newPassword')}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            margin="dense"
            sx={{ mb: 2 }}
          />
          <Button variant="outlined" onClick={() => void onChangePassword()} disabled={pwdSaving}>
            {pwdSaving ? <CircularProgress size={22} /> : t('profile.submitPassword')}
          </Button>
        </Paper>
      )}
    </Box>
  );
};

export default ProfilePage;
