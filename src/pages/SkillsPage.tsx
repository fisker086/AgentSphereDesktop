import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Grid,
  Card,
  CardContent,
  Chip,
  Alert,
  Skeleton,
  TextField,
  InputAdornment,
  Pagination,
  Stack,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Refresh as RefreshIcon,
  Psychology as PsychologyIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { getSkills, type Skill } from '../api/skills';

const skillIcons: Record<string, string> = {
  browser: '🌐',
  docker_operator: '🐳',
  git_operator: '📦',
  system_monitor: '📊',
  cron_manager: '⏰',
  network_tools: '🌍',
  cert_checker: '🔐',
  nginx_diagnose: '🔧',
  dns_lookup: '🔍',
  ssh_executor: '💻',
  k8s_operator: '☸️',
  db_query: '🗄️',
  http_client: '📡',
  prometheus_query: '📈',
  grafana_reader: '📉',
  aws_readonly: '☁️',
  alert_sender: '🔔',
  slack_notify: '💬',
  jira_connector: '📋',
  github_issue: '🐙',
  file_parser: '📄',
  datetime: '📅',
  regex: '✏️',
  json_parser: ' JSON',
  csv_analyzer: '📊',
  log_analyzer: '📝',
  image_analyzer: '🖼️',
  terraform_plan: '🏗️',
  pdf_reader: '📕',
};

const getSkillIcon = (key: string): string => {
  const icon = skillIcons[key.replace('builtin_skill.', '')];
  return icon || '⚙️';
};

const getCategoryColor = (category: string): 'success' | 'info' | 'warning' | 'default' => {
  switch (category) {
    case 'safe':
      return 'success';
    case 'read_local':
      return 'info';
    case 'read_remote':
      return 'info';
    case 'write':
      return 'warning';
    default:
      return 'default';
  }
};

const getRiskColor = (risk: string): 'success' | 'warning' | 'error' | 'default' => {
  switch (risk) {
    case 'low':
      return 'success';
    case 'medium':
      return 'warning';
    case 'high':
      return 'error';
    case 'critical':
      return 'error';
    default:
      return 'default';
  }
};

const categoryTranslations: Record<string, { en: string; zh: string }> = {
  safe: { en: 'Safe', zh: '安全' },
  read_local: { en: 'Local Read', zh: '本地读取' },
  read_remote: { en: 'Remote Read', zh: '远程读取' },
  write: { en: 'Write', zh: '写入' },
};

const riskTranslations: Record<string, { en: string; zh: string }> = {
  low: { en: 'Low Risk', zh: '低风险' },
  medium: { en: 'Medium Risk', zh: '中等风险' },
  high: { en: 'High Risk', zh: '高风险' },
  critical: { en: 'Critical Risk', zh: '严重风险' },
};

const executionModeTranslations: Record<string, { en: string; zh: string }> = {
  client: { en: 'Client', zh: '本地执行' },
  server: { en: 'Server', zh: '服务端执行' },
};

const PAGE_SIZE = 12;

const SkillsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const isZh = i18n.language === 'zh';

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => {
      const shortKey = s.key.replace('builtin_skill.', '').toLowerCase();
      const name = (s.name || '').toLowerCase();
      const desc = (s.description || '').toLowerCase();
      return name.includes(q) || shortKey.includes(q) || desc.includes(q) || s.key.toLowerCase().includes(q);
    });
  }, [skills, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const paginatedSkills = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSkills.slice(start, start + PAGE_SIZE);
  }, [filteredSkills, page]);

  const rangeFrom = filteredSkills.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, filteredSkills.length);

  useEffect(() => {
    void loadSkills();
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSkills();
      setSkills(data);
    } catch (err) {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const translateCategory = (category: string) => {
    const trans = categoryTranslations[category];
    return trans ? (isZh ? trans.zh : trans.en) : category;
  };

  const translateRisk = (risk: string) => {
    const trans = riskTranslations[risk];
    return trans ? (isZh ? trans.zh : trans.en) : risk;
  };

  const translateExecutionMode = (mode: string) => {
    const trans = executionModeTranslations[mode];
    return trans ? (isZh ? trans.zh : trans.en) : mode;
  };

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'transparent', p: 3 }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              {t('skills.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('skills.subtitle')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <TextField
              size="small"
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              sx={{ width: { xs: '100%', sm: 280 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
              aria-label={t('skills.searchPlaceholder')}
            />
            <IconButton onClick={() => void loadSkills()} disabled={loading} aria-label={t('skills.refresh')}>
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Grid container spacing={2}>
            {[...Array(8)].map((_, i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Skeleton variant="rounded" height={180} />
              </Grid>
            ))}
          </Grid>
        ) : (
          <Grid container spacing={2}>
            {paginatedSkills.map((skill) => (
              <Grid key={skill.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Card
                  elevation={0}
                  sx={{
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    transition: 'all 0.2s ease-in-out',
                    '&:hover': {
                      borderColor: 'primary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: (th) => `0 4px 20px ${alpha(th.palette.primary.main, 0.15)}`,
                    },
                  }}
                >
                  <CardContent sx={{ p: 2.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
                      <Box
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: 2,
                          bgcolor: (th) => alpha(th.palette.primary.main, 0.1),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 24,
                          flexShrink: 0,
                        }}
                      >
                        {getSkillIcon(skill.key)}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Tooltip title={skill.name} placement="top-start" enterDelay={400} leaveDelay={0}>
                          <Typography
                            variant="subtitle1"
                            fontWeight={600}
                            color="text.primary"
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {skill.name}
                          </Typography>
                        </Tooltip>
                        <Tooltip title={skill.key} placement="top-start" enterDelay={400} leaveDelay={0}>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.75rem',
                            }}
                          >
                            {skill.key.replace('builtin_skill.', '')}
                          </Typography>
                        </Tooltip>
                      </Box>
                    </Box>

                    <Tooltip
                      title={skill.description?.trim() ? skill.description : t('skills.noDescription')}
                      placement="top-start"
                      enterDelay={400}
                      leaveDelay={0}
                      slotProps={{
                        tooltip: {
                          sx: { maxWidth: 360, whiteSpace: 'pre-wrap', typography: 'body2' },
                        },
                      }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          mb: 2,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          minHeight: 40,
                        }}
                      >
                        {skill.description || t('skills.noDescription')}
                      </Typography>
                    </Tooltip>

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      <Chip
                        size="small"
                        label={translateCategory(skill.category)}
                        color={getCategoryColor(skill.category)}
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }}
                      />
                      <Chip
                        size="small"
                        label={translateRisk(skill.risk_level)}
                        color={getRiskColor(skill.risk_level)}
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }}
                      />
                      <Chip
                        size="small"
                        label={translateExecutionMode(skill.execution_mode)}
                        variant="filled"
                        sx={{ fontSize: '0.7rem', bgcolor: (th) => alpha(th.palette.secondary.main, 0.1) }}
                      />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
            {skills.length === 0 && !loading && (
              <Grid size={12}>
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <PsychologyIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography color="text.secondary">{t('skills.noSkills')}</Typography>
                </Box>
              </Grid>
            )}
            {skills.length > 0 && filteredSkills.length === 0 && !loading && (
              <Grid size={12}>
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <SearchIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography color="text.secondary">{t('skills.noMatches')}</Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        )}

        {!loading && skills.length > 0 && filteredSkills.length > 0 && (
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} sx={{ mt: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {t('skills.range', { from: rangeFrom, to: rangeTo, total: filteredSkills.length })}
            </Typography>
            {totalPages > 1 && (
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                color="primary"
                size="small"
                showFirstButton
                showLastButton
                sx={{ '& .MuiPagination-ul': { flexWrap: 'wrap', justifyContent: 'center' } }}
              />
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
};

export default SkillsPage;