import React from 'react';
import { Box, Text } from 'ink';

interface PanelProps {
  title: string;
  icon: string;
  color: string;
  children: React.ReactNode;
  width?: number | string;
}

export function Panel({ title, icon, color, children, width }: PanelProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Box>
        <Text color={color} bold>
          {icon} {title}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={0}>
        {children}
      </Box>
    </Box>
  );
}

interface StatRowProps {
  label: string;
  value: string | number;
  color?: string;
  dimLabel?: boolean;
}

export function StatRow({ label, value, color = 'white', dimLabel = true }: StatRowProps) {
  return (
    <Box>
      <Text color={dimLabel ? '#888' : 'white'}>{label}: </Text>
      <Text color={color} bold>{typeof value === 'number' ? value.toLocaleString() : value}</Text>
    </Box>
  );
}

interface ToolBarProps {
  tools: Record<string, number>;
}

const TOOL_COLORS: Record<string, string> = {
  Read: '#00ff80',
  Glob: '#00ff80',
  Grep: '#00ff80',
  Edit: '#00bfff',
  Write: '#00bfff',
  Bash: '#ffff00',
  Agent: '#ff00ff',
  WebFetch: '#ff8000',
};

export function ToolBar({ tools }: ToolBarProps) {
  const entries = Object.entries(tools).sort((a, b) => b[1] - a[1]);
  return (
    <Box flexWrap="wrap" gap={1}>
      {entries.map(([name, count]) => (
        <Box key={name}>
          <Text color={TOOL_COLORS[name] || '#aaa'} bold>{name}</Text>
          <Text color="#666">({count})</Text>
        </Box>
      ))}
    </Box>
  );
}
