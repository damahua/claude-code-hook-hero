import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { shortenToolName } from './Panel.js';

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
  idle: boolean;
  done: boolean;
  startTime: number;
  endTime?: number;
  events: StreamEvent[];
  toolCounts: Record<string, number>;
  failures: number;
  tokens?: { input: number; output: number; cache_read: number; cache_write: number };
  promptCount: number;
  debugEnabled: boolean;
}

// Full-width block characters — easy to read at any terminal size
function getBarColor(event: StreamEvent): string {
  if (event.event === 'tool_failure') return '#f85149';
  if (event.event === 'user_prompt') return '#79c0ff';
  if (event.event.startsWith('subagent')) return '#d2a8ff';
  if (event.event === 'compact_start' || event.event === 'compact_end') return '#d29922';
  if (event.event === 'tool_end') return '#3fb950';
  if (event.event === 'tool_start') return '#2ea043';
  return '#484f58';
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

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Extract short project name from label */
function extractProject(label: string): string | null {
  const match = label.match(/\[([^\]]+)\]/);
  return match ? match[1] : null;
}

/** Extract session prefix from label */
function extractSessionId(label: string): string {
  const match = label.match(/· ([a-f0-9]+)/);
  return match ? match[1] : label.slice(0, 8);
}

interface StreamRowProps {
  stream: AgentStream;
  maxWidth: number;
  selected?: boolean;
  collapsed?: boolean;
}

