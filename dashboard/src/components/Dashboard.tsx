import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Header } from './Header.js';
import { Panel, StatRow, ToolBar } from './Panel.js';
import { EventStream } from './EventStream.js';
import type { TelemetryState } from '../hooks/useTelemetry.js';

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

interface DashboardProps {
  data: TelemetryState;
  mode: 'live' | 'history';
  date?: string;
}

export function Dashboard({ data, mode, date }: DashboardProps) {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;
  const halfWidth = Math.floor((termWidth - 2) / 2);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  const activeStreams = data.streams.filter(s => s.active).length;

  return (
    <Box flexDirection="column">
      <Header mode={mode} />

      <Box>
        <Panel title="session" width={halfWidth}>
          <StatRow label="sessions" value={data.totalSessions} highlight />
          <StatRow label="channels" value={data.channels.join(', ') || '—'} />
          <StatRow label="repos" value={data.repos.length > 0 ? data.repos.join(', ') : '—'} />
          {mode === 'live' && activeStreams > 0 && (
            <StatRow label="active" value={`${activeStreams} stream${activeStreams > 1 ? 's' : ''}`} highlight />
          )}
          {mode === 'live' && (
            <StatRow label="uptime" value={formatUptime(elapsed)} />
          )}
        </Panel>
        <Panel title="tools" width={halfWidth}>
          <StatRow label="total calls" value={data.totalTools} highlight />
          <StatRow label="failures" value={data.totalFailures} warn={data.totalFailures > 0} />
          <ToolBar tools={data.toolCounts} />
        </Panel>
      </Box>

      <Box>
        <Panel title="tokens" width={halfWidth}>
          <StatRow label="total" value={formatTokens(data.totalTokens)} highlight />
          <StatRow label="est. cost" value={formatCost(data.totalCost)} highlight />
        </Panel>
        <Panel title="agents" width={halfWidth}>
          <StatRow label="spawned" value={data.streams.filter(s => s.type === 'subagent').length} />
          <StatRow label="active" value={data.streams.filter(s => s.type === 'subagent' && s.active).length}
            highlight={data.streams.some(s => s.type === 'subagent' && s.active)} />
        </Panel>
      </Box>

      <EventStream streams={data.streams} width={termWidth - 6} />

      <Box justifyContent="center">
        <Text color="#334155">
          {'─'.repeat(6)} hook-hero{mode === 'live' ? ' · ctrl+c to quit' : ''} {'─'.repeat(6)}
        </Text>
      </Box>
    </Box>
  );
}
