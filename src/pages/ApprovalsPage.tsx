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
  Tabs,
  Tab,
  Alert,
  Card,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import {
  Refresh as RefreshIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  ViewList as ViewListIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ApprovalRequest } from '../types';
import { listApprovals, approveRequest, rejectRequest } from '../api/approvals';

const getRiskColor = (level: string): string => {
  switch (level) {
    case 'low': return 'success';
    case 'medium': return 'warning';
    case 'high': return 'error';
    case 'critical': return 'error';
    default: return 'default';
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'pending': return 'warning';
    case 'approved': return 'success';
    case 'rejected': return 'error';
    case 'expired': return 'default';
    default: return 'default';
  }
};

type ApprovalTab = 'pending' | 'approved' | 'rejected' | 'expired' | 'all';

const approvalsActionHeadCellSx = (theme: Theme) => ({
  position: 'sticky' as const,
  right: 0,
  zIndex: 3,
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
  minWidth: 168,
  textAlign: 'center' as const,
  bgcolor: alpha(theme.palette.primary.main, 0.08),
  boxShadow: `-6px 0 10px -4px ${alpha(theme.palette.common.black, 0.12)}`,
});

const approvalsActionBodyCellSx = (theme: Theme) => ({
  position: 'sticky' as const,
  right: 0,
  zIndex: 2,
  whiteSpace: 'nowrap' as const,
  minWidth: 168,
  bgcolor: 'background.paper',
  boxShadow: `-6px 0 10px -4px ${alpha(theme.palette.common.black, 0.12)}`,
  '.MuiTableRow-root:hover &': {
    bgcolor: theme.palette.action.hover,
  },
});

