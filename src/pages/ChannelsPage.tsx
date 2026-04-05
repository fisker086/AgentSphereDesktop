import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Card,
  Switch,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  type SelectChangeEvent,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Send as SendIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { NotifyChannel, CreateChannelRequest } from '../api/channels';
import { listChannels, createChannel, updateChannel, deleteChannel, testChannel } from '../api/channels';

const ChannelsPage: React.FC = () => {
  const { t } = useTranslation();

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'lark':
        return t('channels.kindLark');
      case 'dingtalk':
        return t('channels.kindDingtalk');
      case 'wecom':
        return t('channels.kindWecom');
      default:
        return kind;
    }
  };
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateChannelRequest>({
    name: '',
    kind: 'lark',
    webhook_url: '',
    app_id: '',
    app_secret: '',
    extra_json: '{}',
    is_active: true,
  });

  useEffect(() => {
    void loadChannels();
  }, []);

  const loadChannels = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listChannels();
      setChannels(data);
    } catch (err) {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.kind) {
      setError(t('errors.validationFailed'));
      return;
    }
    try {
      if (editingId) {
        await updateChannel(editingId, form);
      } else {
        await createChannel(form);
      }
      setDialog(false);
      resetForm();
      void loadChannels();
    } catch (err) {
      setError(t('errors.saveFailed'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteChannel(id);
      void loadChannels();
    } catch (err) {
      setError(t('errors.deleteFailed'));
    }
  };

  const handleTest = async (id: number) => {
    try {
      await testChannel(id);
      alert(t('channels.channelTestSuccess'));
    } catch (err) {
      setError(t('channels.channelTestFailed'));
    }
  };

  const openDialog = (channel?: NotifyChannel) => {
    if (channel) {
      setEditingId(channel.id);
      setForm({
        name: channel.name,
        kind: channel.kind,
        webhook_url: channel.webhook_url || '',
        app_id: channel.app_id || '',
        app_secret: '',
        extra_json: channel.extra ? JSON.stringify(channel.extra, null, 2) : '{}',
        is_active: channel.is_active,
      });
    } else {
      resetForm();
    }
    setDialog(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      kind: 'lark',
      webhook_url: '',
      app_id: '',
      app_secret: '',
      extra_json: '{}',
      is_active: true,
    });
  };

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'transparent', p: 3 }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              {t('channels.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('channels.channelHelp')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton onClick={() => void loadChannels()} disabled={loading} aria-label={t('channels.refresh')}>
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => openDialog()}
            >
              {t('channels.createChannel')}
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <TableContainer>
            <Table size="medium">
              <TableHead>
                <TableRow sx={{ bgcolor: (th) => alpha(th.palette.primary.main, 0.08) }}>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.columnId')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.channelName')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.columnType')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.columnWebhook')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.secretConfigured')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('channels.columnStatus')}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{t('channels.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id} hover>
                    <TableCell>{channel.id}</TableCell>
                    <TableCell>{channel.name}</TableCell>
                    <TableCell>
                      <Chip label={kindLabel(channel.kind)} size="small" />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {channel.webhook_url || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={channel.has_app_secret ? t('channels.yes') : t('channels.no')}
                        size="small"
                        color={channel.has_app_secret ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={channel.is_active ? t('channels.active') : t('channels.inactive')}
                        size="small"
                        color={channel.is_active ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleTest(channel.id)} color="primary">
                        <SendIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => openDialog(channel)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(channel.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {channels.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                      <Typography color="text.secondary">{t('channels.noData')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        <Dialog open={dialog} onClose={() => setDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{editingId ? t('channels.editChannel') : t('channels.createChannel')}</DialogTitle>
          <DialogContent
            sx={{
              pt: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              // Outlined labels need room above the first field; avoids label/notch clipping against DialogTitle
              overflow: 'visible',
            }}
          >
            <TextField
              fullWidth
              label={t('channels.channelName')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <FormControl fullWidth>
              <InputLabel id="channel-form-kind" shrink>
                {t('channels.fieldKind')}
              </InputLabel>
              <Select
                labelId="channel-form-kind"
                label={t('channels.fieldKind')}
                value={form.kind}
                notched
                onChange={(e: SelectChangeEvent<string>) =>
                  setForm({ ...form, kind: e.target.value })
                }
              >
                <MenuItem value="lark">{t('channels.kindLark')}</MenuItem>
                <MenuItem value="dingtalk">{t('channels.kindDingtalk')}</MenuItem>
                <MenuItem value="wecom">{t('channels.kindWecom')}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label={t('channels.fieldWebhookUrl')}
              value={form.webhook_url}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              fullWidth
              label={t('channels.fieldAppId')}
              value={form.app_id}
              onChange={(e) => setForm({ ...form, app_id: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              fullWidth
              label={t('channels.fieldAppSecret')}
              type="password"
              value={form.app_secret}
              onChange={(e) => setForm({ ...form, app_secret: e.target.value })}
              helperText={editingId ? t('channels.appSecretLeaveBlank') : undefined}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              fullWidth
              label={t('channels.fieldExtraJson')}
              multiline
              minRows={3}
              value={form.extra_json}
              onChange={(e) => setForm({ ...form, extra_json: e.target.value })}
              slotProps={{
                inputLabel: { shrink: true },
                input: {
                  sx: {
                    alignItems: 'flex-start',
                    '& textarea': { boxSizing: 'border-box', py: 1.75 },
                  },
                },
              }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
              }
              label={t('channels.active')}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog(false)}>{t('login.cancel')}</Button>
            <Button onClick={handleSave} variant="contained">{t('login.save')}</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
};

export default ChannelsPage;
