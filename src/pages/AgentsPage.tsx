import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Avatar,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  SmartToy as SmartToyIcon,
  Refresh as RefreshIcon,
  Psychology as PsychologyIcon,
  Code as CodeIcon,
  Analytics as AnalyticsIcon,
  Brush as BrushIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../types';
import { listAgents } from '../api/chat';

const getCategoryIcon = (category: string) => {
  const c = category?.toLowerCase().trim() || '';
  const icons: Record<string, React.ReactNode> = {
    assistant: <PsychologyIcon />,
    coding: <CodeIcon />,
    analysis: <AnalyticsIcon />,
    creative: <BrushIcon />,
    general: <SmartToyIcon />,
    default: <SmartToyIcon />,
  };
  return icons[c] ?? icons.default;
};

const getCategoryColor = (category: string): 'primary' | 'secondary' | 'success' | 'warning' | 'info' => {
  const colors: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'info'> = {
    assistant: 'primary',
    coding: 'success',
    analysis: 'info',
    creative: 'secondary',
  };
  return colors[category?.toLowerCase()] || 'primary';
};

const getAgentAvatar = (category: string) => {
  const colors: Record<string, string> = {
    assistant: '#1976d2',
    coding: '#2e7d32',
    analysis: '#ed6c02',
    creative: '#9c27b0',
  };
  return colors[category?.toLowerCase()] || '#64748b';
};

const AgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const data = await listAgents();
      setAgents(data);
    } catch {
      setError(t('errors.loadAgentsFailed'));
    } finally {
      setLoading(false);
    }
  };

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
              <SmartToyIcon sx={{ fontSize: 28 }} />
            </Avatar>
            <Box>
              <Typography variant="h5" fontWeight={700} color="text.primary" letterSpacing="-0.02em">
                {t('agents.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 520 }}>
                {t('agents.subtitle')}
              </Typography>
            </Box>
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void loadAgents()}
            disabled={loading}
            sx={{
              borderRadius: 2,
              borderColor: 'divider',
              color: 'text.secondary',
              textTransform: 'none',
              px: 2,
            }}
          >
            {t('agents.refresh')}
          </Button>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              py: 14,
            }}
          >
            <CircularProgress size={40} sx={{ color: 'primary.main' }} />
          </Box>
        ) : agents.length === 0 ? (
          <Box
            sx={{
              textAlign: 'center',
              py: 10,
              px: 4,
              borderRadius: 3,
              border: '2px dashed',
              borderColor: 'divider',
              bgcolor: (t) => alpha(t.palette.background.paper, 0.55),
              backdropFilter: 'blur(10px)',
            }}
          >
            <Box
              sx={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <SmartToyIcon sx={{ fontSize: 44, color: 'primary.main', opacity: 0.9 }} />
            </Box>
            <Typography variant="h6" color="text.secondary" fontWeight={600} gutterBottom>
              {t('agents.noAgents')}
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ maxWidth: 360, mx: 'auto' }}>
              {t('agents.noAgentsHint')}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 3,
            }}
          >
            {agents.map((agent) => (
              <Card
                key={agent.id}
                elevation={0}
                sx={{
                  height: '100%',
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (t) => alpha(t.palette.background.paper, 0.65),
                  backdropFilter: 'blur(10px)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                  '&:hover': {
                    transform: 'translateY(-3px)',
                    boxShadow: (t) => `0 12px 36px ${alpha(t.palette.common.black, 0.45)}`,
                    borderColor: (t) => alpha(t.palette.primary.main, 0.45),
                  },
                }}
              >
                <CardActionArea
                  onClick={() => navigate(`/agent/${agent.id}`)}
                  sx={{
                    height: '100%',
                    p: 1,
                  }}
                >
                  <CardContent
                    sx={{
                      p: 2.5,
                      '&:last-child': { pb: 2.5 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2, position: 'relative' }}>
                      <Avatar
                        sx={{
                          width: 56,
                          height: 56,
                          bgcolor: getAgentAvatar(agent.category),
                          fontSize: 24,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                        }}
                      >
                        {getCategoryIcon(agent.category)}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="h6"
                          fontWeight={700}
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            letterSpacing: '-0.01em',
                          }}
                        >
                          {agent.name}
                        </Typography>
                        <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={agent.category || 'general'}
                            size="small"
                            color={getCategoryColor(agent.category)}
                            variant="outlined"
                            sx={{
                              fontWeight: 600,
                              fontSize: '0.75rem',
                            }}
                          />
                        </Box>
                      </Box>
                      <ChevronRightIcon
                        sx={{
                          color: 'action.disabled',
                          fontSize: 22,
                          mt: 0.5,
                          opacity: 0.6,
                        }}
                      />
                    </Box>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minHeight: 66,
                        lineHeight: 1.7,
                        mb: 2.5,
                      }}
                    >
                      {agent.description?.trim() || t('agents.noDescription')}
                    </Typography>

                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        pt: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Chip
                        label={agent.is_active ? t('agents.active') : t('agents.inactive')}
                        size="small"
                        color={agent.is_active ? 'success' : 'default'}
                        variant={agent.is_active ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          '& .MuiChip-label': {
                            px: 1,
                          },
                        }}
                      />
                      {agent.is_builtin && (
                        <Chip
                          label={t('agents.builtin')}
                          size="small"
                          variant="outlined"
                          sx={{
                            borderColor: 'divider',
                            color: 'text.secondary',
                            fontWeight: 600,
                          }}
                        />
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AgentsPage;
