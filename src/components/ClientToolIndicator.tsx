import type { FC } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser';
import TerminalIcon from '@mui/icons-material/Terminal';

export type ClientToolKind = 'browser' | 'docker';

/** Shown while Tauri runs a local client tool (not the same as model streaming / TypingIndicator). */
export const ClientToolIndicator: FC<{ kind: ClientToolKind; label: string }> = ({ kind, label }) => (
  <Box
    component="span"
    role="status"
    aria-label={label}
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 1.25,
      py: 0.75,
      px: 0.25,
    }}
  >
    {kind === 'browser' ? (
      <OpenInBrowserIcon sx={{ fontSize: 20, color: 'primary.main', opacity: 0.9 }} />
    ) : (
      <TerminalIcon sx={{ fontSize: 20, color: 'primary.main', opacity: 0.9 }} />
    )}
    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
      {label}
    </Typography>
    <CircularProgress size={14} thickness={5} sx={{ color: 'primary.main' }} />
  </Box>
);
