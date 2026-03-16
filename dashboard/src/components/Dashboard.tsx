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
  return `${m}m${s % 60}s`;
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
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);

  return (
    <Box flexDirection="column">
      <Header mode={mode} />

      {/* Timestamp bar */}
      <Box>
        <Text color="#050">[{ts}] </Text>
        <Text color="#070">uptime:</Text>
        <Text color="#0a0">{formatUptime(elapsed)} </Text>
        <Text color="#070">active:</Text>
        <Text color={activeStreams > 0 ? '#0f0' : '#050'}>{activeStreams} </Text>
        <Text color="#070">sessions:</Text>
        <Text color="#0a0">{data.totalSessions}</Text>
      </Box>

      {/* Stats panels */}
      <Box>
        <Panel title="sys" width={halfWidth}>
          <StatRow label="channels" value={data.channels.join(',') || 'none'} />
          <StatRow label="repos" value={data.repos.length > 0 ? data.repos.join(',') : 'none'} />
          <StatRow label="tokens" value={formatTokens(data.totalTokens)} highlight />
          <StatRow label="cost" value={formatCost(data.totalCost)} highlight />
        </Panel>
        <Panel title="ops" width={halfWidth}>
          <StatRow label="tool_calls" value={data.totalTools} highlight />
          <StatRow label="failures" value={data.totalFailures} warn={data.totalFailures > 0} />
          <StatRow label="subagents" value={data.streams.filter(s => s.type === 'subagent').length} />
          <ToolBar tools={data.toolCounts} />
        </Panel>
      </Box>

      {/* Event streams */}
      <EventStream streams={data.streams} width={termWidth - 6} />

      {/* Footer */}
      <Box>
        <Text color="#030">{'─'.repeat(termWidth - 2)}</Text>
      </Box>
      <Box>
        <Text color="#050">hook-hero v1.0 | ctrl+c quit | ~/.claude/hook-hero/</Text>
      </Box>
    </Box>
  );
}
