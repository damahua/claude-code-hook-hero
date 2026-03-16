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

const EVENT_COLORS: Record<string, string> = {
  'tool_start:Read': '#00ff80',
  'tool_start:Glob': '#00ff80',
  'tool_start:Grep': '#00ff80',
  'tool_end:Read': '#00ff80',
  'tool_end:Glob': '#00ff80',
  'tool_end:Grep': '#00ff80',
  'tool_start:Edit': '#00bfff',
  'tool_start:Write': '#00bfff',
  'tool_end:Edit': '#00bfff',
  'tool_end:Write': '#00bfff',
  'tool_start:Bash': '#ffff00',
  'tool_end:Bash': '#ffff00',
  'tool_start:Agent': '#ff00ff',
  'tool_end:Agent': '#ff00ff',
  'tool_failure': '#ff3333',
  'subagent_start': '#ff00ff',
  'subagent_stop': '#8800aa',
  'compact_start': '#ff8800',
  'compact_end': '#ff8800',
  'user_prompt': '#ffffff',
  'agent_stop': '#00ffff',
  'session_start': '#00ff00',
  'session_end': '#888888',
};

const BLOCK_CHARS = {
  full: '█',
  threequarter: '▓',
  half: '▒',
  quarter: '░',
  dot: '●',
  ring: '○',
  spinning: ['◐', '◓', '◑', '◒'],
  pulse: ['●', '◉', '○', '◉'],
  gap: ' ',
};

function getEventColor(event: StreamEvent): string {
  if (event.event === 'tool_failure') return EVENT_COLORS['tool_failure'];
  const key = `${event.event}:${event.tool || ''}`;
  return EVENT_COLORS[key] || EVENT_COLORS[event.event] || '#555';
}

function getEventBlock(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '▓';
  if (event.event === 'user_prompt') return '▪';
  if (event.event === 'agent_stop') return '◆';
  if (event.event === 'compact_start') return '⟐';
  if (event.event.startsWith('subagent')) return '◈';
  if (event.event === 'tool_start') return '█';
  if (event.event === 'tool_end') return '▓';
  return '░';
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

interface StreamRowProps {
  stream: AgentStream;
  maxWidth: number;
}

function StreamRow({ stream, maxWidth }: StreamRowProps) {
  const [spinFrame, setSpinFrame] = useState(0);

  useEffect(() => {
    if (!stream.active) return;
    const timer = setInterval(() => {
      setSpinFrame(f => (f + 1) % 4);
    }, 150);
    return () => clearInterval(timer);
  }, [stream.active]);

  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const indicator = stream.done
    ? '○'
    : stream.type === 'subagent'
      ? BLOCK_CHARS.spinning[spinFrame]
      : BLOCK_CHARS.pulse[spinFrame];
  const indicatorColor = stream.done ? '#555' : stream.type === 'subagent' ? '#00ffff' : '#00ff00';

  // Build the event bar — show last N events that fit
  const barWidth = Math.max(10, maxWidth - 4);
  const recentEvents = stream.events.slice(-barWidth);

  // Pad with gaps if fewer events than bar width
  const paddingCount = Math.max(0, barWidth - recentEvents.length);

  const toolEntries = Object.entries(stream.toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text color={indicatorColor} bold>{indicator} </Text>
        <Text color={stream.type === 'main' ? '#00ffff' : '#ff00ff'} bold>
          {stream.label}
        </Text>
        <Text color="#555"> </Text>
        <Text color="#888">{formatDuration(elapsed)}</Text>
        {stream.done && <Text color="#00ff80"> ✓</Text>}
        {stream.failures > 0 && <Text color="#ff3333"> ⚠{stream.failures}</Text>}
      </Box>
      <Box>
        <Text color="#333">{'  '}</Text>
        {Array(paddingCount).fill(0).map((_, i) => (
          <Text key={`pad-${i}`} color="#1a1a1a">{'░'}</Text>
        ))}
        {recentEvents.map((ev, i) => (
          <Text key={i} color={getEventColor(ev)}>{getEventBlock(ev)}</Text>
        ))}
        {stream.active && (
          <Text color={indicatorColor}>{BLOCK_CHARS.pulse[spinFrame]}</Text>
        )}
      </Box>
      <Box>
        <Text color="#333">{'  '}</Text>
        {toolEntries.map(([name, count], i) => (
          <React.Fragment key={name}>
            {i > 0 && <Text color="#333"> </Text>}
            <Text color={EVENT_COLORS[`tool_start:${name}`] || '#aaa'} dimColor>{name}</Text>
            <Text color="#555">({count})</Text>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

interface EventStreamProps {
  streams: AgentStream[];
  width?: number;
}

export function EventStream({ streams, width = 55 }: EventStreamProps) {
  if (streams.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor="#333"
        paddingX={1}
        flexDirection="column"
      >
        <Text color="#ff0080" bold>📡 Live Streams</Text>
        <Box marginTop={1} justifyContent="center">
          <Text color="#555" italic>waiting for events...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor="#ff0080"
      paddingX={1}
      flexDirection="column"
    >
      <Text color="#ff0080" bold>📡 Live Streams</Text>
      <Box flexDirection="column" marginTop={0} gap={0}>
        {streams.map(stream => (
          <StreamRow key={stream.id} stream={stream} maxWidth={width} />
        ))}
      </Box>
    </Box>
  );
}

export type { AgentStream };
