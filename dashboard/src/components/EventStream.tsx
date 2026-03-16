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

// Muted, professional palette for event blocks
function getBlockColor(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '#ef4444';
  if (event.event === 'user_prompt') return '#e2e8f0';
  if (event.event === 'agent_stop') return '#60a5fa';
  if (event.event === 'compact_start' || event.event === 'compact_end') return '#fbbf24';
  if (event.event.startsWith('subagent')) return '#c084fc';

  // Tool-based colors
  const tool = event.tool || '';
  if (['Read', 'Glob', 'Grep'].includes(tool)) return '#4ade80';
  if (['Edit', 'Write'].includes(tool)) return '#60a5fa';
  if (tool === 'Bash') return '#fbbf24';
  if (tool === 'Agent') return '#c084fc';
  return '#64748b';
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

  // Status indicator
  const statusIcon = stream.done
    ? '✓'
    : SPINNER[frame];
  const statusColor = stream.done ? '#4ade80' : '#60a5fa';

  // Build the event bar
  const barWidth = Math.max(10, maxWidth - 2);
  const recentEvents = stream.events.slice(-barWidth);
  const paddingCount = Math.max(0, barWidth - recentEvents.length);

  // Compact tool summary
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* Stream header line */}
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text color={stream.active ? '#e2e8f0' : '#64748b'} bold={stream.active}>
          {stream.label}
        </Text>
        <Text color="#444"> · </Text>
        <Text color="#64748b">{formatDuration(elapsed)}</Text>
        {totalTools > 0 && (
          <>
            <Text color="#444"> · </Text>
            <Text color="#64748b">{totalTools} calls</Text>
          </>
        )}
        {stream.failures > 0 && (
          <>
            <Text color="#444"> · </Text>
            <Text color="#ef4444">{stream.failures} failed</Text>
          </>
        )}
      </Box>

      {/* Event bar — flowing blocks */}
      <Box>
        <Text color="#1e1e1e">{'  '}</Text>
        <Text color="#1a1a2e">{'░'.repeat(paddingCount)}</Text>
        {recentEvents.map((ev, i) => (
          <Text key={i} color={getBlockColor(ev)}>
            {ev.event === 'tool_failure' ? '█' : '▓'}
          </Text>
        ))}
        {stream.active && <Text color="#60a5fa">{'▏'}</Text>}
      </Box>

      {/* Tool breakdown */}
      {toolEntries.length > 0 && (
        <Box>
          <Text color="#1e1e1e">{'  '}</Text>
          {toolEntries.map(([name, count], i) => (
            <React.Fragment key={name}>
              {i > 0 && <Text color="#333"> · </Text>}
              <Text color="#555">{name}</Text>
              <Text color="#444"> {count}</Text>
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
      borderColor="#333"
      paddingX={1}
      flexDirection="column"
    >
      <Text color="#666" bold>streams</Text>
      {streams.length === 0 ? (
        <Box justifyContent="center" paddingY={1}>
          <Text color="#444" italic>waiting for activity...</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0}>
          {streams.map(stream => (
            <StreamRow key={stream.id} stream={stream} maxWidth={width} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export type { AgentStream };