function StreamRow({ stream, maxWidth, selected = false, collapsed = false }: StreamRowProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!stream.active || stream.idle) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % SPIN.length), 80);
    return () => clearInterval(timer);
  }, [stream.active, stream.idle]);

  const elapsed = (stream.endTime || Date.now()) - stream.startTime;
  const project = extractProject(stream.label);
  const sessionId = extractSessionId(stream.label);
  const totalTools = Object.values(stream.toolCounts).reduce((s, c) => s + c, 0);
  const topTools = Object.entries(stream.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Status
  let statusChar: string;
  let statusColor: string;
  let nameColor: string;

  if (stream.done) {
    statusChar = '✓';
    statusColor = '#3fb950';
    nameColor = '#6e7681';
  } else if (stream.idle) {
    statusChar = '○';
    statusColor = '#6e7681';
    nameColor = '#6e7681';
  } else {
    statusChar = SPIN[frame]!;
    statusColor = '#58a6ff';
    nameColor = '#e6edf3';
  }

  // Activity bar — full-width blocks, readable
  const barWidth = Math.max(8, maxWidth - 2);
  const recentEvents = stream.events.slice(-barWidth);
  const paddingCount = Math.max(0, barWidth - recentEvents.length);

  const isCompact = collapsed || stream.idle || (stream.done && totalTools <= 0);
  // CLI = single prompt (claude -p), interactive = multiple prompts
  const isCli = stream.done && stream.promptCount <= 1;

  return (
    <Box flexDirection="column">
      {/* Header line */}
      <Box>
        <Text color={selected ? '#58a6ff' : '#30363d'}>{selected ? '>' : ' '}</Text>
        <Text color={statusColor}>{statusChar} </Text>
        <Text color={isCli ? '#6e7681' : '#06b6d4'}>{isCli ? '$' : '#'} </Text>
        {project && (
          <>
            <Text color="#d2a8ff" bold={!stream.done && !stream.idle}>{project}</Text>
            <Text color="#484f58"> / </Text>
          </>
        )}
        <Text color={nameColor}>{sessionId}</Text>
        <Text color="#484f58"> · </Text>
        <Text color="#6e7681">{formatDuration(elapsed)}</Text>
        {totalTools > 0 && (
          <>
            <Text color="#484f58"> · </Text>
            <Text color="#e6edf3" bold>{totalTools}</Text>
            <Text color="#6e7681"> ops</Text>
          </>
        )}
        {stream.failures > 0 && (
          <>
            <Text color="#484f58"> · </Text>
            <Text color="#f85149" bold>{stream.failures} err</Text>
          </>
        )}
        {stream.tokens && (stream.tokens.input > 0 || stream.tokens.output > 0) && (
          <>
            <Text color="#484f58"> · </Text>
            <Text color="#d29922">{formatTokens(stream.tokens.input + stream.tokens.output)}</Text>
            <Text color="#6e7681"> tok</Text>
            <Text color="#484f58"> · </Text>
            <Text color="#d29922" bold>{formatCost(estimateCost(stream.tokens))}</Text>
          </>
        )}
        {stream.debugEnabled && (
          <Text color="#f59e0b"> *DEBUG*</Text>
        )}
        {collapsed && totalTools > 0 && (
          <Text color="#484f58"> ›››</Text>
        )}
      </Box>

      {/* Activity bar — big readable blocks */}
      {!isCompact && (
        <Box>
          <Text>  </Text>
          <Text color="#161b22">{'░'.repeat(paddingCount)}</Text>
          {recentEvents.map((ev, i) => (
            <Text key={i} color={getBarColor(ev)}>
              {ev.event === 'tool_failure' ? '█' : '▓'}
            </Text>
          ))}
          {stream.active && !stream.idle && <Text color="#58a6ff">▎</Text>}
        </Box>
      )}

      {/* Tool summary */}
      {topTools.length > 0 && !isCompact && (
        <Box>
          <Text>  </Text>
          {topTools.map(([name, count], i) => (
            <React.Fragment key={name}>
              {i > 0 && <Text color="#30363d"> · </Text>}
              <Text color="#6e7681">{shortenToolName(name, 18)}</Text>
              <Text color="#484f58"> </Text>
              <Text color="#c9d1d9">{count}</Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface GroupSummary {
  total: number;
  active: number;
  idle: number;
  done: number;
  totalOps: number;
  totalFailures: number;
  totalTokens: number;
  totalCost: number;
}

function estimateCost(t: { input: number; output: number; cache_read: number; cache_write: number }): number {
  return (t.input / 1000) * 0.005 + (t.output / 1000) * 0.025 +
         (t.cache_read / 1000) * 0.0005 + (t.cache_write / 1000) * 0.00625;
}

function formatCost(usd: number): string {
  if (usd === 0) return '';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function computeGroupSummary(streams: AgentStream[]): GroupSummary {
  let totalOps = 0;
  let totalFailures = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let active = 0;
  let idle = 0;
  let done = 0;
  for (const s of streams) {
    totalOps += Object.values(s.toolCounts).reduce((a, b) => a + b, 0);
    totalFailures += s.failures;
    if (s.tokens) {
      totalTokens += s.tokens.input + s.tokens.output;
      totalCost += estimateCost(s.tokens);
    }
    if (s.done) done++;
    else if (s.idle) idle++;
    else active++;
  }
  return { total: streams.length, active, idle, done, totalOps, totalFailures, totalTokens, totalCost };
}

interface EventStreamProps {
  streams: AgentStream[];
  width?: number;
  selectedIndex?: number;
  expandedIds?: Set<string>;
  collapsedGroups?: Set<string>;
  selectedGroup?: string | null;
}

export function EventStream({ streams, width = 55, selectedIndex, expandedIds, collapsedGroups, selectedGroup }: EventStreamProps) {
  const sorted = sortStreams(streams);

  // Group by project
  const groups = new Map<string, { streams: AgentStream[]; globalIndices: number[] }>();
  sorted.forEach((stream, i) => {
    const project = extractProject(stream.label) || 'unknown';
    if (!groups.has(project)) {
      groups.set(project, { streams: [], globalIndices: [] });
    }
    groups.get(project)!.streams.push(stream);
    groups.get(project)!.globalIndices.push(i);
  });

  const activeCount = streams.filter(s => s.active && !s.idle).length;
  const idleCount = streams.filter(s => s.idle).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="#484f58">{'─'} </Text>
        <Text color="#c9d1d9" bold>streams</Text>
        <Text color="#484f58"> (</Text>
        <Text color="#58a6ff">{activeCount} active</Text>
        {idleCount > 0 && <Text color="#6e7681">, {idleCount} idle</Text>}
        <Text color="#484f58">, {sorted.length} total)</Text>
        <Text color="#30363d"> {'─'.repeat(Math.max(1, width - 36))}</Text>
      </Box>

      {sorted.length === 0 ? (
        <Box paddingY={1} paddingLeft={2}>
          <Text color="#484f58">listening for sessions…</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {Array.from(groups.entries()).map(([project, group]) => {
            const isGroupCollapsed = collapsedGroups?.has(project) ?? false;
            const isGroupSelected = selectedGroup === project;
            const summary = computeGroupSummary(group.streams);

            // Collapsed group — single summary line
            if (isGroupCollapsed) {
              return (
                <Box key={project}>
                  <Text color={isGroupSelected ? '#58a6ff' : '#30363d'}>{isGroupSelected ? '>' : ' '}</Text>
                  <Text color="#d2a8ff" bold>[+] {project}</Text>
                  <Text color="#484f58"> · </Text>
                  <Text color="#6e7681">{summary.total} sess</Text>
                  {summary.active > 0 && (
                    <>
                      <Text color="#484f58"> · </Text>
                      <Text color="#58a6ff">{summary.active} active</Text>
                    </>
                  )}
                  <Text color="#484f58"> · </Text>
                  <Text color="#6e7681">{summary.totalOps} ops</Text>
                  {summary.totalFailures > 0 && (
                    <>
                      <Text color="#484f58"> · </Text>
                      <Text color="#f85149">{summary.totalFailures} err</Text>
                    </>
                  )}
                  {summary.totalTokens > 0 && (
                    <>
                      <Text color="#484f58"> · </Text>
                      <Text color="#d29922">{formatTokens(summary.totalTokens)} tok</Text>
                    </>
                  )}
                  {summary.totalCost > 0 && (
                    <>
                      <Text color="#484f58"> · </Text>
                      <Text color="#d29922" bold>{formatCost(summary.totalCost)}</Text>
                    </>
                  )}
                </Box>
              );
            }

            // Expanded group — show streams
            return (
              <Box key={project} flexDirection="column">
                <Box>
                  <Text color={isGroupSelected ? '#58a6ff' : '#30363d'}>{isGroupSelected ? '>' : ' '}</Text>
                  <Text color="#d2a8ff" bold>[-] {project}</Text>
                  <Text color="#484f58"> · </Text>
                  <Text color="#6e7681">{summary.total} sess</Text>
                  {summary.active > 0 && (
                    <>
                      <Text color="#484f58"> · </Text>
                      <Text color="#58a6ff">{summary.active} active</Text>
                    </>
                  )}
                  <Text color="#30363d"> {'─'.repeat(Math.max(1, width - project.length - 25))}</Text>
                </Box>
                {group.streams.map((stream, j) => (
                  <StreamRow
                    key={stream.id}
                    stream={stream}
                    maxWidth={width}
                    selected={selectedIndex === group.globalIndices[j]}
                    collapsed={stream.done && !(expandedIds?.has(stream.id))}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

export function sortStreams(streams: AgentStream[]): AgentStream[] {
  return [...streams].sort((a, b) => {
    const aRank = a.active && !a.idle ? 0 : a.idle ? 1 : 2;
    const bRank = b.active && !b.idle ? 0 : b.idle ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return b.startTime - a.startTime;
  });
}

export type { AgentStream };
