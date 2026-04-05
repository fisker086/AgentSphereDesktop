import type { FC } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';

const wave = keyframes`
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  30% {
    transform: translateY(-5px);
    opacity: 1;
  }
`;

/** Three bouncing dots shown while waiting for the first streamed token. */
export const TypingIndicator: FC = () => (
  <Box
    component="span"
    role="status"
    aria-label="Loading"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      py: 0.75,
      px: 0.25,
    }}
  >
    {[0, 1, 2].map((i) => (
      <Box
        key={i}
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: 'text.secondary',
          animation: `${wave} 1.05s ease-in-out infinite`,
          animationDelay: `${i * 0.14}s`,
        }}
      />
    ))}
  </Box>
);
