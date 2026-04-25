import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Chat as ChatIcon,
  Forum as ForumIcon,
  Message as MessageIcon,
  SmartToy as SmartToyIcon,
  History as HistoryIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import {
  getChatStats,
  getRecentChats,
  getChatActivity,
  type ChatStats,
  type RecentChatRow,
  type ActivityItem,
} from '../api/dashboard';
import { listAgents } from '../api/chat';
import type { Agent } from '../types';

/** Bump when default announcement text changes so dismissed users see the new one. */
const ANNOUNCEMENT_LOCAL_ID = 'default-2026-04';

const ANNOUNCEMENT_DISMISS_KEY = 'aitaskmeta_dashboard_announcement_dismissed_id';
const LEGACY_ANNOUNCEMENT_DISMISS_KEY = 'sya_dashboard_announcement_dismissed_id';

function readAnnouncementDismissed(): boolean {
  try {
    if (localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) === ANNOUNCEMENT_LOCAL_ID) return true;
    if (localStorage.getItem(LEGACY_ANNOUNCEMENT_DISMISS_KEY) === ANNOUNCEMENT_LOCAL_ID) {
      localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, ANNOUNCEMENT_LOCAL_ID);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function writeAnnouncementDismissed(): void {
  try {
    localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, ANNOUNCEMENT_LOCAL_ID);
  } catch {
    /* ignore */
  }
}

const VB = { w: 1000, h: 260, padX: 40, padY: 28 };

function buildActivityDots(data: ActivityItem[]) {
  if (data.length === 0) return [] as { cx: number; cy: number }[];
  const max = Math.max(1, ...data.map((d) => d.count));
  const { w, h, padX, padY } = VB;
  const innerW = w - 2 * padX;
  const innerH = h - 2 * padY;
  const n = data.length;
  return data.map((d, i) => {
    const x = padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padY + innerH - (d.count / max) * innerH;
    return { cx: x, cy: y };
  });
}

function shortSessionId(sessionId: string): string {
  const s = (sessionId || '').trim();
  if (s.length <= 10) return s || '—';
  return `${s.slice(0, 8)}…`;
}

