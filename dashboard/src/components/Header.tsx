import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const LOGO = [
  '  _  _         _      _  _                 ',
  ' | || |___  __|| |_   | || |___ _ _ ___    ',
  ' | __ / _ \\/ _ | / /   | __ / -_) \'_/ _ \\ ',
  ' |_||_\\___/\\___/_\\_\\   |_||_\\___|_| \\___/  ',
];

export function Header({ mode }: { mode: 'live' | 'history' }) {
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setBlink(b => !b), 500);
    return () => clearInterval(timer);
  }, []);

  const cursor = blink ? '█' : ' ';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {LOGO.map((line, i) => (
          <Text key={i} color="#0f0">{line}</Text>
        ))}
      </Box>
      <Box>
        <Text color="#0a0">{'>'} </Text>
        {mode === 'live' ? (
          <>
            <Text color="#0f0">agent_telemetry</Text>
            <Text color="#070"> --mode </Text>
            <Text color="#0f0">live</Text>
            <Text color="#070"> --watch</Text>
          </>
        ) : (
          <>
            <Text color="#0f0">agent_telemetry</Text>
            <Text color="#070"> --mode </Text>
            <Text color="#0f0">history</Text>
            <Text color="#070"> --replay</Text>
          </>
        )}
        <Text color="#0f0">{cursor}</Text>
      </Box>
    </Box>
  );
}
