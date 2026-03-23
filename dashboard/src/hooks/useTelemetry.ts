import { useState, useEffect, useCallback } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageCodec } from '../../../lib/storage-codec.mjs';
import { SessionStore } from '../../../lib/session-store.mjs';
import type { AgentStream, StreamEvent } from '../components/EventStream.js';

const DEFAULT_BASE = path.join(os.homedir(), '.claude', 'hook-hero');
const codec = new StorageCodec();

function today(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Read events from a file — auto-detects JSONL or binary msgpack format */
function parseEventsFile(filePath: string): StreamEvent[] {
  try {
    const buf = fs.readFileSync(filePath);
    return codec.decodeAllFrames(buf) as StreamEvent[];
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

function buildStreamsFromEvents(events: StreamEvent[], todayStartMs?: number): Map<string, AgentStream> {
  const todayStart = todayStartMs ?? new Date(today() + 'T00:00:00').getTime();
  const streams = new Map<string, AgentStream>();

  // Deduplicate events — hooks can fire multiple times for the same event,
  // and batch flush + initEventFile can produce duplicates.
  const seen = new Set<string>();
  const dedupedEvents: StreamEvent[] = [];
  for (const ev of events) {
    const key = `${(ev as any).session_id}|${ev.ts}|${ev.event}|${ev.tool || ''}|${(ev as any).tool_use_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEvents.push(ev);
  }

  for (const ev of dedupedEvents) {
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
      const ctx = (ev as any).context;
      const projectName = ctx?.project_name
        || (ctx?.cwd === os.homedir() ? '~' : ctx?.cwd ? path.basename(ctx.cwd) : null);
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
        todayCost: 0,
        promptCount: 0,
        debugEnabled: false,
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
      const ctx = (ev as any).context;
      const projectName = ctx?.project_name
        || (ctx?.cwd === os.homedir() ? '~' : ctx?.cwd ? path.basename(ctx.cwd) : null);
      const dirLabel = projectName ? ` [${projectName}]` : '';
      if (channel) {
        stream.channel = channel;
        stream.label = `${channel} · ${sessionId.slice(0, 8)}${dirLabel}`;
      }
    }

    // Track prompt count (to distinguish interactive vs CLI)
    if (ev.event === 'user_prompt') {
      stream.promptCount++;
    }

    // Track tool counts
    if ((ev.event === 'tool_end' || ev.event === 'tool_failure') && ev.tool) {
      stream.toolCounts[ev.tool] = (stream.toolCounts[ev.tool] || 0) + 1;
    }
    if (ev.event === 'tool_failure') {
      stream.failures++;
    }

    // Track token usage from agent_stop events (cumulative from transcript)
    // Also track tokens-before-today for per-day cost calculation
    if (ev.event === 'agent_stop') {
      const tokens = (ev as any).tokens;
      if (tokens && (tokens.input > 0 || tokens.output > 0 || tokens.cache_read > 0 || tokens.cache_write > 0)) {
        const evTime = new Date(ev.ts).getTime();
        // Save last tokens snapshot before today
        if (evTime < todayStart) {
          (stream as any)._tokensBeforeToday = { ...tokens };
        }
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

  // Compute todayCost per stream: total cost - cost before today
  const costFn = (t: any) => (t.input || 0) / 1000 * 0.005 + (t.output || 0) / 1000 * 0.025 +
    (t.cache_read || 0) / 1000 * 0.0005 + (t.cache_write || 0) / 1000 * 0.00625;

  for (const stream of streams.values()) {
    if (stream.tokens) {
      const totalCost = costFn(stream.tokens);
      const beforeToday = (stream as any)._tokensBeforeToday;
      if (beforeToday) {
        stream.todayCost = Math.max(0, totalCost - costFn(beforeToday));
      } else {
        // Session started today — all cost is today's
        stream.todayCost = totalCost;
      }
    }
  }

  // Filter ghosts and mark idle streams
  const LIFECYCLE_EVENTS = new Set(['session_start', 'session_end']);
  const IDLE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
  const now = Date.now();

  for (const [id, stream] of streams) {
    const hasActivity = stream.events.some(ev => !LIFECYCLE_EVENTS.has(ev.event));
    const hasBuffer = fs.existsSync(path.join(DEFAULT_BASE, 'buffer', `${id}.buf`))
      || fs.existsSync(path.join(DEFAULT_BASE, 'buffer', `${id}.json`));

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

    // Check debug mode — always, regardless of buffer existence
    stream.debugEnabled = fs.existsSync(path.join(DEFAULT_BASE, 'buffer', `${id}.debug`));

    // Read buffer for active sessions — tokens + fill missing project name
    if (hasBuffer) {
      try {
        const bufPath = fs.existsSync(path.join(DEFAULT_BASE, 'buffer', `${id}.buf`))
          ? path.join(DEFAULT_BASE, 'buffer', `${id}.buf`)
          : path.join(DEFAULT_BASE, 'buffer', `${id}.json`);
        const buf = codec.decode(fs.readFileSync(bufPath));

        // Tokens
        const ti = buf.tokens_input ?? 0;
        const to = buf.tokens_output ?? 0;
        const cr = buf.tokens_cache_read ?? 0;
        const cw = buf.tokens_cache_write ?? 0;
        if (ti > 0 || to > 0 || cr > 0 || cw > 0) {
          stream.tokens = { input: ti, output: to, cache_read: cr, cache_write: cw };
        }

        // Fill missing project name from buffer context
        const bufProject = buf.context?.project_name;
        if (bufProject && !stream.label.includes('[')) {
          stream.label = stream.label + ` [${bufProject}]`;
        }
      } catch { /* ignore read errors */ }
    }
  }

  return streams;
}

/** Compute AI time and human time from events — only count time within [startMs, endMs) */
function computeTimeDurations(streams: AgentStream[], startMs: number, endMs: number): { aiTimeMs: number; humanTimeMs: number } {
  let aiTimeMs = 0;
  let humanTimeMs = 0;

  for (const stream of streams) {
    let lastPromptTime: number | null = null;
    let lastStopTime: number | null = null;

    for (const ev of stream.events) {
      const t = new Date(ev.ts).getTime();

      if (ev.event === 'user_prompt') {
        if (lastStopTime !== null && t >= startMs && t < endMs) {
          const gap = t - Math.max(lastStopTime, startMs);
          if (gap > 0 && gap < 10 * 60 * 1000) {
            humanTimeMs += gap;
          }
        }
        lastPromptTime = t;
      } else if (ev.event === 'agent_stop') {
        if (lastPromptTime !== null) {
          // Clamp to today's range
          const from = Math.max(lastPromptTime, startMs);
          const to = Math.min(t, endMs);
          if (to > from) {
            aiTimeMs += to - from;
          }
        }
        lastPromptTime = null;
        lastStopTime = t;
      }
    }

    // If AI is currently working — only for active (not done) streams
    if (lastPromptTime !== null && stream.active && !stream.done) {
      const from = Math.max(lastPromptTime, startMs);
      const to = Math.min(Date.now(), endMs);
      if (to > from) {
        aiTimeMs += to - from;
      }
    }
  }

  return { aiTimeMs, humanTimeMs };
}

export interface TelemetryState {
  streams: AgentStream[];
  totalTokens: number;
  todayCost: number;
  activeCost: number;
  allTimeTokens: number;
  allTimeCost: number;
  totalSessions: number;
  totalPrompts: number;
  interactivePrompts: number;
  cliPrompts: number;
  totalTools: number;
  totalFailures: number;
  toolCounts: Record<string, number>;
  repos: string[];
  channels: string[];
  latestEvents: StreamEvent[];
  aiTimeMs: number;
  humanTimeMs: number;
}

const EMPTY_STATE: TelemetryState = {
  streams: [],
  totalTokens: 0,
  todayCost: 0,
  activeCost: 0,
  allTimeTokens: 0,
  allTimeCost: 0,
  totalSessions: 0,
  totalPrompts: 0,
  interactivePrompts: 0,
  cliPrompts: 0,
  totalTools: 0,
  totalFailures: 0,
  toolCounts: {},
  repos: [],
  channels: [],
  latestEvents: [],
  aiTimeMs: 0,
  humanTimeMs: 0,
};

/** Sum tokens and cost from all session summaries across all dates */
function computeAllTimeStats(baseDir: string): { tokens: number; cost: number } {
  let tokens = 0;
  let cost = 0;
  const sessionsBase = path.join(baseDir, 'sessions');
  try {
    const dates = fs.readdirSync(sessionsBase).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const date of dates) {
      const dir = path.join(sessionsBase, date);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.buf'));
      for (const file of files) {
        try {
          const summary = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          const st = summary.tokens || {};
          tokens += st.total || 0;
          cost += (st.input || 0) / 1000 * 0.005 + (st.output || 0) / 1000 * 0.025 +
                  (st.cache_read || 0) / 1000 * 0.0005 + (st.cache_write || 0) / 1000 * 0.00625;
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* sessions dir missing */ }
  return { tokens, cost };
}

export function useLiveTelemetry(rawBaseDir?: string): TelemetryState {
  const baseDir = rawBaseDir || DEFAULT_BASE;
  const [state, setState] = useState<TelemetryState>(EMPTY_STATE);

  const refresh = useCallback(() => {
    try {
    const date = today();
    const bufferDir = path.join(baseDir, 'buffer');

    // Collect dates to read: today + any dates from active buffers
    const datesToRead = new Set<string>([date]);
    try {
      for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'))) {
        try {
          const buf = codec.decode(fs.readFileSync(path.join(bufferDir, f))) as any;
          if (buf?.date) datesToRead.add(buf.date);
        } catch {}
      }
    } catch {}

    // Read events from all relevant dates
    const allEvents: StreamEvent[] = [];
    for (const d of datesToRead) {
      const eventsDir = path.join(baseDir, 'events', d);
      if (fs.existsSync(eventsDir)) {
        const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.events'));
        for (const file of files) {
          allEvents.push(...parseEventsFile(path.join(eventsDir, file)));
        }
      }
    }

    // Also read pending batch events for active sessions
    try {
      const store = new SessionStore(baseDir, codec);
      for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.batch'))) {
        const sessionId = f.replace('.batch', '');
        try {
          const batchEvents = store.readBatchEvents(sessionId);
          allEvents.push(...batchEvents);
        } catch { /* skip unreadable batches */ }
      }
    } catch { /* buffer dir missing */ }

    // Sort by timestamp
    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // All "today" metrics use timestamp-based filtering
    const todayStart = new Date(date + 'T00:00:00').getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;

    const streamsMap = buildStreamsFromEvents(allEvents, todayStart);
    const streams = Array.from(streamsMap.values());
    let todayCost = 0;
    let activeCost = 0;
    let totalTokens = 0;
    const toolCounts: Record<string, number> = {};
    let totalFailures = 0;
    const repos = new Set<string>();
    const channels = new Set<string>();

    // Collect active buffer session IDs to avoid double-counting
    const activeBufferIds = new Set<string>();
    try {
      for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'))) {
        activeBufferIds.add(f.replace(/\.(json|buf)$/, ''));
      }
    } catch {}

    // Read session summaries for repos/channels (all dates)
    // Cost only from today's summaries
    for (const d of datesToRead) {
    const sessionsDir = path.join(baseDir, 'sessions', d);
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'));
      for (const file of files) {
        const sessionId = file.replace('.json', '');
        if (activeBufferIds.has(sessionId)) continue;
        const summary = readSessionSummary(path.join(sessionsDir, file));
        if (!summary) continue;

        if (d === date) {
          const st = summary.tokens || {};
          totalTokens += st.total || 0;
          todayCost += (st.input || 0) / 1000 * 0.005 + (st.output || 0) / 1000 * 0.025 +
                       (st.cache_read || 0) / 1000 * 0.0005 + (st.cache_write || 0) / 1000 * 0.00625;
        }

        if (summary.context?.repo) repos.add(summary.context.repo);
        if (summary.channel) channels.add(summary.channel);
      }
    }
    } // end datesToRead loop

    // Count ops, errors, tool counts by timestamp from raw events
    for (const ev of allEvents) {
      const t = new Date(ev.ts).getTime();
      if (t < todayStart || t >= todayEnd) continue;
      if (ev.event === 'tool_end' || ev.event === 'tool_failure') {
        const tool = ev.tool || 'unknown';
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
      if (ev.event === 'tool_failure') {
        totalFailures++;
      }
    }

    // Add active stream cost
    for (const stream of streams) {
      if (!stream.done) {
        if (stream.channel) channels.add(stream.channel);
        if (stream.tokens) {
          totalTokens += stream.tokens.input + stream.tokens.output;
          const t = stream.tokens;
          activeCost +=
            (t.input / 1000) * 0.005 +
            (t.output / 1000) * 0.025 +
            (t.cache_read / 1000) * 0.0005 +
            (t.cache_write / 1000) * 0.00625;
        }
      }
    }

    // Count active buffer files as active sessions (deduplicate by session ID)
    let activeSessions = 0;
    if (fs.existsSync(bufferDir)) {
      const bufferSessionIds = new Set<string>();
      for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'))) {
        bufferSessionIds.add(f.replace(/\.(json|buf)$/, ''));
      }
      activeSessions = bufferSessionIds.size;
    }

    // Count finalized sessions — only today
    let finalizedSessions = 0;
    {
      const sd = path.join(baseDir, 'sessions', date);
      if (fs.existsSync(sd)) {
        finalizedSessions = fs.readdirSync(sd).filter(f => f.endsWith('.json') || f.endsWith('.buf')).length;
      }
    }
    const totalSessions = finalizedSessions + activeSessions;

    const totalTools = Object.values(toolCounts).reduce((s, c) => s + c, 0);

    // Count prompts by timestamp — only events that happened today
    let totalPrompts = 0;
    let cliPrompts = 0;

    // Per-session prompt counts for CLI detection
    const sessionPrompts = new Map<string, { count: number; done: boolean }>();
    for (const ev of allEvents) {
      const t = new Date(ev.ts).getTime();
      if (t < todayStart || t >= todayEnd) continue;
      const sid = (ev as any).session_id;
      if (ev.event === 'user_prompt') {
        totalPrompts++;
        if (sid) {
          const s = sessionPrompts.get(sid) || { count: 0, done: false };
          s.count++;
          sessionPrompts.set(sid, s);
        }
      }
      if (ev.event === 'session_end' && sid) {
        const s = sessionPrompts.get(sid) || { count: 0, done: false };
        s.done = true;
        sessionPrompts.set(sid, s);
      }
    }
    for (const s of sessionPrompts.values()) {
      if (s.done && s.count <= 1) cliPrompts += s.count;
    }
    const interactivePrompts = totalPrompts - cliPrompts;

    // All-time stats (finalized sessions across all dates + active streams)
    const allTime = computeAllTimeStats(baseDir);
    let allTimeTokens = allTime.tokens;
    let allTimeCost = allTime.cost;
    // Add active stream contributions
    for (const stream of streams) {
      if (!stream.done && stream.tokens) {
        allTimeTokens += stream.tokens.input + stream.tokens.output;
        const t = stream.tokens;
        allTimeCost +=
          (t.input / 1000) * 0.015 +
          (t.output / 1000) * 0.075 +
          (t.cache_read / 1000) * 0.00375 +
          (t.cache_write / 1000) * 0.01875;
      }
    }

    const { aiTimeMs, humanTimeMs } = computeTimeDurations(streams, todayStart, todayEnd);

    setState({
      streams,
      totalTokens,
      todayCost,
      activeCost,
      allTimeTokens,
      allTimeCost,
      totalSessions,
      totalPrompts,
      interactivePrompts,
      cliPrompts,
      totalTools,
      totalFailures,
      toolCounts,
      repos: Array.from(repos),
      channels: Array.from(channels),
      latestEvents: allEvents.slice(-50),
      aiTimeMs,
      humanTimeMs,
    });
    } catch (err) {
      // Log refresh errors to stderr for debugging
      process.stderr.write(`[hook-hero] refresh error: ${err}\n`);
    }
  }, [baseDir]);

  useEffect(() => {
    refresh();

    // Watch for file changes — today + any dates with active buffers
    const bufferDir = path.join(baseDir, 'buffer');
    const watchDirs: string[] = [bufferDir];
    const watchDates = new Set<string>([today()]);
    try {
      for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'))) {
        try {
          const buf = codec.decode(fs.readFileSync(path.join(bufferDir, f))) as any;
          if (buf?.date) watchDates.add(buf.date);
        } catch {}
      }
    } catch {}
    for (const d of watchDates) {
      watchDirs.push(path.join(baseDir, 'events', d));
      watchDirs.push(path.join(baseDir, 'sessions', d));
    }

    const watchers: fs.FSWatcher[] = [];
    const dirs = watchDirs;

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

export function useHistoryTelemetry(rawBaseDir?: string, date?: string): TelemetryState {
  const baseDir = rawBaseDir || DEFAULT_BASE;
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
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'));
      for (const file of files) {
        const summary = readSessionSummary(path.join(sessionsDir, file));
        if (!summary) continue;
        summaries.push(summary);
        const st = summary.tokens || {};
        totalTokens += st.total || 0;
        // Recalculate cost from raw tokens (baked cost is often $0 due to null model)
        totalCost += (st.input || 0) / 1000 * 0.005 + (st.output || 0) / 1000 * 0.025 +
                     (st.cache_read || 0) / 1000 * 0.0005 + (st.cache_write || 0) / 1000 * 0.00625;
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
      const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.events'));
      for (const file of files) {
        allEvents.push(...parseEventsFile(path.join(eventsDir, file)));
      }
    }
    allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const targetStart = new Date((date || today()) + 'T00:00:00').getTime();
    const streamsMap = buildStreamsFromEvents(allEvents, targetStart);
    const streams = Array.from(streamsMap.values());

    const totalTools = Object.values(toolCounts).reduce((s, c) => s + c, 0);
    const totalPrompts = streams.reduce((s, st) => s + st.promptCount, 0);
    const cliPromptsH = streams
      .filter(st => st.done && st.promptCount <= 1)
      .reduce((s, st) => s + st.promptCount, 0);
    const interactivePromptsH = totalPrompts - cliPromptsH;
    const allTime = computeAllTimeStats(baseDir || DEFAULT_BASE);

    setState({
      streams,
      totalTokens,
      todayCost: totalCost,
      activeCost: 0,
      allTimeTokens: allTime.tokens,
      allTimeCost: allTime.cost,
      totalSessions: summaries.length,
      totalPrompts,
      interactivePrompts: interactivePromptsH,
      cliPrompts: cliPromptsH,
      totalTools,
      totalFailures,
      toolCounts,
      repos: Array.from(repos),
      channels: Array.from(channels),
      latestEvents: allEvents.slice(-50),
      ...computeTimeDurations(streams, new Date((date || today()) + 'T00:00:00').getTime(), new Date((date || today()) + 'T00:00:00').getTime() + 86400000),
    });
  }, [baseDir, date]);

  return state;
}
