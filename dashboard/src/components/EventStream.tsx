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

  return (
    <Box flexDirection="column">
      {/* Header line */}
      <Box>
        <Text color={selected ? '#58a6ff' : '#30363d'}>{selected ? '▸' : ' '}</Text>
        <Text color={statusColor}>{statusChar} </Text>
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

/** Estimate how many terminal lines a stream row takes */
function estimateStreamLines(stream: AgentStream, collapsed: boolean = false): number {
  if (collapsed || stream.idle || (stream.done && Object.keys(stream.toolCounts).length === 0)) return 1;
  const hasTools = Object.keys(stream.toolCounts).length > 0;
  return hasTools ? 3 : 2; // header + bar + optional tools
}

interface EventStreamProps {
  streams: AgentStream[];
  width?: number;
  selectedIndex?: number;
  maxLines?: number;
  expandedIds?: Set<string>;
}

export function EventStream({ streams, width = 55, selectedIndex, maxLines, expandedIds }: EventStreamProps) {
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

  // If maxLines is set, compute which streams are visible (window around selected)
  let visibleSet: Set<number> | null = null;
  let hiddenAbove = 0;
  let hiddenBelow = 0;

  if (maxLines && maxLines > 0 && sorted.length > 0) {
    // Build line-cost array: [globalIndex, lines] for each stream + group headers
    const sel = selectedIndex ?? 0;

    // Start from selected, expand outward until we fill maxLines
    visibleSet = new Set<number>();
    let usedLines = 0;

    const isCollapsed = (s: AgentStream) => s.done && !(expandedIds?.has(s.id));

    // Always include selected stream
    visibleSet.add(sel);
    usedLines += estimateStreamLines(sorted[sel]!, isCollapsed(sorted[sel]!)) + 1;

    // Expand upward and downward alternately
    let up = sel - 1;
    let down = sel + 1;

    while (usedLines < maxLines && (up >= 0 || down < sorted.length)) {
      if (up >= 0) {
        const cost = estimateStreamLines(sorted[up]!, isCollapsed(sorted[up]!));
        const proj = extractProject(sorted[up]!.label) || 'unknown';
        const prevProj = up + 1 < sorted.length ? (extractProject(sorted[up + 1]!.label) || 'unknown') : '';
        const groupCost = proj !== prevProj ? 1 : 0;
        if (usedLines + cost + groupCost <= maxLines) {
          visibleSet.add(up);
          usedLines += cost + groupCost;
        }
        up--;
      }
      if (down < sorted.length && usedLines < maxLines) {
        const cost = estimateStreamLines(sorted[down]!, isCollapsed(sorted[down]!));
        const proj = extractProject(sorted[down]!.label) || 'unknown';
        const prevProj = down - 1 >= 0 ? (extractProject(sorted[down - 1]!.label) || 'unknown') : '';
        const groupCost = proj !== prevProj ? 1 : 0;
        if (usedLines + cost + groupCost <= maxLines) {
          visibleSet.add(down);
          usedLines += cost + groupCost;
        }
        down++;
      }
      // Safety: if neither direction added, break
      if (!visibleSet.has(up + 1) && !visibleSet.has(down - 1)) break;
    }

    hiddenAbove = sorted.slice(0, Math.min(...visibleSet)).filter((_, i) => !visibleSet!.has(i)).length;
    hiddenBelow = sorted.slice(Math.max(...visibleSet) + 1).length;
  }

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

      {hiddenAbove > 0 && (
        <Box paddingLeft={2}>
          <Text color="#484f58">↑ {hiddenAbove} more</Text>
        </Box>
      )}

      {sorted.length === 0 ? (
        <Box paddingY={1} paddingLeft={2}>
          <Text color="#484f58">listening for sessions…</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {Array.from(groups.entries()).map(([project, group]) => {
            // Filter to visible streams in this group
            const visibleStreams = group.streams.filter((_, j) =>
              !visibleSet || visibleSet.has(group.globalIndices[j]!)
            );
            if (visibleStreams.length === 0) return null;

            return (
              <Box key={project} flexDirection="column">
                <Box>
                  <Text color="#d2a8ff" bold> {project}</Text>
                  <Text color="#30363d"> {'─'.repeat(Math.max(1, width - project.length - 4))}</Text>
                </Box>
                {group.streams.map((stream, j) => {
                  if (visibleSet && !visibleSet.has(group.globalIndices[j]!)) return null;
                  return (
                    <StreamRow
                      key={stream.id}
                      stream={stream}
                      maxWidth={width}
                      selected={selectedIndex === group.globalIndices[j]}
                      collapsed={stream.done && !(expandedIds?.has(stream.id))}
                    />
                  );
                })}
              </Box>
            );
          })}
        </Box>
      )}

      {hiddenBelow > 0 && (
        <Box paddingLeft={2}>
          <Text color="#484f58">↓ {hiddenBelow} more</Text>
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
