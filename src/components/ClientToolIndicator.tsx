import type { FC } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser';
import TerminalIcon from '@mui/icons-material/Terminal';

export type ClientToolKind = 'system';

const toolDisplayNames: Record<string, string> = {
  browser: '浏览器',
  docker_operator: 'Docker',
  git_operator: 'Git',
  file_parser: '文件解析',
};

function getToolDisplayName(toolName: string): string {
  const key = toolName.toLowerCase();
  return toolDisplayNames[key] || toolName;
}

/** Shown while Tauri runs a local client tool (not the same as model streaming / TypingIndicator). */
export const ClientToolIndicator: FC<{
  kind: ClientToolKind;
  label: string;
  toolName?: string;
  /** e.g. browser operation + url from tool params — updates each call */
  detail?: string;
}> = ({ label, toolName, detail }) => {
  const isBrowser = toolName?.toLowerCase() === 'browser';
  return (
    <Box
      component="span"
      role="status"
      aria-label={detail ? `${label}. ${detail}` : label}
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.5,
        py: 0.75,
        px: 0.25,
        maxWidth: '100%',
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        {isBrowser ? (
          <OpenInBrowserIcon sx={{ fontSize: 20, color: 'primary.main', opacity: 0.9 }} />
        ) : (
          <TerminalIcon sx={{ fontSize: 20, color: 'primary.main', opacity: 0.9 }} />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
          {toolName ? `${getToolDisplayName(toolName)} - ` : ''}{label}
        </Typography>
        <CircularProgress size={14} thickness={5} sx={{ color: 'primary.main' }} />
      </Box>
      {detail ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ pl: 3.5, wordBreak: 'break-all', lineHeight: 1.35 }}
        >
          {detail}
        </Typography>
      ) : null}
    </Box>
  );
};
