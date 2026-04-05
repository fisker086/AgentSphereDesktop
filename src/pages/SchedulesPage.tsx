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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Tooltip,
  Alert,
  CircularProgress,
  Card,
  Avatar,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  PlayArrow as PlayIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Schedule as ScheduleIcon,
  Refresh as RefreshIcon,
  SmartToy as SmartToyIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Schedule, CreateScheduleRequest, Agent, ScheduleExecution } from '../types';
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  triggerSchedule,
  listScheduleExecutions,
} from '../api/schedules';
import { listAgents } from '../api/chat';

function scheduleKindLabel(kind: string, t: (key: string) => string): string {
  switch (kind) {
    case 'cron':
      return t('schedules.kindCron');
    case 'every':
      return t('schedules.kindEvery');
    case 'at':
      return t('schedules.kindAt');
    default:
      return kind;
  }
}

const SchedulesPage: React.FC = () => {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [executions, setExecutions] = useState<Record<number, ScheduleExecution[]>>({});
  const [error, setError] = useState('');

  const [form, setForm] = useState<CreateScheduleRequest>({
    name: '',
    description: '',
    agent_id: 0,
    schedule_kind: 'cron',
    cron_expr: '0 */6 * * *',
    timezone: 'UTC',
    wake_mode: 'now',
    session_target: 'main',
    prompt: '',
    enabled: true,
  });

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setAgentsLoading(true);
    try {
      const [schedulesData, agentsData] = await Promise.all([listSchedules(), listAgents()]);
      setSchedules(schedulesData);
      setAgents(agentsData);
    } catch {
      setError(t('errors.scheduleLoadFailed'));
    } finally {
      setAgentsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!form.name || !form.agent_id || !form.prompt) {
      setError(t('schedules.validationRequired'));
      return;
    }
    try {
      await createSchedule(form);
      setCreateDialog(false);
      resetForm();
      void loadData();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(msg || t('errors.scheduleCreateFailed'));
    }
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      void loadData();
    } catch {
      setError(t('errors.scheduleUpdateFailed'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSchedule(id);
      void loadData();
    } catch {
      setError(t('errors.scheduleDeleteFailed'));
    }
  };

  const handleTrigger = async (id: number) => {
    try {
      await triggerSchedule(id);
      const execs = await listScheduleExecutions(id);
      setExecutions((prev) => ({ ...prev, [id]: execs }));
    } catch {
      setError(t('errors.scheduleTriggerFailed'));
    }
  };

  const loadExecutions = async (id: number) => {
    try {
      const execs = await listScheduleExecutions(id);
      setExecutions((prev) => ({ ...prev, [id]: execs }));
    } catch {
      setError(t('errors.scheduleExecutionsLoadFailed'));
    }
  };

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      agent_id: 0,
      schedule_kind: 'cron',
      cron_expr: '0 */6 * * *',
      timezone: 'UTC',
      wake_mode: 'now',
      session_target: 'main',
      prompt: '',
      enabled: true,
    });
  };

  const handleFormChange = (field: string, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const filtered = schedules.filter((s) => !selectedAgent || s.agent_id === selectedAgent.id);

  return (
    <Box
      sx={{
        minHeight: '100%',
        bgcolor: 'transparent',
        p: 3,
      }}
    >
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 2,
            mb: 3,
          }}
        >
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Avatar
              sx={{
                width: 52,
                height: 52,
                borderRadius: 2,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                boxShadow: (t) => `0 8px 28px ${alpha(t.palette.primary.main, 0.4)}`,
              }}
            >
              <ScheduleIcon sx={{ fontSize: 28 }} />
            </Avatar>
            <Box>
              <Typography variant="h5" fontWeight={700} color="text.primary" letterSpacing="-0.02em">
                {t('schedules.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 480 }}>
                {t('schedules.subtitle')}
              </Typography>
            </Box>
            {agentsLoading && <CircularProgress size={22} sx={{ mt: 1 }} />}
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="sched-filter-agent">{t('schedules.filterByAgent')}</InputLabel>
              <Select
                labelId="sched-filter-agent"
                value={selectedAgent?.id ?? ''}
                label={t('schedules.filterByAgent')}
                onChange={(e: SelectChangeEvent<number | ''>) => {
                  const v = e.target.value;
                  if (v === '') {
                    setSelectedAgent(null);
                    return;
                  }
                  const agent = agents.find((a) => a.id === v);
                  setSelectedAgent(agent ?? null);
                }}
                sx={{
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                }}
              >
                <MenuItem value="">{t('schedules.allAgents')}</MenuItem>
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => void loadData()}
              disabled={agentsLoading}
              sx={{
                borderRadius: 2,
                borderColor: 'divider',
                color: 'text.secondary',
                textTransform: 'none',
              }}
            >
              {t('schedules.refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                resetForm();
                setCreateDialog(true);
              }}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                px: 2.5,
              }}
            >
              {t('schedules.newSchedule')}
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Card
          elevation={0}
          sx={{
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
            bgcolor: (t) => alpha(t.palette.background.paper, 0.72),
            backdropFilter: 'blur(10px)',
          }}
        >
          <TableContainer>
            <Table size="medium">
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
                    '& th': {
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      color: 'text.secondary',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      py: 2,
                    },
                  }}
                >
                  <TableCell>{t('schedules.name')}</TableCell>
                  <TableCell>{t('schedules.agent')}</TableCell>
                  <TableCell>{t('schedules.type')}</TableCell>
                  <TableCell>{t('schedules.expression')}</TableCell>
                  <TableCell>{t('schedules.prompt')}</TableCell>
                  <TableCell>{t('schedules.columnStatus')}</TableCell>
                  <TableCell align="right">{t('schedules.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((schedule) => (
                  <React.Fragment key={schedule.id}>
                    <TableRow
                      hover
                      sx={{
                        '&:last-child td': { borderBottom: executions[schedule.id] ? undefined : 0 },
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {schedule.name}
                        </Typography>
                        {schedule.description ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            {schedule.description}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <SmartToyIcon sx={{ fontSize: 18, color: 'action.active' }} />
                          <Typography variant="body2">
                            {schedule.agent_name || `Agent #${schedule.agent_id}`}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={scheduleKindLabel(schedule.schedule_kind, t)}
                          size="small"
                          color={
                            schedule.schedule_kind === 'cron'
                              ? 'primary'
                              : schedule.schedule_kind === 'every'
                                ? 'secondary'
                                : 'warning'
                          }
                          variant="outlined"
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          component="span"
                          sx={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            bgcolor: 'action.hover',
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            display: 'inline-block',
                          }}
                        >
                          {schedule.schedule_kind === 'cron' && schedule.cron_expr}
                          {schedule.schedule_kind === 'every' && `${schedule.every_ms ?? ''} ms`}
                          {schedule.schedule_kind === 'at' && schedule.at}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={schedule.prompt}
                        >
                          {schedule.prompt}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={schedule.enabled ? t('schedules.enabled') : t('schedules.disabled')}
                          size="small"
                          color={schedule.enabled ? 'success' : 'default'}
                          variant={schedule.enabled ? 'filled' : 'outlined'}
                          onClick={() => void handleToggleEnabled(schedule)}
                          sx={{ cursor: 'pointer', fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title={t('schedules.triggerNow')}>
                          <IconButton size="small" onClick={() => void handleTrigger(schedule.id)} color="primary">
                            <PlayIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('schedules.viewExecutions')}>
                          <IconButton size="small" onClick={() => void loadExecutions(schedule.id)}>
                            <ExpandMoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('schedules.delete')}>
                          <IconButton size="small" color="error" onClick={() => void handleDelete(schedule.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                    {executions[schedule.id] && (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ p: 0, borderBottom: 'none' }}>
                          <Box
                            sx={{
                              px: 2,
                              py: 2,
                              mx: 2,
                              mb: 2,
                              borderRadius: 2,
                              bgcolor: (t) => alpha(t.palette.background.default, 0.9),
                              border: '1px solid',
                              borderColor: 'divider',
                            }}
                          >
                            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5 }}>
                              {t('schedules.executionHistory')}
                            </Typography>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 600 }}>{t('schedules.startedAt')}</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>{t('schedules.runStatus')}</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>{t('schedules.duration')}</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>{t('schedules.result')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {executions[schedule.id]?.map((exec) => (
                                  <TableRow key={exec.id}>
                                    <TableCell>{new Date(exec.started_at).toLocaleString()}</TableCell>
                                    <TableCell>
                                      <Chip
                                        label={exec.status}
                                        size="small"
                                        color={exec.status === 'success' ? 'success' : 'error'}
                                        variant="outlined"
                                      />
                                    </TableCell>
                                    <TableCell>{(exec.duration_ms / 1000).toFixed(1)}s</TableCell>
                                    <TableCell sx={{ maxWidth: 360 }}>
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          display: 'block',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                        title={exec.result || exec.error}
                                      >
                                        {exec.result || exec.error}
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && !agentsLoading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 8, border: 'none' }}>
                      <ScheduleIcon sx={{ fontSize: 48, color: 'action.disabled', mb: 1 }} />
                      <Typography color="text.secondary" fontWeight={500}>
                        {t('schedules.noSchedules')}
                      </Typography>
                      <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
                        {t('schedules.noSchedulesHint')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        <Dialog
          open={createDialog}
          onClose={() => setCreateDialog(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: { borderRadius: 3, overflow: 'hidden' },
          }}
        >
          <DialogTitle
            sx={{
              fontWeight: 700,
              bgcolor: (t) => alpha(t.palette.primary.main, 0.08),
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {t('schedules.createTitle')}
          </DialogTitle>
          <DialogContent
            sx={{
              pt: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              overflow: 'visible',
            }}
          >
            <TextField
              fullWidth
              label={t('schedules.name')}
              value={form.name}
              onChange={(e) => handleFormChange('name', e.target.value)}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />

            <TextField
              fullWidth
              label={t('schedules.description')}
              value={form.description}
              onChange={(e) => handleFormChange('description', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />

            <FormControl fullWidth>
              <InputLabel id="sched-form-agent" shrink>
                {t('schedules.agent')}
              </InputLabel>
              <Select
                labelId="sched-form-agent"
                value={form.agent_id || ''}
                onChange={(e: SelectChangeEvent<number>) => handleFormChange('agent_id', e.target.value)}
                label={t('schedules.agent')}
                notched
              >
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="sched-form-type" shrink>
                {t('schedules.scheduleType')}
              </InputLabel>
              <Select
                labelId="sched-form-type"
                value={form.schedule_kind}
                onChange={(e: SelectChangeEvent<string>) => handleFormChange('schedule_kind', e.target.value)}
                label={t('schedules.scheduleType')}
                notched
              >
                <MenuItem value="cron">{t('schedules.kindCron')}</MenuItem>
                <MenuItem value="every">{t('schedules.kindEvery')}</MenuItem>
                <MenuItem value="at">{t('schedules.kindAt')}</MenuItem>
              </Select>
            </FormControl>

            {form.schedule_kind === 'cron' && (
              <TextField
                fullWidth
                label={t('schedules.cronExpression')}
                value={form.cron_expr}
                onChange={(e) => handleFormChange('cron_expr', e.target.value)}
                helperText={t('schedules.cronHelper')}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}

            {form.schedule_kind === 'every' && (
              <TextField
                fullWidth
                label={t('schedules.intervalMs')}
                type="number"
                value={form.every_ms ?? 3600000}
                onChange={(e) => handleFormChange('every_ms', parseInt(e.target.value, 10) || 0)}
                helperText={t('schedules.intervalHelper')}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}

            {form.schedule_kind === 'at' && (
              <TextField
                fullWidth
                label={t('schedules.runAt')}
                type="datetime-local"
                value={form.at || ''}
                onChange={(e) => handleFormChange('at', e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}

            <TextField
              fullWidth
              multiline
              minRows={3}
              label={t('schedules.prompt')}
              value={form.prompt}
              onChange={(e) => handleFormChange('prompt', e.target.value)}
              required
              helperText={t('schedules.promptHelper')}
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
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            <Button onClick={() => setCreateDialog(false)} sx={{ textTransform: 'none' }}>
              {t('schedules.cancel')}
            </Button>
            <Button onClick={() => void handleCreate()} variant="contained" sx={{ textTransform: 'none', px: 3 }}>
              {t('schedules.create')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
};

export default SchedulesPage;
