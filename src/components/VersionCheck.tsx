import React, { useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';
import { checkDesktopVersion, VersionInfo } from '../api/version';

interface VersionCheckProps {
  open: boolean;
  versionInfo: VersionInfo;
  onClose: () => void;
}

export const VersionCheckDialog: React.FC<VersionCheckProps> = ({ open, versionInfo, onClose }) => {
  if (!versionInfo?.has_update) {
    return null;
  }

  const handleUpdate = () => {
    window.open(versionInfo.download_url, '_blank');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
        <Button onClick={onClose}>稍后</Button>
        <Button onClick={handleUpdate} variant="contained" autoFocus>
          下载更新
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const useVersionCheck = () => {
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const versionInfo = await checkDesktopVersion();
        if (versionInfo?.has_update) {
          console.log('New version available:', versionInfo.latest_version);
        }
      } catch (error) {
        console.warn('Version check failed:', error);
      }
    };

    checkVersion();
  }, []);
};