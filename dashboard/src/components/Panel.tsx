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
      borderColor="#30363d"
      paddingX={1}
      paddingY={0}
      width={width}
    >
      <Text color="#8b949e" bold>{title}</Text>
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
  const valColor = warn ? '#f85149' : highlight ? '#c9d1d9' : '#8b949e';
  return (
    <Box>
      <Text color="#484f58">{label.padEnd(14)}</Text>
      <Text color={valColor} bold={highlight}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </Box>
  );
}

/** Shorten long tool names for display (e.g. mcp__Atlassian__getJiraIssue → Atlassian.getJiraIssue) */
function shortenToolName(name: string, maxLen: number = 20): string {
  // Strip mcp__ prefix and collapse double underscores to dots
  let short = name.replace(/^mcp__/, '').replace(/__/g, '.');
  if (short.length > maxLen) {
    short = short.slice(0, maxLen - 1) + '…';
  }
  return short;
}

interface ToolBarProps {
  tools: Record<string, number>;
  maxItems?: number;
}

export function ToolBar({ tools, maxItems = 6 }: ToolBarProps) {
  const entries = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, maxItems);
  if (entries.length === 0) return <Text color="#484f58">—</Text>;

  return (
    <Box flexWrap="wrap">
      {entries.map(([name, count], i) => (
        <Box key={name} marginRight={1}>
          <Text color="#8b949e">{shortenToolName(name)}</Text>
          <Text color="#484f58">{' '}</Text>
          <Text color="#c9d1d9" bold>{count}</Text>
          {i < entries.length - 1 && <Text color="#30363d"> {'·'} </Text>}
        </Box>
      ))}
    </Box>
  );
}

export { shortenToolName };
