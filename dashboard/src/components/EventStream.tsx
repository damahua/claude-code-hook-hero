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

function getBlockChar(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '!';
  if (event.event === 'user_prompt') return '>';
  if (event.event === 'agent_stop') return '*';
  if (event.event === 'compact_start') return '#';
  if (event.event.startsWith('subagent')) return '@';
  if (event.event === 'tool_start') return '█';
  if (event.event === 'tool_end') return '▓';
  return '░';
}

function getBlockColor(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '#f00';
  if (event.event === 'user_prompt') return '#0f0';
  if (event.event === 'agent_stop') return '#0ff';
  if (event.event.startsWith('subagent')) return '#f0f';
  return '#0a0';
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem > 0 ? `${rem}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

const ACTIVITY = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

interface StreamRowProps {
  stream: AgentStream;
  maxWidth: number;
}

function StreamRow({ stream, maxWidth }: StreamRowProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!stream.active) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % ACTIVITY.length), 80);
    return () => clearInterval(timer);
  }, [stream.active]);

  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const pid = stream.id.slice(0, 6);

  const statusIcon = stream.done ? '+' : ACTIVITY[frame];
  const statusColor = stream.done ? '#050' : '#0f0';

  // Event bar
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
        <Text color={statusColor}>[{statusIcon}] </Text>
        <Text color="#050">pid:</Text>
        <Text color="#0a0">{pid} </Text>
        <Text color="#0a0">{stream.label}</Text>
        <Text color="#040"> {formatDuration(elapsed)}</Text>
        {totalTools > 0 && <Text color="#040"> {totalTools}ops</Text>}
        {stream.failures > 0 && <Text color="#f00"> {stream.failures}err</Text>}
        {stream.done && <Text color="#050"> [done]</Text>}
      </Box>

      <Box>
        <Text>{'    '}</Text>
        <Text color="#020">{'·'.repeat(paddingCount)}</Text>
        {recentEvents.map((ev, i) => (
          <Text key={i} color={getBlockColor(ev)}>{getBlockChar(ev)}</Text>
        ))}
        {stream.active && <Text color="#0f0">{'▌'}</Text>}
      </Box>

      {toolEntries.length > 0 && (
        <Box>
          <Text>{'    '}</Text>
          {toolEntries.map(([name, count], i) => (
            <React.Fragment key={name}>
              {i > 0 && <Text color="#030"> </Text>}
              <Text color="#050">{name}</Text>
              <Text color="#030">=</Text>
              <Text color="#0a0">{count}</Text>
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
      borderColor="#070"
      paddingX={1}
      flexDirection="column"
    >
      <Text color="#0a0" bold>[streams]</Text>
      {streams.length === 0 ? (
        <Box justifyContent="center" paddingY={1}>
          <Text color="#050">{'>'} listening on ~/.claude/hook-hero/ ...</Text>
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
