import React from 'react';
import { Box, Text } from 'ink';

interface PanelProps {
  title: string;
  children: React.ReactNode;
  width?: number | string;
}

export function Panel({ title, children, width }: PanelProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="#070"
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text color="#0a0" bold>[{title}]</Text>
      <Box flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  highlight?: boolean;
  warn?: boolean;
}

export function StatRow({ label, value, highlight = false, warn = false }: StatRowProps) {
  const valColor = warn ? '#f00' : highlight ? '#0f0' : '#0a0';
  return (
    <Box>
      <Text color="#050">{label.padEnd(14)}</Text>
      <Text color={valColor} bold={highlight}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </Box>
  );
}

interface ToolBarProps {
  tools: Record<string, number>;
}

export function ToolBar({ tools }: ToolBarProps) {
  const entries = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) return <Text color="#050">nil</Text>;

  return (
    <Box flexWrap="wrap">
      {entries.map(([name, count], i) => (
        <Box key={name} marginRight={1}>
          <Text color="#0a0">{name}</Text>
          <Text color="#050">:</Text>
          <Text color="#0f0">{count}</Text>
          {i < entries.length - 1 && <Text color="#040"> | </Text>}
        </Box>
      ))}
    </Box>
  );
}
