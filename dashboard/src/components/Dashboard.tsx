import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { Header } from './Header.js';
import { ToolBar } from './Panel.js';
import { EventStream, sortStreams } from './EventStream.js';
import { StreamDetail } from './StreamDetail.js';
import type { TelemetryState } from '../hooks/useTelemetry.js';

function formatCost(usd: number): string {
  if (usd === 0) return '—';
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return '—';
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
  const termHeight = stdout?.rows || 24;

  const [elapsed, setElapsed] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailStreamId, setDetailStreamId] = useState<string | null>(null);
  const [detailScroll, setDetailScroll] = useState(0);

  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  const sorted = sortStreams(data.streams);

  // Use a ref to give useInput access to the latest sorted array
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;

  // Resolve selectedId to an index in the current sorted array
  let selectedIndex = selectedId ? sorted.findIndex(s => s.id === selectedId) : -1;
  if (selectedIndex === -1 && sorted.length > 0) {
    // Selection lost (stream removed or first render) — select first
    selectedIndex = 0;
    // Defer the state update to avoid setting state during render
    if (selectedId !== sorted[0]!.id) {
      setTimeout(() => setSelectedId(sorted[0]!.id), 0);
    }
  }

  // Find the detail stream by ID
  const detailStream = detailStreamId ? sorted.find(s => s.id === detailStreamId) : null;

  useInput((input, key) => {
    const current = sortedRef.current;

    if (detailStream) {
      if (key.escape || input === 'q') {
        setDetailStreamId(null);
        setDetailScroll(0);
      } else if (key.upArrow) {
        setDetailScroll(s => Math.max(0, s - 1));
      } else if (key.downArrow) {
        setDetailScroll(s => Math.min(detailStream.events.length - 1, s + 1));
      } else if (input === 'g') {
        setDetailScroll(0);
      } else if (input === 'G') {
        setDetailScroll(Math.max(0, detailStream.events.length - 10));
      }
    } else {
      // Find current position of selectedId in the latest sorted array
      const curIdx = selectedId ? current.findIndex(s => s.id === selectedId) : 0;
      const safeIdx = curIdx === -1 ? 0 : curIdx;

      if (key.upArrow || input === 'k') {
        const newIdx = Math.max(0, safeIdx - 1);
        if (current[newIdx]) setSelectedId(current[newIdx]!.id);
      } else if (key.downArrow || input === 'j') {
        const newIdx = Math.min(current.length - 1, safeIdx + 1);
        if (current[newIdx]) setSelectedId(current[newIdx]!.id);
      } else if (key.return) {
        const stream = current[safeIdx];
        if (stream) {
          // If done and collapsed → expand; if already expanded or active → detail view
          if (stream.done && !expandedIds.has(stream.id)) {
            setExpandedIds(prev => new Set([...prev, stream.id]));
          } else {
            setDetailStreamId(stream.id);
            setDetailScroll(0);
          }
        }
      } else if (input === 'q') {
        process.exit(0);
      }
    }
  });

  // Detail view
  if (detailStream) {
    return (
      <StreamDetail
        stream={detailStream}
        width={termWidth - 2}
        height={termHeight}
        scrollOffset={detailScroll}
      />
    );
  }

  // Chrome lines: header(4) + stats(1) + tools(~2) + stream-header(1) + footer(1)
  const chromeLines = 8 + (Object.keys(data.toolCounts).length > 0 ? 2 : 0);
  const availableLines = termHeight - chromeLines;

  return (
    <Box flexDirection="column">
      <Header mode={mode} />

      {/* Stats bar — today */}
      <Box paddingLeft={1}>
        <Text color="#6e7681">today </Text>
        <Text color="#e6edf3" bold>{data.totalSessions}</Text>
        <Text color="#6e7681"> sess </Text>
        <Text color="#484f58">│ </Text>
        <Text color="#e6edf3" bold>{data.totalTools}</Text>
        <Text color="#6e7681"> ops </Text>
        {data.totalFailures > 0 && (
          <>
            <Text color="#484f58">│ </Text>
            <Text color="#f85149" bold>{data.totalFailures}</Text>
            <Text color="#6e7681"> err </Text>
          </>
        )}
        <Text color="#484f58">│ </Text>
        <Text color="#c9d1d9">{formatTokens(data.totalTokens)}</Text>
        <Text color="#6e7681"> tok </Text>
        <Text color="#484f58">│ </Text>
        <Text color="#d29922">{formatCost(data.totalCost)}</Text>
        {mode === 'live' && (
          <>
            <Text color="#484f58"> │ </Text>
            <Text color="#6e7681">{formatUptime(elapsed)}</Text>
          </>
        )}
        <Text color="#484f58"> │ </Text>
        <Text color="#6e7681">all time </Text>
        <Text color="#c9d1d9">{formatTokens(data.allTimeTokens)}</Text>
        <Text color="#6e7681"> tok </Text>
        <Text color="#d29922">{formatCost(data.allTimeCost)}</Text>
      </Box>

      {/* Tool breakdown */}
      {Object.keys(data.toolCounts).length > 0 && (
        <Box paddingLeft={1}>
          <ToolBar tools={data.toolCounts} maxItems={8} />
        </Box>
      )}

      {/* Streams */}
      <EventStream
        streams={data.streams}
        width={termWidth - 4}
        selectedIndex={selectedIndex}
        maxLines={availableLines}
        expandedIds={expandedIds}
      />

      {/* Footer */}
      <Box paddingLeft={1}>
        <Text color="#484f58">↑↓</Text>
        <Text color="#30363d"> navigate </Text>
        <Text color="#484f58">↵</Text>
        <Text color="#30363d"> expand/details </Text>
        <Text color="#484f58">q</Text>
        <Text color="#30363d"> quit</Text>
      </Box>
    </Box>
  );
}