const ApprovalsPage: React.FC = () => {
  const { t, i18n } = useTranslation();

  const riskLabel = (level: string): string => {
    switch (level) {
      case 'low':
        return t('approvals.riskLow');
      case 'medium':
        return t('approvals.riskMedium');
      case 'high':
        return t('approvals.riskHigh');
      case 'critical':
        return t('approvals.riskCritical');
      default:
        return level;
    }
  };

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'pending':
        return t('approvals.statusPending');
      case 'approved':
        return t('approvals.statusApproved');
      case 'rejected':
        return t('approvals.statusRejected');
      case 'expired':
        return t('approvals.statusExpired');
      default:
        return status;
    }
  };

  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US');
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ApprovalTab>('pending');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [, setTotal] = useState(0);
  const [error, setError] = useState('');

  const [approveDialog, setApproveDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [detailDialog, setDetailDialog] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [rejectComment, setRejectComment] = useState('');

  useEffect(() => {
    void loadApprovals();
  }, [activeTab, page]);

  const loadApprovals = async () => {
    setLoading(true);
    setError('');
    try {
      const status = activeTab === 'all' ? undefined : activeTab;
      const result = await listApprovals({ status, page, page_size: pageSize });
      setApprovals(result.requests || []);
      setTotal(result.total || 0);
    } catch (err) {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedApproval) return;
    try {
      await approveRequest(selectedApproval.id, approveComment);
      setApproveDialog(false);
      setApproveComment('');
      void loadApprovals();
    } catch (err) {
      setError(t('errors.approveFailed'));
    }
  };

  const handleReject = async () => {
    if (!selectedApproval) return;
    try {
      await rejectRequest(selectedApproval.id, rejectComment);
      setRejectDialog(false);
      setRejectComment('');
      void loadApprovals();
    } catch (err) {
      setError(t('errors.rejectFailed'));
    }
  };

  const openApproveDialog = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setApproveComment('');
    setApproveDialog(true);
  };

  const openRejectDialog = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setRejectComment('');
    setRejectDialog(true);
  };

  const openDetail = (approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setDetailDialog(true);
  };

  const emptyLabel = (): string => {
    switch (activeTab) {
      case 'pending': return t('approvals.approvalEmptyPending');
      case 'approved': return t('approvals.approvalEmptyApproved');
      case 'rejected': return t('approvals.approvalEmptyRejected');
      case 'expired': return t('approvals.approvalEmptyExpired');
      default: return t('approvals.approvalEmptyAll');
    }
  };

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'transparent', p: 3 }}>
      <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              {t('approvals.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('approvals.subtitle')}
            </Typography>
          </Box>
          <IconButton onClick={() => void loadApprovals()} disabled={loading} aria-label={t('approvals.refresh')}>
            <RefreshIcon />
          </IconButton>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
          {t('approvals.approvalsBannerHint')}
        </Alert>

        <Card elevation={0} sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'visible' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => { setActiveTab(v); setPage(1); }}
            sx={{ bgcolor: 'action.hover', minHeight: 44 }}
          >
            <Tab value="pending" icon={<ScheduleIcon />} label={t('approvals.approvalTabPending')} />
            <Tab value="approved" icon={<CheckCircleIcon />} label={t('approvals.approvalTabApproved')} />
            <Tab value="rejected" icon={<CancelIcon />} label={t('approvals.approvalTabRejected')} />
            <Tab value="all" icon={<ViewListIcon />} label={t('approvals.approvalTabAll')} />
          </Tabs>

          <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
            <Table size="medium" sx={{ minWidth: 1080, tableLayout: 'auto' }}>
              <TableHead>
                <TableRow sx={{ bgcolor: (th) => alpha(th.palette.primary.main, 0.08) }}>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvals.columnId')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvals.columnTool')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvals.columnAgent')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvals.columnRisk')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('approvals.columnStatus')}</TableCell>
                  <TableCell sx={{ fontWeight: 600, minWidth: 200, maxWidth: 480 }}>{t('approvals.columnInput')}</TableCell>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t('approvals.columnTime')}</TableCell>
                  <TableCell sx={approvalsActionHeadCellSx}>{t('approvals.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {approvals.map((approval) => (
                  <TableRow key={approval.id} hover>
                    <TableCell>{approval.id}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{approval.tool_name}</TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap title={approval.agent_name || approval.agent_id.toString()}>
                        {approval.agent_name ?? `#${approval.agent_id}`}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={riskLabel(approval.risk_level)} size="small" color={getRiskColor(approval.risk_level) as any} />
                    </TableCell>
                    <TableCell>
                      <Chip label={statusLabel(approval.status)} size="small" color={getStatusColor(approval.status) as any} variant="outlined" />
                    </TableCell>
                    <TableCell sx={{ minWidth: 200, maxWidth: 480, verticalAlign: 'middle' }}>
                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={approval.input || undefined}>
                        {approval.input || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{formatDateTime(approval.created_at)}</TableCell>
                    <TableCell align="center" sx={approvalsActionBodyCellSx}>
                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'nowrap',
                          justifyContent: 'center',
                          alignItems: 'center',
                          gap: 0.5,
                        }}
                      >
                        {approval.status === 'pending' && approval.can_approve === true && (
                          <>
                            <Button
                              size="small"
                              color="success"
                              onClick={() => openApproveDialog(approval)}
                              sx={{ minWidth: 'auto', px: 1, py: 0.25, fontSize: '0.8125rem' }}
                            >
                              {t('approvals.approve')}
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              onClick={() => openRejectDialog(approval)}
                              sx={{ minWidth: 'auto', px: 1, py: 0.25, fontSize: '0.8125rem' }}
                            >
                              {t('approvals.reject')}
                            </Button>
                          </>
                        )}
                        <Button
                          size="small"
                          onClick={() => openDetail(approval)}
                          sx={{ minWidth: 'auto', px: 1, py: 0.25, fontSize: '0.8125rem' }}
                        >
                          {t('approvals.detail')}
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {approvals.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                      <Typography color="text.secondary">{emptyLabel()}</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        {/* Approve Dialog */}
        <Dialog open={approveDialog} onClose={() => setApproveDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('approvals.approveRequest')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldTool')}</Typography>
                <Typography variant="body2" fontWeight={600}>{selectedApproval?.tool_name}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldRisk')}</Typography>
                <Chip label={riskLabel(selectedApproval?.risk_level || '')} size="small" color={getRiskColor(selectedApproval?.risk_level || '') as any} />
              </Box>
            </Box>
            <TextField
              fullWidth
              multiline
              rows={2}
              label={t('approvals.comment')}
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setApproveDialog(false)}>{t('login.cancel')}</Button>
            <Button onClick={handleApprove} color="success" variant="contained">{t('approvals.approve')}</Button>
          </DialogActions>
        </Dialog>

        {/* Reject Dialog */}
        <Dialog open={rejectDialog} onClose={() => setRejectDialog(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('approvals.rejectRequest')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldTool')}</Typography>
                <Typography variant="body2" fontWeight={600}>{selectedApproval?.tool_name}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldRisk')}</Typography>
                <Chip label={riskLabel(selectedApproval?.risk_level || '')} size="small" color={getRiskColor(selectedApproval?.risk_level || '') as any} />
              </Box>
            </Box>
            <TextField
              fullWidth
              multiline
              rows={3}
              label={t('approvals.rejectReason')}
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectDialog(false)}>{t('login.cancel')}</Button>
            <Button onClick={handleReject} color="error" variant="contained">{t('approvals.reject')}</Button>
          </DialogActions>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={detailDialog} onClose={() => setDetailDialog(false)} maxWidth="md" fullWidth>
          <DialogTitle>{t('approvals.approvalDetail')}</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldTool')}</Typography>
                <Typography variant="body2">{selectedApproval?.tool_name}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldRisk')}</Typography>
                <Chip label={riskLabel(selectedApproval?.risk_level || '')} size="small" color={getRiskColor(selectedApproval?.risk_level || '') as any} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldStatus')}</Typography>
                <Chip label={statusLabel(selectedApproval?.status || '')} size="small" color={getStatusColor(selectedApproval?.status || '') as any} />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldAgentName')}</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {selectedApproval?.agent_name ?? `#${selectedApproval?.agent_id ?? ''}`}
                </Typography>
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldDesignatedApprovers')}</Typography>
                <Typography variant="body2">
                  {selectedApproval?.designated_approvers?.length
                    ? selectedApproval.designated_approvers.join(', ')
                    : '—'}
                </Typography>
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Typography variant="caption" color="text.secondary">{t('approvals.fieldInput')}</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedApproval?.input || '—'}
                </Typography>
              </Box>
              {selectedApproval?.comment && (
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <Typography variant="caption" color="text.secondary">{t('approvals.fieldComment')}</Typography>
                  <Typography variant="body2">{selectedApproval.comment}</Typography>
                </Box>
              )}
              {selectedApproval?.approver_id && (
                <Box>
                  <Typography variant="caption" color="text.secondary">{t('approvals.fieldApprover')}</Typography>
                  <Typography variant="body2">{selectedApproval.approver_id}</Typography>
                </Box>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailDialog(false)}>{t('approvals.close')}</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
};

export default ApprovalsPage;
