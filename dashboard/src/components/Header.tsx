import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const LOGO = [
  ' ╦ ╦╔═╗╔═╗╦╔═  ╦ ╦╔═╗╦═╗╔═╗ ',
  ' ╠═╣║ ║║ ║╠╩╗  ╠═╣║╣ ╠╦╝║ ║ ',
  ' ╩ ╩╚═╝╚═╝╩ ╩  ╩ ╩╚═╝╩╚═╚═╝ ',
];

export function Header({ mode }: { mode: 'live' | 'history' }) {
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setPulse(p => !p), 800);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" alignItems="center" marginBottom={1}>
      <Box flexDirection="column" alignItems="center">
        {LOGO.map((line, i) => (
          <Text key={i} color="#e2e8f0">{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="#334155">{'─'.repeat(8)} </Text>
        {mode === 'live' ? (
          <>
            <Text color={pulse ? '#22c55e' : '#15803d'}>●</Text>
            <Text color="#94a3b8"> live telemetry </Text>
          </>
        ) : (
          <>
            <Text color="#3b82f6">◆</Text>
            <Text color="#94a3b8"> session history </Text>
          </>
        )}
        <Text color="#334155">{'─'.repeat(8)}</Text>
      </Box>
    </Box>
  );
}
