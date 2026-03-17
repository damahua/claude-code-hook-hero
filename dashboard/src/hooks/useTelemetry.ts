import { useState, useEffect, useCallback } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentStream, StreamEvent } from '../components/EventStream.js';

const DEFAULT_BASE = path.join(os.homedir(), '.claude', 'hook-hero');

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseJsonlFile(filePath: string): StreamEvent[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

function readSessionSummary(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function buildStreamsFromEvents(events: StreamEvent[]): Map<string, AgentStream> {
  const streams = new Map<string, AgentStream>();

  for (const ev of events) {
    const sessionId = (ev as any).session_id;
    if (!sessionId) continue;

    // Determine which stream this event belongs to
    let streamId = sessionId;
    let streamLabel = `session ${sessionId.slice(0, 8)}`;
    let streamType: 'main' | 'subagent' = 'main';

    if (ev.event === 'subagent_start' && ev.subagent_id) {
      streamId = ev.subagent_id;
      streamLabel = `${ev.subagent_type || 'subagent'} (${ev.subagent_id.slice(0, 8)})`;
      streamType = 'subagent';
    } else if (ev.event === 'subagent_stop' && ev.subagent_id) {
      const sub = streams.get(ev.subagent_id);
      if (sub) {
        sub.active = false;
        sub.done = true;
        sub.endTime = new Date(ev.ts).getTime();
        sub.events.push(ev);
      }
      continue;
    }

    if (!streams.has(streamId)) {
      const channel = (ev as any).channel;
      const projectName = (ev as any).context?.project_name;
      const dirLabel = projectName ? ` [${projectName}]` : '';
      streams.set(streamId, {
        id: streamId,
        label: streamType === 'main'
          ? `${channel || 'claude-code'} · ${sessionId.slice(0, 8)}${dirLabel}`
          : streamLabel,
        type: streamType,
        channel,
        active: true,
        idle: false,
        done: false,
        startTime: new Date(ev.ts).getTime(),
        events: [],
        toolCounts: {},
        failures: 0,
      });
    }

    const stream = streams.get(streamId)!;
    stream.events.push(ev);

    // Handle session restart — reset done/active when a new session_start arrives
    if (ev.event === 'session_start') {
      stream.active = true;
      stream.done = false;
      stream.startTime = new Date(ev.ts).getTime();
      stream.endTime = undefined;
      const channel = (ev as any).channel;
      const projectName = (ev as any).context?.project_name;
      const dirLabel = projectName ? ` [${projectName}]` : '';
      if (channel) {
        stream.channel = channel;
        stream.label = `${channel} · ${sessionId.slice(0, 8)}${dirLabel}`;
      }
    }

    // Track tool counts
    if ((ev.event === 'tool_end' || ev.event === 'tool_failure') && ev.tool) {
      stream.toolCounts[ev.tool] = (stream.toolCounts[ev.tool] || 0) + 1;
    }
    if (ev.event === 'tool_failure') {
      stream.failures++;
    }

    // Track token usage from agent_stop events (cumulative from transcript)
    if (ev.event === 'agent_stop') {
      const tokens = (ev as any).tokens;
      if (tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cache_read > 0 || tokens.cache_write > 0)) {
        stream.tokens = {
          input: tokens.input ?? 0,
          output: tokens.output ?? 0,
          cache_read: tokens.cache_read ?? 0,
          cache_write: tokens.cache_write ?? 0,
        };
      }
    }

    // Handle session end
    if (ev.event === 'session_end') {
      stream.active = false;
      stream.done = true;
      stream.endTime = new Date(ev.ts).getTime();
    }
  }

  // Filter ghosts and mark idle streams
  const LIFECYCLE_EVENTS = new Set(['session_start', 'session_end']);
  const IDLE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
  const now = Date.now();

  for (const [id, stream] of streams) {
    const hasActivity = stream.events.some(ev => !LIFECYCLE_EVENTS.has(ev.event));
    const hasBuffer = fs.existsSync(path.join(DEFAULT_BASE, 'buffer', `${id}.json`));

    // Remove ghost streams (no activity + no buffer)
    if (!hasActivity && !hasBuffer) {
      streams.delete(id);
      continue;
    }

    // Mark idle: has buffer (session alive) but no recent events
    if (stream.active && !stream.done) {
      const lastEventTime = stream.events.length > 0
        ? new Date(stream.events[stream.events.length - 1]!.ts).getTime()
        : stream.startTime;
      stream.idle = now - lastEventTime > IDLE_THRESHOLD_MS;
    }

    // Read token data from buffer for active sessions (most up-to-date)
    if (hasBuffer) {
      try {
        const bufferPath = path.join(DEFAULT_BASE, 'buffer', `${id}.json`);
        const buf = JSON.parse(fs.readFileSync(bufferPath, 'utf-8'));
        const ti = buf.tokens_input ?? 0;
        const to = buf.tokens_output ?? 0;
        const cr = buf.tokens_cache_read ?? 0;
        const cw = buf.tokens_cache_write ?? 0;
        if (ti > 0 || to > 0 || cr > 0 || cw > 0) {
          stream.tokens = { input: ti, output: to, cache_read: cr, cache_write: cw };
        }
      } catch { /* ignore read errors */ }
    }
  }

  return streams;
}

export interface TelemetryState {
  streams: AgentStream[];
  totalTokens: number;
  totalCost: number;
  totalSessions: number;
  totalTools: number;
  totalFailures: number;
  toolCounts: Record<string, number>;
  repos: string[];
  channels: string[];
  latestEvents: StreamEvent[];
}

const EMPTY_STATE: TelemetryState = {
  streams: [],
  totalTokens: 0,
  totalCost: 0,
  totalSessions: 0,
  totalTools: 0,
  totalFailures: 0,
  toolCounts: {},
  repos: [],
  channels: [],
  latestEvents: [],
};

export function useLiveTelemetry(baseDir: string = DEFAULT_BASE): TelemetryState {
  const [state, setState] = useState<TelemetryState>(EMPTY_STATE);

  const refresh = useCallback(() => {
    const date = today();
    const eventsDir = path.join(baseDir, 'events', date);
    const bufferDir = path.join(baseDir, 'buffer');

    // Read all events for today
    const allEvents: StreamEvent[] = [];

    // From events directory
    if (fs.existsSync(eventsDir)) {
      const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        allEvents.push(...parseJsonlFile(path.join(eventsDir, file)));
      }
    }

    // Sort by timestamp
    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const streamsMap = buildStreamsFromEvents(allEvents);
    const streams = Array.from(streamsMap.values());

    // Aggregate stats
    let totalTokens = 0;
    let totalCost = 0;
    const toolCounts: Record<string, number> = {};
    let totalFailures = 0;
    const repos = new Set<string>();
    const channels = new Set<string>();

    // Read session summaries for completed sessions
    const sessionsDir = path.join(baseDir, 'sessions', date);
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const summary = readSessionSummary(path.join(sessionsDir, file));
        if (!summary) continue;
        totalTokens += summary.tokens?.total || 0;
        totalCost += summary.tokens?.estimated_cost_usd || 0;
        if (summary.context?.repo) repos.add(summary.context.repo);
        if (summary.channel) channels.add(summary.channel);
        if (summary.tools?.by_type) {
          for (const [tool, count] of Object.entries(summary.tools.by_type)) {
            toolCounts[tool] = (toolCounts[tool] || 0) + (count as number);
          }
        }
        totalFailures += summary.tools?.failures || 0;
      }
    }

    // Add stats from active streams (not yet finalized)
    for (const stream of streams) {
      if (!stream.done) {
        if (stream.channel) channels.add(stream.channel);
        for (const [tool, count] of Object.entries(stream.toolCounts)) {
          toolCounts[tool] = (toolCounts[tool] || 0) + count;
        }
        totalFailures += stream.failures;
      }
    }

    // Count active buffer files as active sessions
    let activeSessions = 0;
    if (fs.existsSync(bufferDir)) {
      activeSessions = fs.readdirSync(bufferDir).filter(f => f.endsWith('.json')).length;
    }

    const totalSessions = (fs.existsSync(sessionsDir)
      ? fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).length
      : 0) + activeSessions;

    const totalTools = Object.values(toolCounts).reduce((s, c) => s + c, 0);

    setState({
      streams,
      totalTokens,
      totalCost,
      totalSessions,
      totalTools,
      totalFailures,
      toolCounts,
      repos: Array.from(repos),
      channels: Array.from(channels),
      latestEvents: allEvents.slice(-50),
    });
  }, [baseDir]);

  useEffect(() => {
    refresh();

    // Watch for file changes
    const eventsDir = path.join(baseDir, 'events', today());
    const bufferDir = path.join(baseDir, 'buffer');
    const sessionsDir = path.join(baseDir, 'sessions', today());

    const watchers: fs.FSWatcher[] = [];
    const dirs = [eventsDir, bufferDir, sessionsDir];

    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        try {
          const watcher = fs.watch(dir, { persistent: false }, () => {
            setTimeout(refresh, 100); // debounce
          });
          watchers.push(watcher);
        } catch { /* ignore watch errors */ }
      }
    }

    // Also poll every 2 seconds as fallback
    const interval = setInterval(refresh, 2000);

    return () => {
      watchers.forEach(w => w.close());
      clearInterval(interval);
    };
  }, [baseDir, refresh]);

  return state;
}

