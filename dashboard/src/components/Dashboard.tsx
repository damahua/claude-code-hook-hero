import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './Header.js';
import { Panel, StatRow, ToolBar } from './Panel.js';
import { EventStream } from './EventStream.js';
import type { TelemetryState } from '../hooks/useTelemetry.js';

const COST_COLOR = '#ffff00';
const TOKEN_COLOR = '#00ffff';
const TOOL_COLOR = '#00ff80';
const AGENT_COLOR = '#ff00ff';
const GIT_COLOR = '#ff8800';

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface DashboardProps {
  data: TelemetryState;
  mode: 'live' | 'history';
  date?: string;
}

export function Dashboard({ data, mode, date }: DashboardProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;
  const halfWidth = Math.floor((termWidth - 4) / 2);

  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => setUptime(u => u + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  const uptimeStr = mode === 'live'
    ? `${Math.floor(uptime / 60)}m ${uptime % 60}s`
    : undefined;

  return (
    <Box flexDirection="column">
      <Header mode={mode} />

      {/* Status bar */}
      <Box justifyContent="center" marginBottom={0}>
        <Text color="#333">{'─'.repeat(4)} </Text>
        {mode === 'live' ? (
          <>
            <Text color="#00ff00">● LIVE</Text>
            <Text color="#555"> · watching · </Text>
            <Text color="#888">{uptimeStr}</Text>
          </>
        ) : (
          <>
            <Text color="#00bfff">◆ HISTORY</Text>
            <Text color="#555"> · </Text>
            <Text color="#888">{date || 'today'}</Text>
          </>
        )}
        <Text color="#333"> {'─'.repeat(4)}</Text>
      </Box>

      {/* Top row: Session + Tools */}
      <Box>
        <Panel title="Session" icon="⏱" color="#00ffff" width={halfWidth}>
          <StatRow label="Sessions" value={data.totalSessions} color={TOKEN_COLOR} />
          <StatRow label="Channels" value={data.channels.join(', ') || '—'} color="#888" />
          <StatRow label="Repos" value={data.repos.join(', ') || '—'} color="#888" />
          {mode === 'live' && data.streams.filter(s => s.active).length > 0 && (
            <StatRow
              label="Active"
              value={`${data.streams.filter(s => s.active).length} streams`}
              color="#00ff00"
            />
          )}
        </Panel>
        <Panel title="Tools" icon="🔧" color={TOOL_COLOR} width={halfWidth}>
          <StatRow label="Total calls" value={data.totalTools} color={TOOL_COLOR} />
          <StatRow label="Failures" value={data.totalFailures} color={data.totalFailures > 0 ? '#ff3333' : '#555'} />
          <ToolBar tools={data.toolCounts} />
        </Panel>
      </Box>

      {/* Bottom row: Tokens + Agents */}
      <Box>
        <Panel title="Tokens & Cost" icon="💰" color={COST_COLOR} width={halfWidth}>
          <StatRow label="Total tokens" value={formatTokens(data.totalTokens)} color={TOKEN_COLOR} />
          <StatRow label="Est. cost" value={formatCost(data.totalCost)} color={COST_COLOR} />
        </Panel>
        <Panel title="Agents" icon="🤖" color={AGENT_COLOR} width={halfWidth}>
          <StatRow
            label="Subagents"
            value={data.streams.filter(s => s.type === 'subagent').length}
            color={AGENT_COLOR}
          />
          <StatRow
            label="Active"
            value={data.streams.filter(s => s.type === 'subagent' && s.active).length}
            color="#00ff00"
          />
        </Panel>
      </Box>

      {/* Event streams */}
      <EventStream streams={data.streams} width={termWidth - 6} />

      {/* Footer */}
      <Box justifyContent="center" marginTop={0}>
        <Text color="#333">{'─'.repeat(8)} </Text>
        <Text color="#555" italic>hook-hero</Text>
        <Text color="#333"> · </Text>
        <Text color="#555" italic>q to quit</Text>
        <Text color="#333"> {'─'.repeat(8)}</Text>
      </Box>
    </Box>
  );
}
