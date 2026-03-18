import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const LOGO = [
  ' ╦ ╦╔═╗╔═╗╦╔═  ╦ ╦╔═╗╦═╗╔═╗',
  ' ╠═╣║ ║║ ║╠╩╗  ╠═╣║╣ ╠╦╝║ ║',
  ' ╩ ╩╚═╝╚═╝╩ ╩  ╩ ╩╚═╝╩╚═╚═╝',
];

const SPARKLE = ['*', '+', '.', '*', '+', '.'];

export function Header({ mode }: { mode: 'live' | 'history' }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % SPARKLE.length), 400);
    return () => clearInterval(timer);
  }, []);

  const sparkle = SPARKLE[frame];

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box flexDirection="column">
        {LOGO.map((line, i) => (
          <Text key={i} color={['#58a6ff', '#d2a8ff', '#58a6ff'][i]} bold>{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="#30363d">{'─'.repeat(6)}</Text>
        <Text color="#d2a8ff"> {sparkle} </Text>
        {mode === 'live' ? (
          <Text color="#c9d1d9" bold>agent telemetry</Text>
        ) : (
          <Text color="#c9d1d9" bold>session replay</Text>
        )}
        <Text color="#d2a8ff"> {sparkle} </Text>
        <Text color="#30363d">{'─'.repeat(6)}</Text>
      </Box>
    </Box>
  );
}