export function useHistoryTelemetry(baseDir: string = DEFAULT_BASE, date?: string): TelemetryState {
  const [state, setState] = useState<TelemetryState>(EMPTY_STATE);

  useEffect(() => {
    const targetDate = date || today();
    const sessionsDir = path.join(baseDir, 'sessions', targetDate);
    const eventsDir = path.join(baseDir, 'events', targetDate);

    let totalTokens = 0;
    let totalCost = 0;
    const toolCounts: Record<string, number> = {};
    let totalFailures = 0;
    const repos = new Set<string>();
    const channels = new Set<string>();

    // Read all session summaries
    const summaries: any[] = [];
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const summary = readSessionSummary(path.join(sessionsDir, file));
        if (!summary) continue;
        summaries.push(summary);
        totalTokens += summary.tokens?.total || 0;
        totalCost += summary.tokens?.estimated_cost_usd || 0;
        if (summary.context?.repo) repos.add(summary.context.repo);
        if (summary.channel) channels.add(summary.channel);
        if (summary.tools?.by_type) {
          for (const [tool, count] of Object.entries(summary.tools.by_type)) {
            toolCounts[tool] = (toolCounts[tool] || 0) + (count as number);
          }
        }
        totalFailures += summary.tools?.failures || 0;
      }
    }

    // Build streams from events
    const allEvents: StreamEvent[] = [];
    if (fs.existsSync(eventsDir)) {
      const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        allEvents.push(...parseJsonlFile(path.join(eventsDir, file)));
      }
    }
    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const streamsMap = buildStreamsFromEvents(allEvents);
    const streams = Array.from(streamsMap.values());

    const totalTools = Object.values(toolCounts).reduce((s, c) => s + c, 0);

    setState({
      streams,
      totalTokens,
      totalCost,
      totalSessions: summaries.length,
      totalTools,
      totalFailures,
      toolCounts,
      repos: Array.from(repos),
      channels: Array.from(channels),
      latestEvents: allEvents.slice(-50),
    });
  }, [baseDir, date]);

  return state;
}
