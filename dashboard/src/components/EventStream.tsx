import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export interface StreamEvent {
  ts: string;
  event: string;
  tool?: string;
  status?: string;
  error?: string;
  subagent_id?: string;
  subagent_type?: string;
}

interface AgentStream {
  id: string;
  label: string;
  type: 'main' | 'subagent';
  channel?: string;
  active: boolean;
  done: boolean;
  startTime: number;
  endTime?: number;
  events: StreamEvent[];
  toolCounts: Record<string, number>;
  failures: number;
}

function getBlockColor(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '#ef4444';
  if (event.event === 'user_prompt') return '#e2e8f0';
  if (event.event === 'agent_stop') return '#3b82f6';
  if (event.event === 'compact_start' || event.event === 'compact_end') return '#f59e0b';
  if (event.event.startsWith('subagent')) return '#a78bfa';
  return '#94a3b8';
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem > 0 ? ` ${rem}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface StreamRowProps {
  stream: AgentStream;
  maxWidth: number;
}

function StreamRow({ stream, maxWidth }: StreamRowProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!stream.active) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, [stream.active]);

  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const statusIcon = stream.done ? '✓' : SPINNER[frame];
  const statusColor = stream.done ? '#22c55e' : '#3b82f6';

  const barWidth = Math.max(10, maxWidth - 4);
  const recentEvents = stream.events.slice(-barWidth);
  const paddingCount = Math.max(0, barWidth - recentEvents.length);

  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text color={stream.active ? '#e2e8f0' : '#94a3b8'} bold={stream.active}>
          {stream.label}
        </Text>
        <Text color="#475569"> · </Text>
        <Text color="#94a3b8">{formatDuration(elapsed)}</Text>
        {totalTools > 0 && (
          <>
            <Text color="#475569"> · </Text>
            <Text color="#94a3b8">{totalTools} calls</Text>
          </>
        )}
        {stream.failures > 0 && (
          <>
            <Text color="#475569"> · </Text>
            <Text color="#ef4444">{stream.failures} failed</Text>
          </>
        )}
      </Box>

      <Box>
        <Text>{'  '}</Text>
        <Text color="#1e293b">{'░'.repeat(paddingCount)}</Text>
        {recentEvents.map((ev, i) => (
          <Text key={i} color={getBlockColor(ev)}>
            {ev.event === 'tool_failure' ? '█' : '▓'}
          </Text>
        ))}
        {stream.active && <Text color="#3b82f6">▏</Text>}
      </Box>

      {toolEntries.length > 0 && (
        <Box>
          <Text>{'  '}</Text>
          {toolEntries.map(([name, count], i) => (
            <React.Fragment key={name}>
              {i > 0 && <Text color="#334155"> · </Text>}
              <Text color="#64748b">{name}</Text>
              <Text color="#475569"> {count}</Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface EventStreamProps {
  streams: AgentStream[];
  width?: number;
}

export function EventStream({ streams, width = 55 }: EventStreamProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="#334155"
      paddingX={1}
      flexDirection="column"
    >
      <Text color="#94a3b8" bold>streams</Text>
      {streams.length === 0 ? (
        <Box justifyContent="center" paddingY={1}>
          <Text color="#475569" italic>waiting for activity...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {streams.map(stream => (
            <StreamRow key={stream.id} stream={stream} maxWidth={width} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export type { AgentStream };
