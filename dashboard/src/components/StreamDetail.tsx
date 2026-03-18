import React from 'react';
import { Box, Text } from 'ink';
import { shortenToolName } from './Panel.js';
import type { AgentStream, StreamEvent } from './EventStream.js';

export interface DebugEntry {
  ts: string;
  type: 'tool_input' | 'tool_result' | 'tool_error' | 'assistant_message' | 'thinking';
  tool?: string;
  tool_use_id?: string;
  input?: Record<string, any>;
  result?: any;
  error?: any;
  text?: string;
}

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
  debugEntries?: DebugEntry[];
}

export function StreamDetail({ stream, width, height, scrollOffset, debugEntries = [] }: StreamDetailProps) {
  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1]);

  // Merge events + debug entries into a unified timeline
  type TimelineItem = { ts: string; kind: 'event'; event: StreamEvent } | { ts: string; kind: 'debug'; entry: DebugEntry };
  const timeline: TimelineItem[] = [
    ...stream.events.map(e => ({ ts: e.ts, kind: 'event' as const, event: e })),
    ...debugEntries.map(d => ({ ts: d.ts, kind: 'debug' as const, entry: d })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const headerLines = 6;
  const footerLines = 2;
  const availableLines = Math.max(5, height - headerLines - footerLines);
  const visibleItems = timeline.slice(scrollOffset, scrollOffset + availableLines);
  const totalItems = timeline.length;

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

      {/* Timeline separator */}
      <Box>
        <Text color="#30363d">{'─'} </Text>
        <Text color="#c9d1d9" bold>timeline</Text>
        <Text color="#484f58"> ({totalItems} items</Text>
        {debugEntries.length > 0 && <Text color="#f59e0b">, {debugEntries.length} debug</Text>}
        {scrollOffset > 0 && <Text color="#484f58">, from {scrollOffset + 1}</Text>}
        <Text color="#484f58">)</Text>
        {stream.debugEnabled && <Text color="#f59e0b"> [DEBUG ON]</Text>}
        <Text color="#30363d"> {'─'.repeat(Math.max(1, width - 50))}</Text>
      </Box>

      {/* Scrollable timeline */}
      <Box flexDirection="column" flexGrow={1}>
        {scrollOffset > 0 && (
          <Box paddingLeft={2}>
            <Text color="#484f58">↑ {scrollOffset} more above</Text>
          </Box>
        )}
        {visibleItems.map((item, i) => {
          if (item.kind === 'event') {
            const ev = item.event;
            return (
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
            );
          } else {
            const d = item.entry;
            const maxLen = width - 30;
            return (
              <Box key={scrollOffset + i} paddingLeft={2} flexDirection="column">
                <Box>
                  <Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#f59e0b">{'◆'} </Text>
                  <Text color="#f59e0b">{d.type}</Text>
                  {d.tool && (
                    <>
                      <Text color="#484f58"> → </Text>
                      <Text color="#8b949e">{shortenToolName(d.tool, 30)}</Text>
                    </>
                  )}
                </Box>
                {d.type === 'tool_input' && d.input && (
                  <Box paddingLeft={4}>
                    <Text color="#6e7681" wrap="truncate-end">{JSON.stringify(d.input).slice(0, maxLen)}</Text>
                  </Box>
                )}
                {d.type === 'tool_result' && d.result && (
                  <Box paddingLeft={4}>
                    <Text color="#6e7681" wrap="truncate-end">{String(d.result).slice(0, maxLen)}</Text>
                  </Box>
                )}
                {d.type === 'tool_error' && d.error && (
                  <Box paddingLeft={4}>
                    <Text color="#f85149" wrap="truncate-end">{String(d.error).slice(0, maxLen)}</Text>
                  </Box>
                )}
                {d.type === 'thinking' && d.text && (
                  <Box paddingLeft={4}>
                    <Text color="#d2a8ff" wrap="truncate-end">{d.text.slice(0, maxLen)}</Text>
                  </Box>
                )}
                {d.type === 'assistant_message' && d.text && (
                  <Box paddingLeft={4}>
                    <Text color="#c9d1d9" wrap="truncate-end">{d.text.slice(0, maxLen)}</Text>
                  </Box>
                )}
              </Box>
            );
          }
        })}
        {scrollOffset + availableLines < totalItems && (
          <Box paddingLeft={2}>
            <Text color="#484f58">↓ {totalItems - scrollOffset - availableLines} more below</Text>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box>
        <Text color="#8b949e">↑↓</Text>
        <Text color="#484f58"> scroll </Text>
        <Text color="#8b949e">g/G</Text>
        <Text color="#484f58"> top/bottom </Text>
        <Text color="#8b949e">esc</Text>
        <Text color="#484f58"> back</Text>
      </Box>
    </Box>
  );
}
