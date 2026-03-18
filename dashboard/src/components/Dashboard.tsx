import React, { useState, useEffect, useMemo } from 'react';
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
import type { AgentStream } from './EventStream.js';

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

function getProject(stream: AgentStream): string {
  const match = stream.label.match(/\[([^\]]+)\]/);
  return match ? match[1] : 'unknown';
}

// A flat navigable item: either a group header or a stream
type NavItem =
  | { kind: 'group'; project: string; streams: AgentStream[] }
  | { kind: 'stream'; stream: AgentStream; project: string };

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
  const [cursorIdx, setCursorIdx] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [detailStreamId, setDetailStreamId] = useState<string | null>(null);
  const [detailScroll, setDetailScroll] = useState(0);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [mode]);

  const allProjects = Array.from(new Set(
    data.streams.map(s => getProject(s))
  )).sort();

  const filteredStreams = projectFilter
    ? data.streams.filter(s => getProject(s) === projectFilter)
    : data.streams;

  const sorted = sortStreams(filteredStreams);

  // Build the flat navigation list: group headers + visible streams
  const navItems: NavItem[] = useMemo(() => {
    const groups = new Map<string, AgentStream[]>();
    for (const s of sorted) {
      const p = getProject(s);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(s);
    }

    const items: NavItem[] = [];
    for (const [project, streams] of groups) {
      items.push({ kind: 'group', project, streams });
      if (!collapsedGroups.has(project)) {
        for (const stream of streams) {
          items.push({ kind: 'stream', stream, project });
        }
      }
    }
    return items;
  }, [sorted, collapsedGroups]);

  // Keep cursor in bounds
  useEffect(() => {
    if (cursorIdx >= navItems.length && navItems.length > 0) {
      setCursorIdx(navItems.length - 1);
    }
  }, [navItems.length, cursorIdx]);

  const currentItem = navItems[cursorIdx];
  const detailStream = detailStreamId ? sorted.find(s => s.id === detailStreamId) : null;

  // Derive selectedIndex and selectedGroup for EventStream rendering
  const selectedIndex = currentItem?.kind === 'stream'
    ? sorted.findIndex(s => s.id === currentItem.stream.id)
    : -1;
  const selectedGroup = currentItem?.kind === 'group' ? currentItem.project : null;

  useInput((input, key) => {
    if (detailStream) {
      // Detail view
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
      return;
    }

    // Main navigation — single flat list
    if (key.upArrow || input === 'k') {
      setCursorIdx(i => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setCursorIdx(i => Math.min(navItems.length - 1, i + 1));
    } else if (key.return) {
      const item = navItems[cursorIdx];
      if (!item) return;

      if (item.kind === 'group') {
        // Toggle group collapse
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          if (next.has(item.project)) {
            next.delete(item.project);
          } else {
            next.add(item.project);
          }
          return next;
        });
      } else {
        // Stream: expand done streams first, then detail view
        const stream = item.stream;
        if (stream.done && !expandedIds.has(stream.id)) {
          setExpandedIds(prev => new Set([...prev, stream.id]));
        } else {
          setDetailStreamId(stream.id);
          setDetailScroll(0);
        }
      }
    } else if (key.escape) {
      // If inside an expanded group, collapse it
      const item = navItems[cursorIdx];
      if (item?.kind === 'stream') {
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          next.add(item.project);
          return next;
        });
        // Move cursor to the group header
        const groupIdx = navItems.findIndex(n => n.kind === 'group' && n.project === item.project);
        if (groupIdx >= 0) setCursorIdx(groupIdx);
      }
    } else if (input === 'd') {
      const item = navItems[cursorIdx];
      if (item?.kind === 'stream') {
        const stream = item.stream;
        const debugPath = path.join(HOOK_HERO_BASE, 'buffer', `${stream.id}.debug`);
        if (fs.existsSync(debugPath)) {
          try { fs.unlinkSync(debugPath); } catch {}
        } else {
          const bufPath = path.join(HOOK_HERO_BASE, 'buffer', `${stream.id}.json`);
          if (fs.existsSync(bufPath)) {
            fs.writeFileSync(debugPath, '');
          }
        }
      }
    } else if (input === 'c') {
      const allGroupNames = navItems.filter(n => n.kind === 'group').map(n => (n as any).project);
      setCollapsedGroups(new Set(allGroupNames));
      setCursorIdx(0);
    } else if (input === 'e') {
      setCollapsedGroups(new Set());
    } else if (input === 'f') {
      setProjectFilter(prev => {
        if (prev === null) return allProjects[0] ?? null;
        const idx = allProjects.indexOf(prev);
        if (idx === -1 || idx === allProjects.length - 1) return null;
        return allProjects[idx + 1]!;
      });
      setCursorIdx(0);
    } else if (input === 'q') {
      process.exit(0);
    }
  });

  // Detail view
  if (detailStream) {
    let debugEntries: DebugEntry[] = [];
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

  return (
    <Box flexDirection="column" height={termHeight}>
      <Header mode={mode} />

      {/* Stats bar */}
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
        expandedIds={expandedIds}
        collapsedGroups={collapsedGroups}
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
