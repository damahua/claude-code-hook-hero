import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const HERO_ART = [
  '╔═══════════════════════════════════════════════════════════╗',
  '║  ██╗  ██╗ ██████╗  ██████╗ ██╗  ██╗                     ║',
  '║  ██║  ██║██╔═══██╗██╔═══██╗██║ ██╔╝                     ║',
  '║  ███████║██║   ██║██║   ██║█████╔╝                      ║',
  '║  ██╔══██║██║   ██║██║   ██║██╔═██╗                      ║',
  '║  ██║  ██║╚██████╔╝╚██████╔╝██║  ██╗                     ║',
  '║  ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝                     ║',
  '║  ██╗  ██╗███████╗██████╗  ██████╗                        ║',
  '║  ██║  ██║██╔════╝██╔══██╗██╔═══██╗                       ║',
  '║  ███████║█████╗  ██████╔╝██║   ██║                       ║',
  '║  ██╔══██║██╔══╝  ██╔══██╗██║   ██║                       ║',
  '║  ██║  ██║███████╗██║  ██║╚██████╔╝                       ║',
  '║  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝                       ║',
  '╚═══════════════════════════════════════════════════════════╝',
];

// Compact pixel art for the header
const PIXEL_HOOK = [
  ' ⚔️  ░█░█░█▀█░█▀█░█░█░  ░█░█░█▀▀░█▀▄░█▀█░  ⚔️',
  '     ░█▀█░█░█░█░█░█▀▄░  ░█▀█░█▀▀░█▀▄░█░█░    ',
  '     ░▀░▀░▀▀▀░▀▀▀░▀░▀░  ░▀░▀░▀▀▀░▀░▀░▀▀▀░    ',
];

const SPARKLE_FRAMES = ['✦', '✧', '✦', '⋆', '✧', '⋆'];
const SWORD_FRAMES = ['⚔️ ', '🗡️ ', '⚔️ ', '🛡️ '];

const neonColors = [
  '#ff0080', '#ff00ff', '#8000ff', '#0080ff',
  '#00ffff', '#00ff80', '#80ff00', '#ffff00',
] as const;

export function Header({ mode }: { mode: 'live' | 'history' }) {
  const [frame, setFrame] = useState(0);
  const [colorOffset, setColorOffset] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPARKLE_FRAMES.length);
      setColorOffset(c => (c + 1) % neonColors.length);
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const sparkle = SPARKLE_FRAMES[frame];

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      <Box flexDirection="column" alignItems="center">
        {PIXEL_HOOK.map((line, i) => (
          <Text key={i} color={neonColors[(i + colorOffset) % neonColors.length]} bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box marginTop={0}>
        <Text color="#555">{'─'.repeat(12)}</Text>
        <Text color="#ff0080"> {sparkle} </Text>
        <Text color="#00ffff" bold italic>
          {mode === 'live' ? 'agent telemetry' : 'session replay'}
        </Text>
        <Text color="#ff0080"> {sparkle} </Text>
        <Text color="#555">{'─'.repeat(12)}</Text>
      </Box>
    </Box>
  );
}
