import React from 'react';
import { Box, Text } from 'ink';
import { shortenToolName } from './Panel.js';
import type { AgentStream, StreamEvent } from './EventStream.js';

export interface DebugEntry {
  ts: string;
  type: 'tool_input' | 'tool_result' | 'tool_error' | 'assistant_message' | 'thinking' | 'user_prompt';
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
  cursorIndex?: number;
  debugEntries?: DebugEntry[];
}

export function StreamDetail({ stream, width, height, scrollOffset, cursorIndex, debugEntries = [] }: StreamDetailProps) {
  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);
  const toolEntries = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1]);

  // Merge events + debug entries into a unified timeline, deduplicating
  type TimelineItem = { ts: string; kind: 'event'; event: StreamEvent } | { ts: string; kind: 'debug'; entry: DebugEntry };

  const seen = new Set<string>();
  const dedupEvent = (items: TimelineItem[]): TimelineItem[] => {
    const result: TimelineItem[] = [];
    for (const item of items) {
      const key = item.kind === 'event'
        ? `e|${item.ts}|${item.event.event}|${item.event.tool || ''}|${(item.event as any).tool_use_id || ''}`
        : `d|${item.ts}|${item.entry.type}|${item.entry.tool_use_id || ''}|${item.entry.tool || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  };

  const timeline: TimelineItem[] = dedupEvent([
    ...stream.events.map(e => ({ ts: e.ts, kind: 'event' as const, event: e })),
    ...debugEntries.map(d => ({ ts: d.ts, kind: 'debug' as const, entry: d })),
  ]).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

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
        {(() => {
          const isCli = stream.done && stream.promptCount <= 1;
          // Fix label if channel doesn't match prompt-based detection
          const correctedLabel = isCli
            ? stream.label.replace(/^claude-code/, 'claude-cli')
            : stream.label.replace(/^claude-cli/, 'claude-code');
          return (
            <>
              <Text color={isCli ? '#6e7681' : '#06b6d4'}>{isCli ? '$ ' : '# '}</Text>
              <Text color="#d2a8ff" bold>{correctedLabel}</Text>
            </>
          );
        })()}
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
          const absoluteIdx = scrollOffset + i;
          const isHighlighted = cursorIndex !== undefined && absoluteIdx === cursorIndex;
          const hlBg = isHighlighted ? '#1c2128' : undefined;
          const hlPrefix = isHighlighted ? '▸' : ' ';

          if (item.kind === 'event') {
            const ev = item.event;
            const hasDebug = debugEntries.length > 0;

            // When debug is ON, skip tool_start/tool_end — debug entries cover them
            if (hasDebug && (ev.event === 'tool_start' || ev.event === 'tool_end')) return null;

            // For non-debug tool_start, show summary inline
            const summary = ev.event === 'tool_start' ? ev.tool_input_summary : undefined;
            const summaryText = summary
              ? (summary.command || summary.file_path || summary.pattern || summary.url || summary.path || '')
              : '';
            const maxSummary = width - 50;
            const trimmed = summaryText.length > maxSummary ? summaryText.slice(0, maxSummary - 3) + '...' : summaryText;

            return (
              <Box key={scrollOffset + i} paddingLeft={1}>
                <Text color={isHighlighted ? '#d2a8ff' : '#30363d'}>{hlPrefix}</Text>
                <Text color="#484f58">{formatTime(ev.ts)} </Text>
                <Text color={eventColor(ev)}>{eventIcon(ev)} </Text>
                <Text color={eventColor(ev)} bold={isHighlighted}>{ev.event}</Text>
                {ev.tool && (
                  <>
                    <Text color="#484f58"> → </Text>
                    <Text color="#8b949e">{shortenToolName(ev.tool, 30)}</Text>
                  </>
                )}
                {trimmed && <Text color="#6e7681"> {trimmed}</Text>}
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

            // Compact tool_input: show as "→ Tool  command/path"
            const hl = <Text color={isHighlighted ? '#d2a8ff' : '#30363d'}>{hlPrefix}</Text>;

            if (d.type === 'tool_input') {
              const inp = d.input || {};
              const detail = (inp.command || inp.file_path || inp.pattern || inp.url || inp.path || '');
              const trimDetail = detail.length > maxLen ? detail.slice(0, maxLen - 3) + '...' : detail;
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#2ea043">{'→'} </Text>
                  <Text color="#8b949e" bold={isHighlighted}>{shortenToolName(d.tool || '', 12)}</Text>
                  {trimDetail && <Text color="#6e7681">  {trimDetail}</Text>}
                </Box>
              );
            }

            if (d.type === 'tool_result') {
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#3fb950">{'←'} </Text>
                  <Text color="#8b949e" bold={isHighlighted}>{shortenToolName(d.tool || '', 12)}</Text>
                  <Text color="#3fb950">  ok</Text>
                </Box>
              );
            }

            if (d.type === 'tool_error') {
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#f85149">{'✗'} </Text>
                  <Text color="#8b949e" bold={isHighlighted}>{shortenToolName(d.tool || '', 12)}</Text>
                  <Text color="#f85149">  {String(d.error).slice(0, maxLen)}</Text>
                </Box>
              );
            }

            if (d.type === 'user_prompt') {
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#79c0ff">{'▸'} </Text>
                  <Text color="#79c0ff" bold={isHighlighted}>prompt</Text>
                  {d.text && <Text color="#6e7681">  {d.text.slice(0, maxLen)}</Text>}
                </Box>
              );
            }

            if (d.type === 'thinking') {
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#d2a8ff">{'◇'} </Text>
                  <Text color="#d2a8ff" bold={isHighlighted}>thinking</Text>
                  {d.text && <Text color="#6e7681">  {d.text.slice(0, maxLen)}</Text>}
                </Box>
              );
            }

            if (d.type === 'assistant_message') {
              return (
                <Box key={scrollOffset + i} paddingLeft={1}>
                  {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                  <Text color="#c9d1d9">{'◈'} </Text>
                  <Text color="#c9d1d9" bold={isHighlighted}>response</Text>
                  {d.text && <Text color="#6e7681">  {d.text.slice(0, maxLen)}</Text>}
                </Box>
              );
            }

            // Fallback
            return (
              <Box key={scrollOffset + i} paddingLeft={1}>
                {hl}<Text color="#484f58">{formatTime(d.ts)} </Text>
                <Text color="#f59e0b">{'◆'} </Text>
                <Text color="#f59e0b" bold={isHighlighted}>{d.type}</Text>
                {d.tool && <Text color="#8b949e"> → {shortenToolName(d.tool, 30)}</Text>}
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
