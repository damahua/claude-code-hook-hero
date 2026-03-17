import React from 'react';
import { Box, Text } from 'ink';
import { shortenToolName } from './Panel.js';
import type { AgentStream, StreamEvent } from './EventStream.js';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

function eventColor(ev: StreamEvent): string {
  if (ev.event === 'tool_failure') return '#f85149';
  if (ev.event === 'user_prompt') return '#79c0ff';
  if (ev.event === 'session_start') return '#3fb950';
  if (ev.event === 'session_end') return '#6e7681';
  if (ev.event.startsWith('subagent')) return '#d2a8ff';
  if (ev.event === 'compact_start' || ev.event === 'compact_end') return '#d29922';
  if (ev.event === 'tool_start') return '#2ea043';
  if (ev.event === 'tool_end') return '#3fb950';
  return '#6e7681';
}

function eventIcon(ev: StreamEvent): string {
  if (ev.event === 'tool_failure') return '✗';
  if (ev.event === 'user_prompt') return '▸';
  if (ev.event === 'session_start') return '◈';
  if (ev.event === 'session_end') return '◇';
  if (ev.event === 'tool_start') return '→';
  if (ev.event === 'tool_end') return '←';
  if (ev.event.startsWith('subagent')) return '⊕';
  return '·';
}

interface StreamDetailProps {
  stream: AgentStream;
  width: number;
  height: number;
  scrollOffset: number;
}

export function StreamDetail({ stream, width, height, scrollOffset }: StreamDetailProps) {
  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1]);

  // Calculate visible event window
  const headerLines = 6; // header + tool summary + separator
  const footerLines = 2;
  const availableLines = Math.max(5, height - headerLines - footerLines);
  const visibleEvents = stream.events.slice(scrollOffset, scrollOffset + availableLines);
  const totalEvents = stream.events.length;

  return (
    <Box flexDirection="column" height={height}>
      {/* Back hint + stream title */}
      <Box>
        <Text color="#484f58">esc </Text>
        <Text color="#30363d">│ </Text>
        <Text color="#d2a8ff" bold>{stream.label}</Text>
      </Box>

      {/* Stats */}
      <Box paddingLeft={2}>
        <Text color="#6e7681">status </Text>
        <Text color={stream.done ? '#3fb950' : stream.idle ? '#6e7681' : '#58a6ff'} bold>
          {stream.done ? 'done' : stream.idle ? 'idle' : 'active'}
        </Text>
        <Text color="#484f58"> │ </Text>
        <Text color="#6e7681">duration </Text>
        <Text color="#c9d1d9">{formatDuration(elapsed)}</Text>
        <Text color="#484f58"> │ </Text>
        <Text color="#6e7681">ops </Text>
        <Text color="#e6edf3" bold>{totalTools}</Text>
        {stream.failures > 0 && (
          <>
            <Text color="#484f58"> │ </Text>
            <Text color="#6e7681">err </Text>
            <Text color="#f85149" bold>{stream.failures}</Text>
          </>
        )}
        {stream.tokens && (stream.tokens.input > 0 || stream.tokens.output > 0) && (
          <>
            <Text color="#484f58"> │ </Text>
            <Text color="#6e7681">tok </Text>
            <Text color="#d29922" bold>{formatTokenCount(stream.tokens.input + stream.tokens.output)}</Text>
          </>
        )}
      </Box>

      {/* Token breakdown */}
      {stream.tokens && (stream.tokens.input > 0 || stream.tokens.output > 0) && (
        <Box paddingLeft={2}>
          <Text color="#6e7681">input </Text>
          <Text color="#c9d1d9">{formatTokenCount(stream.tokens.input)}</Text>
          <Text color="#30363d"> · </Text>
          <Text color="#6e7681">output </Text>
          <Text color="#c9d1d9">{formatTokenCount(stream.tokens.output)}</Text>
          <Text color="#30363d"> · </Text>
          <Text color="#6e7681">cache read </Text>
          <Text color="#c9d1d9">{formatTokenCount(stream.tokens.cache_read)}</Text>
          <Text color="#30363d"> · </Text>
          <Text color="#6e7681">cache write </Text>
          <Text color="#c9d1d9">{formatTokenCount(stream.tokens.cache_write)}</Text>
        </Box>
      )}

      {/* Tool breakdown */}
      {toolEntries.length > 0 && (
        <Box paddingLeft={2} flexWrap="wrap">
          {toolEntries.map(([name, count], i) => (
            <Box key={name} marginRight={1}>
              <Text color="#6e7681">{shortenToolName(name, 22)}</Text>
              <Text color="#484f58"> </Text>
              <Text color="#c9d1d9" bold>{count}</Text>
              {i < toolEntries.length - 1 && <Text color="#30363d"> · </Text>}
            </Box>
          ))}
        </Box>
      )}

      {/* Event list separator */}
      <Box>
        <Text color="#30363d">{'─'} </Text>
        <Text color="#c9d1d9" bold>events</Text>
        <Text color="#484f58"> ({totalEvents} total</Text>
        {scrollOffset > 0 && <Text color="#484f58">, showing {scrollOffset + 1}-{Math.min(scrollOffset + availableLines, totalEvents)}</Text>}
        <Text color="#484f58">)</Text>
        <Text color="#30363d"> {'─'.repeat(Math.max(1, width - 40))}</Text>
      </Box>

      {/* Scrollable event list */}
      <Box flexDirection="column" flexGrow={1}>
        {scrollOffset > 0 && (
          <Box paddingLeft={2}>
            <Text color="#484f58">↑ {scrollOffset} more above</Text>
          </Box>
        )}
        {visibleEvents.map((ev, i) => (
          <Box key={scrollOffset + i} paddingLeft={2}>
            <Text color="#484f58">{formatTime(ev.ts)} </Text>
            <Text color={eventColor(ev)}>{eventIcon(ev)} </Text>
            <Text color={eventColor(ev)}>{ev.event}</Text>
            {ev.tool && (
              <>
                <Text color="#484f58"> → </Text>
                <Text color="#8b949e">{shortenToolName(ev.tool, 30)}</Text>
              </>
            )}
            {ev.status && ev.status !== 'success' && (
              <Text color="#f85149"> ({ev.status})</Text>
            )}
            {ev.error && (
              <Text color="#f85149"> {ev.error.slice(0, 40)}</Text>
            )}
          </Box>
        ))}
        {scrollOffset + availableLines < totalEvents && (
          <Box paddingLeft={2}>
            <Text color="#484f58">↓ {totalEvents - scrollOffset - availableLines} more below</Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box>
        <Text color="#30363d">↑↓ scroll · esc back</Text>
      </Box>
    </Box>
  );
}
