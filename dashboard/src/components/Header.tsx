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
          <Text key={i} color="#888" bold>{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="#444">{'─'.repeat(8)} </Text>
        {mode === 'live' ? (
          <>
            <Text color={pulse ? '#4ade80' : '#166534'}>●</Text>
            <Text color="#666"> live telemetry </Text>
          </>
        ) : (
          <>
            <Text color="#60a5fa">◆</Text>
            <Text color="#666"> session history </Text>
          </>
        )}
        <Text color="#444">{'─'.repeat(8)}</Text>
      </Box>
    </Box>
  );
}
