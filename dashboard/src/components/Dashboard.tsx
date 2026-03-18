import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Header } from './Header.js';
import { ToolBar } from './Panel.js';
import { EventStream, sortStreams } from './EventStream.js';
import { StreamDetail } from './StreamDetail.js';
import type { DebugEntry } from './StreamDetail.js';
import type { TelemetryState } from '../hooks/useTelemetry.js';

const HOOK_HERO_BASE = path.join(os.homedir(), '.claude', 'hook-hero');

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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set()); // start expanded
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null); // when navigating at group level
  const [detailStreamId, setDetailStreamId] = useState<string | null>(null);
  const [detailScroll, setDetailScroll] = useState(0);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  // Collect unique project names for filter cycling
  const allProjects = Array.from(new Set(
    data.streams.map(s => {
      const match = s.label.match(/\[([^\]]+)\]/);
      return match ? match[1] : 'unknown';
    })
  )).sort();

  // Apply project filter
  const filteredStreams = projectFilter
    ? data.streams.filter(s => {
        const match = s.label.match(/\[([^\]]+)\]/);
        const proj = match ? match[1] : 'unknown';
        return proj === projectFilter;
      })
    : data.streams;

  const sorted = sortStreams(filteredStreams);

  // Build ordered group list for navigation
  const groupOrder = Array.from(new Set(
    sorted.map(s => {
      const match = s.label.match(/\[([^\]]+)\]/);
      return match ? match[1] : 'unknown';
    })
  ));

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
    } else if (selectedGroup !== null && (collapsedGroups?.has(selectedGroup) || selectedId === null)) {
      // Group-level navigation (all groups collapsed or no stream selected)
      const gIdx = groupOrder.indexOf(selectedGroup);

      if (key.upArrow || input === 'k') {
        const newIdx = Math.max(0, gIdx - 1);
        setSelectedGroup(groupOrder[newIdx] ?? null);
        setSelectedId(null);
      } else if (key.downArrow || input === 'j') {
        const newIdx = Math.min(groupOrder.length - 1, gIdx + 1);
        setSelectedGroup(groupOrder[newIdx] ?? null);
        setSelectedId(null);
      } else if (key.return) {
        // Toggle group collapse
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          if (next.has(selectedGroup!)) {
            next.delete(selectedGroup!);
            // Select first stream in the expanded group
            const firstInGroup = current.find(s => {
              const m = s.label.match(/\[([^\]]+)\]/);
              return (m ? m[1] : 'unknown') === selectedGroup;
            });
            if (firstInGroup) setTimeout(() => setSelectedId(firstInGroup.id), 0);
          } else {
            next.add(selectedGroup!);
            setSelectedId(null);
          }
          return next;
        });
      } else if (input === 'c') {
        // Collapse all groups
        setCollapsedGroups(new Set(groupOrder));
        setSelectedId(null);
      } else if (input === 'e') {
        // Expand all groups
        setCollapsedGroups(new Set());
      } else if (input === 'f') {
        setProjectFilter(prev => {
          if (prev === null) return allProjects[0] ?? null;
          const idx = allProjects.indexOf(prev);
          if (idx === -1 || idx === allProjects.length - 1) return null;
          return allProjects[idx + 1]!;
        });
        setSelectedId(null);
      } else if (input === 'q') {
        process.exit(0);
      }
    } else {
      // Stream-level navigation (inside an expanded group)
      // Only navigate within the current group's streams
      const currentGroupStreams = current.filter(s => {
        const m = s.label.match(/\[([^\]]+)\]/);
        return (m ? m[1] : 'unknown') === selectedGroup;
      });
      const groupIdx = selectedId ? currentGroupStreams.findIndex(s => s.id === selectedId) : 0;
      const safeIdx = groupIdx === -1 ? 0 : groupIdx;

      if (key.upArrow || input === 'k') {
        if (safeIdx === 0) {
          // At top of group — go back to group level
          setSelectedId(null);
        } else {
          const newStream = currentGroupStreams[safeIdx - 1];
          if (newStream) setSelectedId(newStream.id);
        }
      } else if (key.downArrow || input === 'j') {
        if (safeIdx >= currentGroupStreams.length - 1) {
          // At bottom of group — move to next group
          const gIdx = groupOrder.indexOf(selectedGroup!);
          if (gIdx < groupOrder.length - 1) {
            const nextGroup = groupOrder[gIdx + 1]!;
            setSelectedGroup(nextGroup);
            if (collapsedGroups?.has(nextGroup)) {
              setSelectedId(null);
            } else {
              const firstInNext = current.find(s => {
                const m = s.label.match(/\[([^\]]+)\]/);
                return (m ? m[1] : 'unknown') === nextGroup;
              });
              if (firstInNext) setSelectedId(firstInNext.id);
            }
          }
        } else {
          const newStream = currentGroupStreams[safeIdx + 1];
          if (newStream) setSelectedId(newStream.id);
        }
      } else if (key.escape) {
        // Collapse current group, go back to group level
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          next.add(selectedGroup!);
          return next;
        });
        setSelectedId(null);
      } else if (key.return) {
        const stream = currentGroupStreams[safeIdx];
        if (stream) {
          if (stream.done && !expandedIds.has(stream.id)) {
            setExpandedIds(prev => new Set([...prev, stream.id]));
          } else {
            setDetailStreamId(stream.id);
            setDetailScroll(0);
          }
        }
      } else if (input === 'd') {
        // Toggle debug mode for selected stream
        const stream = currentGroupStreams[safeIdx];
        if (stream) {
          const debugPath = path.join(HOOK_HERO_BASE, 'buffer', `${stream.id}.debug`);
          if (fs.existsSync(debugPath)) {
            try { fs.unlinkSync(debugPath); } catch {}
          } else {
            // Only works for active sessions (need buffer)
            const bufPath = path.join(HOOK_HERO_BASE, 'buffer', `${stream.id}.json`);
            if (fs.existsSync(bufPath)) {
              fs.writeFileSync(debugPath, '');
            }
          }
        }
      } else if (input === 'c') {
        setCollapsedGroups(new Set(groupOrder));
        setSelectedId(null);
      } else if (input === 'e') {
        setCollapsedGroups(new Set());
      } else if (input === 'f') {
        setProjectFilter(prev => {
          if (prev === null) return allProjects[0] ?? null;
          const idx = allProjects.indexOf(prev);
          if (idx === -1 || idx === allProjects.length - 1) return null;
          return allProjects[idx + 1]!;
        });
        setSelectedId(null);
      } else if (input === 'q') {
        process.exit(0);
      }
    }
  });

  // Detail view — read debug entries if available
  if (detailStream) {
    let debugEntries: DebugEntry[] = [];
    // Check all date dirs for debug logs for this session
    const debugBase = path.join(HOOK_HERO_BASE, 'debug');
    try {
      for (const dateDir of fs.readdirSync(debugBase)) {
        const debugFile = path.join(debugBase, dateDir, `${detailStream.id}.jsonl`);
        if (fs.existsSync(debugFile)) {
          const content = fs.readFileSync(debugFile, 'utf-8').trim();
          if (content) {
            for (const line of content.split('\n')) {
              try { debugEntries.push(JSON.parse(line)); } catch {}
            }
          }
        }
      }
    } catch {}

    return (
      <StreamDetail
        stream={detailStream}
        width={termWidth - 2}
        height={termHeight}
        scrollOffset={detailScroll}
        debugEntries={debugEntries}
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
        <Text color="#06b6d4">{data.interactivePrompts}</Text>
        <Text color="#6e7681">◈</Text>
        <Text color="#484f58">/</Text>
        <Text color="#6e7681">{data.cliPrompts}</Text>
        <Text color="#6e7681">⚡ msgs </Text>
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
        streams={filteredStreams}
        width={termWidth - 4}
        selectedIndex={selectedIndex}
        maxLines={availableLines}
        expandedIds={expandedIds}
        collapsedGroups={collapsedGroups ?? new Set()}
        selectedGroup={selectedGroup}
      />

      {/* Footer */}
      <Box paddingLeft={1}>
        <Text color="#c9d1d9" bold>↑↓</Text>
        <Text color="#8b949e"> navigate </Text>
        <Text color="#c9d1d9" bold>↵</Text>
        <Text color="#8b949e"> expand </Text>
        <Text color="#c9d1d9" bold>esc</Text>
        <Text color="#8b949e"> collapse </Text>
        <Text color="#c9d1d9" bold>d</Text>
        <Text color="#8b949e"> debug </Text>
        <Text color="#c9d1d9" bold>c</Text>
        <Text color="#8b949e">/</Text>
        <Text color="#c9d1d9" bold>e</Text>
        <Text color="#8b949e"> all </Text>
        <Text color="#c9d1d9" bold>f</Text>
        <Text color="#8b949e"> filter</Text>
        {projectFilter && (
          <Text color="#d2a8ff"> [{projectFilter}]</Text>
        )}
        <Text color="#8b949e"> </Text>
        <Text color="#c9d1d9" bold>q</Text>
        <Text color="#8b949e"> quit</Text>
      </Box>
    </Box>
  );
}