function AnnouncementTicker({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <Box
      sx={{
        position: 'relative',
        mb: 2,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: (th) => alpha(th.palette.error.main, 0.08),
        border: '1px solid',
        borderColor: (th) => alpha(th.palette.error.main, 0.35),
        minHeight: 40,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <IconButton
        size="small"
        onClick={onDismiss}
        aria-label="close announcement"
        sx={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 2,
          color: 'error.main',
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <Box sx={{ overflow: 'hidden', flex: 1, py: 1, pr: 5 }}>
        <Box
          sx={{
            display: 'inline-block',
            whiteSpace: 'nowrap',
            pl: '100%',
            animation: 'dashMarquee 18s ease-in-out infinite alternate',
            '@keyframes dashMarquee': {
              '0%': { transform: 'translateX(0)' },
              '100%': { transform: 'translateX(-100%)' },
            },
          }}
        >
          <Typography component="span" sx={{ color: 'error.main', fontWeight: 600, fontSize: '0.95rem' }}>
            {text}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const gradientId = React.useId().replace(/:/g, '');
  const [announcementHidden, setAnnouncementHidden] = useState(readAnnouncementDismissed);
  const [stats, setStats] = useState<ChatStats>({
    total_chats: 0,
    total_sessions: 0,
    total_messages: 0,
    total_agents: 0,
  });
  const [recentChats, setRecentChats] = useState<RecentChatRow[]>([]);
  const [activityData, setActivityData] = useState<ActivityItem[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    let anyFailed = false;
    try {
      try {
        setStats(await getChatStats());
      } catch {
        anyFailed = true;
      }
      try {
        setRecentChats(await getRecentChats());
      } catch {
        anyFailed = true;
      }
      try {
        setActivityData(await getChatActivity());
      } catch {
        anyFailed = true;
      }
      try {
        setAgents(await listAgents());
      } catch {
        anyFailed = true;
      }
      if (anyFailed) setError(t('errors.loadDashboardFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activityDots = useMemo(() => buildActivityDots(activityData), [activityData]);
  const activityLinePoints = useMemo(
    () => activityDots.map((p) => `${p.cx},${p.cy}`).join(' '),
    [activityDots],
  );
  const activityFillPoints = useMemo(() => {
    if (activityDots.length === 0) return '';
    const { h, padY } = VB;
    const innerH = h - 2 * padY;
    const yBottom = padY + innerH;
    const firstX = activityDots[0].cx;
    const lastX = activityDots[activityDots.length - 1].cx;
    const top = activityDots.map((p) => `${p.cx},${p.cy}`).join(' ');
    return `${firstX},${yBottom} ${top} ${lastX},${yBottom}`;
  }, [activityDots]);

  const displaySessionTitle = (chat: RecentChatRow) => {
    const raw = (chat.title || '').trim();
    if (raw) return raw;
    return `${t('dashboard.sessionPrimary')} · ${shortSessionId(chat.session_id)}`;
  };

  const goChat = (chat: RecentChatRow) => {
    const id = chat.agent_id >= 1 ? String(chat.agent_id) : '';
    if (id) navigate(`/agent/${id}`);
  };

  const goAgent = (a: Agent) => {
    navigate(`/agent/${a.id}`);
  };

  const dismissAnnouncement = () => {
    writeAnnouncementDismissed();
    setAnnouncementHidden(true);
  };

  const statCards = [
    { key: 'chats', label: t('dashboard.totalChats'), value: stats.total_chats, icon: <ChatIcon /> },
    { key: 'sessions', label: t('dashboard.totalSessions'), value: stats.total_sessions, icon: <ForumIcon /> },
    { key: 'messages', label: t('dashboard.totalMessages'), value: stats.total_messages, icon: <MessageIcon /> },
    { key: 'agents', label: t('dashboard.totalAgents'), value: stats.total_agents, icon: <SmartToyIcon /> },
  ];

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        {t('dashboard.title')}
      </Typography>

      {!announcementHidden && (
        <AnnouncementTicker text={t('dashboard.announcementTicker')} onDismiss={dismissAnnouncement} />
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: 2,
              mb: 2,
            }}
          >
            {statCards.map((c) => (
              <Card key={c.key} variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {c.label}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography variant="h4" fontWeight={600}>
                      {c.value}
                    </Typography>
                    <Box sx={{ color: 'primary.main', opacity: 0.85 }}>{c.icon}</Box>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {t('dashboard.chatActivity')}
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {activityData.length === 0 ? (
                <Typography color="text.secondary" textAlign="center" py={3}>
                  {t('dashboard.noData')}
                </Typography>
              ) : (
                <Box sx={{ width: '100%', overflow: 'hidden' }}>
                  <svg
                    viewBox={`0 0 ${VB.w} ${VB.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ width: '100%', height: 'auto', maxHeight: 220, display: 'block' }}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <g>
                      {activityFillPoints ? (
                        <polygon points={activityFillPoints} fill={`url(#${gradientId})`} />
                      ) : null}
                      <polyline
                        fill="none"
                        stroke={theme.palette.primary.main}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        points={activityLinePoints}
                      />
                      {activityDots.map((pt, idx) => (
                        <circle
                          key={`dot-${idx}`}
                          cx={pt.cx}
                          cy={pt.cy}
                          r={5}
                          fill={theme.palette.background.paper}
                          stroke={theme.palette.primary.main}
                          strokeWidth={2}
                        />
                      ))}
                    </g>
                  </svg>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${activityData.length}, minmax(0, 1fr))`,
                      gap: 0.5,
                      mt: 0.5,
                    }}
                  >
                    {activityData.map((item) => (
                      <Typography key={item.date} variant="caption" color="text.secondary" textAlign="center" noWrap>
                        {item.date}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 2,
              alignItems: 'stretch',
            }}
          >
            <Card variant="outlined" sx={{ borderRadius: 2, display: 'flex', flexDirection: 'column', minHeight: 280, maxHeight: 440 }}>
              <CardContent sx={{ py: 1.5, pb: 0 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {t('dashboard.recentChats')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('dashboard.recentChatsHint')}
                </Typography>
              </CardContent>
              <Divider />
              <List dense sx={{ flex: 1, overflow: 'auto', py: 0, maxHeight: 300 }}>
                {recentChats.length === 0 ? (
                  <ListItem>
                    <ListItemText primary={t('dashboard.noData')} primaryTypographyProps={{ color: 'text.secondary' }} />
                  </ListItem>
                ) : (
                  recentChats.map((chat) => (
                    <ListItem key={chat.session_id} disablePadding>
                      <ListItemButton onClick={() => goChat(chat)} sx={{ py: 1, alignItems: 'flex-start' }}>
                        <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}>
                          <HistoryIcon color="primary" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={displaySessionTitle(chat)}
                          primaryTypographyProps={{ noWrap: true }}
                          secondary={
                            <>
                              {t('nav.agents')}: {chat.agent_name} · {chat.updated_at}
                            </>
                          }
                          secondaryTypographyProps={{ component: 'span', variant: 'caption', sx: { display: 'block' } }}
                        />
                        <ChevronRightIcon sx={{ color: 'action.disabled', flexShrink: 0, mt: 0.5 }} fontSize="small" />
                      </ListItemButton>
                    </ListItem>
                  ))
                )}
              </List>
            </Card>

            <Card variant="outlined" sx={{ borderRadius: 2, display: 'flex', flexDirection: 'column', minHeight: 280, maxHeight: 440 }}>
              <CardContent sx={{ py: 1.5, pb: 0 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {t('dashboard.accessibleAgents')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('dashboard.accessibleAgentsHint')}
                </Typography>
              </CardContent>
              <Divider />
              <List dense sx={{ flex: 1, overflow: 'auto', py: 0, maxHeight: 300 }}>
                {agents.length === 0 ? (
                  <ListItem>
                    <ListItemText
                      primary={t('dashboard.noAgentsShort')}
                      primaryTypographyProps={{ color: 'text.secondary' }}
                    />
                  </ListItem>
                ) : (
                  agents.map((a) => (
                    <ListItem key={a.id} disablePadding>
                      <ListItemButton onClick={() => goAgent(a)} sx={{ py: 1, alignItems: 'flex-start' }}>
                        <ListItemIcon sx={{ minWidth: 36, mt: 0.25 }}>
                          <SmartToyIcon color="secondary" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={a.name}
                          primaryTypographyProps={{ noWrap: true }}
                          secondary={a.description?.trim() ? a.description : undefined}
                          secondaryTypographyProps={{ variant: 'caption', sx: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }}
                        />
                        <ChevronRightIcon sx={{ color: 'action.disabled', flexShrink: 0, mt: 0.5 }} fontSize="small" />
                      </ListItemButton>
                    </ListItem>
                  ))
                )}
              </List>
            </Card>
          </Box>
        </>
      )}
    </Box>
  );
};

export default DashboardPage;
