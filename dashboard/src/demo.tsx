#!/usr/bin/env node
/**
 * Demo mode: generates fake telemetry data to showcase the dashboard.
 * Run: npx tsx src/demo.tsx
 */
import React from 'react';
import { render } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { App } from './app.js';

const BASE = path.join(os.tmpdir(), 'hook-hero-demo');
const DATE = new Date().toISOString().slice(0, 10);
const EVENTS_DIR = path.join(BASE, 'events', DATE);
const SESSIONS_DIR = path.join(BASE, 'sessions', DATE);
const BUFFER_DIR = path.join(BASE, 'buffer');

// Clean and create dirs
fs.rmSync(BASE, { recursive: true, force: true });
fs.mkdirSync(EVENTS_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(BUFFER_DIR, { recursive: true });

const SESSION_ID = 'demo-session-001';
const now = Date.now();

function ts(offsetMs: number): string {
  return new Date(now + offsetMs).toISOString();
}

function appendEvent(sessionId: string, event: any) {
  const file = path.join(EVENTS_DIR, `${sessionId}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
}

// Write a completed session summary
fs.writeFileSync(path.join(SESSIONS_DIR, 'completed-001.json'), JSON.stringify({
  schema_version: '1.0',
  session_id: 'completed-001',
  channel: 'claude-code',
  timing: { start_time: ts(-3600000), end_time: ts(-1800000), duration_seconds: 1800 },
  context: { project_path: '/Users/leo/Work/nova', project_name: 'nova', repo: 'amplitude/nova', git_branch: 'main', model: 'claude-opus-4-6' },
  tools: { total_calls: 42, by_type: { Read: 15, Edit: 10, Bash: 8, Grep: 5, Agent: 4 }, failures: 2 },
  tokens: { input: 180000, output: 25000, total: 205000, cache_read: 120000, cache_write: 60000, estimated_cost_usd: 4.12 },
  git: { commits_made: 3, branches_touched: ['main'], files_changed: 12, insertions: 245, deletions: 89, prs_created: 1 },
  prompts: { count: 12 },
  subagents: { total_spawned: 4, by_type: { Explore: 2, 'general-purpose': 1, 'code-reviewer': 1 }, total_duration_ms: 240000 },
  compactions: { count: 1 },
  worktrees: { created: 0, removed: 0 },
  tasks: { completed: 8 },
}, null, 2));

// Create a completed session's events
const completedEvents = [
  { v: 1, ts: ts(-3600000), event: 'session_start', session_id: 'completed-001', channel: 'claude-code', context: { repo: 'amplitude/nova' } },
  ...Array.from({ length: 42 }, (_, i) => [
    { v: 1, ts: ts(-3600000 + i * 40000), event: 'tool_start', session_id: 'completed-001', tool: ['Read', 'Edit', 'Bash', 'Grep', 'Agent'][i % 5], tool_use_id: `t-${i}` },
    { v: 1, ts: ts(-3600000 + i * 40000 + 500), event: i === 15 || i === 30 ? 'tool_failure' : 'tool_end', session_id: 'completed-001', tool: ['Read', 'Edit', 'Bash', 'Grep', 'Agent'][i % 5], tool_use_id: `t-${i}`, status: 'success' },
  ]).flat(),
  { v: 1, ts: ts(-1800000), event: 'session_end', session_id: 'completed-001' },
];
for (const ev of completedEvents) appendEvent('completed-001', ev);

// Create an active session (buffer exists, events streaming)
const activeBuffer = {
  session_id: SESSION_ID,
  channel: 'claude-code',
  date: DATE,
  start_time: ts(-300000),
  context: { project_path: '/Users/leo/Work/ampclaw', project_name: 'ampclaw', repo: 'damahua/ampclaw', git_branch: 'feat-dashboard', model: 'claude-sonnet-4-6' },
  prompts_count: 3,
  tools_total: 8,
  tools_by_type: { Read: 4, Edit: 2, Grep: 1, Bash: 1 },
  tools_failures: 0,
  tokens_input: 45000,
  tokens_output: 8000,
  tokens_cache_read: 30000,
  tokens_cache_write: 15000,
  subagents_total: 1,
  subagents_by_type: { Explore: 1 },
  compactions_count: 0,
  worktrees_created: 0,
  worktrees_removed: 0,
  tasks_completed: 2,
};
fs.writeFileSync(path.join(BUFFER_DIR, `${SESSION_ID}.json`), JSON.stringify(activeBuffer));

// Active session events
const activeEvents: any[] = [
  { v: 1, ts: ts(-300000), event: 'session_start', session_id: SESSION_ID, channel: 'claude-code', context: { repo: 'damahua/ampclaw' } },
  { v: 1, ts: ts(-290000), event: 'user_prompt', session_id: SESSION_ID, prompt_length: 45 },
  { v: 1, ts: ts(-280000), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a1' },
  { v: 1, ts: ts(-279000), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a1', status: 'success' },
  { v: 1, ts: ts(-270000), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a2' },
  { v: 1, ts: ts(-269000), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a2', status: 'success' },
  { v: 1, ts: ts(-250000), event: 'user_prompt', session_id: SESSION_ID, prompt_length: 120 },
  { v: 1, ts: ts(-240000), event: 'subagent_start', session_id: SESSION_ID, subagent_id: 'sub-demo-1', subagent_type: 'Explore' },
  { v: 1, ts: ts(-235000), event: 'tool_start', session_id: SESSION_ID, tool: 'Grep', tool_use_id: 'a3' },
  { v: 1, ts: ts(-234000), event: 'tool_end', session_id: SESSION_ID, tool: 'Grep', tool_use_id: 'a3', status: 'success' },
  { v: 1, ts: ts(-200000), event: 'subagent_stop', session_id: SESSION_ID, subagent_id: 'sub-demo-1', subagent_type: 'Explore' },
  { v: 1, ts: ts(-190000), event: 'tool_start', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'a4' },
  { v: 1, ts: ts(-188000), event: 'tool_end', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'a4', status: 'success' },
  { v: 1, ts: ts(-170000), event: 'tool_start', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'a5' },
  { v: 1, ts: ts(-168000), event: 'tool_end', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'a5', status: 'success' },
  { v: 1, ts: ts(-150000), event: 'user_prompt', session_id: SESSION_ID, prompt_length: 30 },
  { v: 1, ts: ts(-140000), event: 'tool_start', session_id: SESSION_ID, tool: 'Bash', tool_use_id: 'a6' },
  { v: 1, ts: ts(-138000), event: 'tool_end', session_id: SESSION_ID, tool: 'Bash', tool_use_id: 'a6', status: 'success' },
  { v: 1, ts: ts(-120000), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a7' },
  { v: 1, ts: ts(-118000), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a7', status: 'success' },
  { v: 1, ts: ts(-100000), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a8' },
  { v: 1, ts: ts(-98000), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'a8', status: 'success' },
  { v: 1, ts: ts(-80000), event: 'agent_stop', session_id: SESSION_ID, tokens: { input: 25000, output: 4000, cache_read: 15000, cache_write: 8000 } },
];
for (const ev of activeEvents) appendEvent(SESSION_ID, ev);

// Now simulate live events trickling in
let eventIndex = 0;
const liveEvents = [
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_start', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'live-1' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_end', session_id: SESSION_ID, tool: 'Edit', tool_use_id: 'live-1', status: 'success' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_start', session_id: SESSION_ID, tool: 'Bash', tool_use_id: 'live-2' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_failure', session_id: SESSION_ID, tool: 'Bash', tool_use_id: 'live-2', error: 'exit code 1' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'live-3' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'live-3', status: 'success' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'subagent_start', session_id: SESSION_ID, subagent_id: 'sub-live-1', subagent_type: 'code-reviewer' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_start', session_id: SESSION_ID, tool: 'Grep', tool_use_id: 'live-4' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_end', session_id: SESSION_ID, tool: 'Grep', tool_use_id: 'live-4', status: 'success' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_start', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'live-5' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'tool_end', session_id: SESSION_ID, tool: 'Read', tool_use_id: 'live-5', status: 'success' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'subagent_stop', session_id: SESSION_ID, subagent_id: 'sub-live-1', subagent_type: 'code-reviewer' }),
  () => ({ v: 1, ts: new Date().toISOString(), event: 'agent_stop', session_id: SESSION_ID, tokens: { input: 20000, output: 4000, cache_read: 15000, cache_write: 7000 } }),
];

const liveInterval = setInterval(() => {
  if (eventIndex >= liveEvents.length) {
    clearInterval(liveInterval);
    return;
  }
  const event = liveEvents[eventIndex]();
  appendEvent(SESSION_ID, event);
  eventIndex++;
}, 2000);

// Render the dashboard pointing at our demo data
const { unmount } = render(<App mode="live" baseDir={BASE} />);

process.on('exit', () => {
  clearInterval(liveInterval);
  fs.rmSync(BASE, { recursive: true, force: true });
});
