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
      borderColor="#333"
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text color="#666" bold>{title}</Text>
      <Box flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  accent?: boolean;
  warn?: boolean;
}

export function StatRow({ label, value, accent = false, warn = false }: StatRowProps) {
  const valueColor = warn ? '#ef4444' : accent ? '#e2e8f0' : '#94a3b8';
  return (
    <Box>
      <Text color="#555">{label.padEnd(14)}</Text>
      <Text color={valueColor} bold={accent}>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
    </Box>
  );
}

interface ToolBarProps {
  tools: Record<string, number>;
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#94a3b8',
  Glob: '#94a3b8',
  Grep: '#94a3b8',
  Edit: '#60a5fa',
  Write: '#60a5fa',
  Bash: '#fbbf24',
  Agent: '#c084fc',
  WebFetch: '#fb923c',
};

export function ToolBar({ tools }: ToolBarProps) {
  const entries = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) return <Text color="#444">—</Text>;

  return (
    <Box flexWrap="wrap">
      {entries.map(([name, count], i) => (
        <Box key={name} marginRight={1}>
          <Text color={TOOL_COLORS[name] || '#666'}>{name}</Text>
          <Text color="#444"> {count}</Text>
          {i < entries.length - 1 && <Text color="#333"> │</Text>}
        </Box>
      ))}
    </Box>
  );
}
