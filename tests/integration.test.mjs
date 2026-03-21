import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';
import { handleSessionStart } from '../lib/session-start.mjs';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { handlePreToolUse } from '../lib/pre-tool-use.mjs';
import { handlePostToolUse } from '../lib/post-tool-use.mjs';
import { handlePostToolUseFailure } from '../lib/post-tool-use-failure.mjs';
import { handleSubagentStart } from '../lib/subagent-start.mjs';
import { handleSubagentStop } from '../lib/subagent-stop.mjs';
import { handlePreCompact } from '../lib/pre-compact.mjs';
import { handlePostCompact } from '../lib/post-compact.mjs';
import { handleWorktreeCreate } from '../lib/worktree-create.mjs';
import { handleWorktreeRemove } from '../lib/worktree-remove.mjs';
import { handleTaskCompleted } from '../lib/task-completed.mjs';
import { handleStop } from '../lib/stop.mjs';
import { handleSessionEnd } from '../lib/session-end.mjs';

const SESSION_ID = 'integ-test-session-001';
const CHANNEL = 'claude-code';
const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };
const MOCK_COST_RATES = {
  'claude-sonnet-4-6': {
    input_per_1k: 0.003,
    output_per_1k: 0.015,
    cache_read_per_1k: 0.0003,
    cache_write_per_1k: 0.00375,
  },
};

describe('Full lifecycle integration — all 14 hooks end-to-end', () => {
  let tmpDir;
  let store;
  let summary;
  let eventsLines;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-integ-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));

    // ── Step 1: session_start ──────────────────────────────────────────────
    handleSessionStart(
      { session_id: SESSION_ID, cwd: '/tmp', model: 'claude-sonnet-4-6' },
      store,
      CHANNEL,
    );

    // ── Step 2: user_prompt_submit x2 ─────────────────────────────────────
    handleUserPromptSubmit(
      { session_id: SESSION_ID, prompt: 'Please read the config file' },
      store,
    );
    handleUserPromptSubmit(
      { session_id: SESSION_ID, prompt: 'Now run the build script' },
      store,
    );

    // ── Step 3: pre_tool_use (Read) ────────────────────────────────────────
    handlePreToolUse(
      {
        session_id: SESSION_ID,
        tool_name: 'Read',
        tool_use_id: 'tool-read-001',
        tool_input: { file_path: '/tmp/config.json' },
      },
      store,
    );

    // ── Step 4: post_tool_use (Read success) ──────────────────────────────
    handlePostToolUse(
      {
        session_id: SESSION_ID,
        tool_name: 'Read',
        tool_use_id: 'tool-read-001',
      },
      store,
    );

    // ── Step 5: pre_tool_use (Bash) ───────────────────────────────────────
    handlePreToolUse(
      {
        session_id: SESSION_ID,
        tool_name: 'Bash',
        tool_use_id: 'tool-bash-001',
        tool_input: { command: 'npm run build' },
      },
      store,
    );

    // ── Step 6: post_tool_use_failure (Bash) ──────────────────────────────
    handlePostToolUseFailure(
      {
        session_id: SESSION_ID,
        tool_name: 'Bash',
        tool_use_id: 'tool-bash-001',
        error: 'Command exited with code 1',
      },
      store,
    );

    // ── Step 7: subagent_start (Explore) ──────────────────────────────────
    handleSubagentStart(
      {
        session_id: SESSION_ID,
        subagent_id: 'subagent-explore-001',
        subagent_type: 'Explore',
      },
      store,
    );

    // ── Step 8: subagent_stop (Explore) ───────────────────────────────────
    handleSubagentStop(
      {
        session_id: SESSION_ID,
        subagent_id: 'subagent-explore-001',
        subagent_type: 'Explore',
      },
      store,
    );

    // ── Step 9: pre_compact ───────────────────────────────────────────────
    handlePreCompact({ session_id: SESSION_ID }, store);

    // ── Step 10: post_compact ─────────────────────────────────────────────
    handlePostCompact({ session_id: SESSION_ID }, store);

    // ── Step 11: worktree_create ──────────────────────────────────────────
    handleWorktreeCreate(
      {
        session_id: SESSION_ID,
        worktree_path: '/tmp/worktrees/feature-branch',
        branch: 'feature/new-thing',
      },
      store,
    );

    // ── Step 12: worktree_remove ──────────────────────────────────────────
    handleWorktreeRemove(
      {
        session_id: SESSION_ID,
        worktree_path: '/tmp/worktrees/feature-branch',
      },
      store,
    );

    // ── Step 13: task_completed ───────────────────────────────────────────
    handleTaskCompleted(
      {
        session_id: SESSION_ID,
        task_id: 'task-001',
        task_subject: 'Build the feature',
      },
      store,
    );

    // ── Step 14a: stop (first turn) ───────────────────────────────────────
    handleStop(
      {
        session_id: SESSION_ID,
        token_usage: { input: 1000, output: 500, cache_read: 200, cache_write: 100 },
      },
      store,
    );

    // ── Step 14b: stop (second turn) ─────────────────────────────────────
    handleStop(
      {
        session_id: SESSION_ID,
        token_usage: { input: 2000, output: 800, cache_read: 300, cache_write: 150 },
      },
      store,
    );

    // ── Step 15: session_end ──────────────────────────────────────────────
    handleSessionEnd({ session_id: SESSION_ID, cwd: '/tmp' }, store, MOCK_COST_RATES);

    // ── Read back results ─────────────────────────────────────────────────
    const date = new Date().toISOString().slice(0, 10);
    const summaryPath = path.join(tmpDir, 'sessions', date, `${SESSION_ID}.json`);
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

    eventsLines = store.readEvents(date, SESSION_ID);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Session summary assertions ──────────────────────────────────────────

  it('summary: schema_version is 1.0', () => {
    assert.equal(summary.schema_version, '1.0');
  });

  it('summary: tools.total_calls = 2 (Read success + Bash failure)', () => {
    assert.equal(summary.tools.total_calls, 2);
  });

  it('summary: tools.failures = 1', () => {
    assert.equal(summary.tools.failures, 1);
  });

  it('summary: prompts.count = 2', () => {
    assert.equal(summary.prompts.count, 2);
  });

  it('summary: subagents.total_spawned = 1', () => {
    assert.equal(summary.subagents.total_spawned, 1);
  });

  it('summary: compactions.count = 1', () => {
    assert.equal(summary.compactions.count, 1);
  });

  it('summary: worktrees.created = 1', () => {
    assert.equal(summary.worktrees.created, 1);
  });

  it('summary: worktrees.removed = 1', () => {
    assert.equal(summary.worktrees.removed, 1);
  });

  it('summary: tasks.completed = 1', () => {
    assert.equal(summary.tasks.completed, 1);
  });

  it('summary: tokens.total = sum of both stop deltas (input + output)', () => {
    const expectedInput = 1000 + 2000;
    const expectedOutput = 500 + 800;
    assert.equal(summary.tokens.input, expectedInput);
    assert.equal(summary.tokens.output, expectedOutput);
    assert.equal(summary.tokens.total, expectedInput + expectedOutput);
  });

  // ── Events JSONL assertions ─────────────────────────────────────────────

  it('events JSONL has exactly 17 lines (one per hook invocation)', () => {
    // 1 session_start + 2 user_prompt + 2 tool_start + 1 tool_end + 1 tool_failure
    // + 1 subagent_start + 1 subagent_stop + 1 compact_start + 1 compact_end
    // + 1 worktree_create + 1 worktree_remove + 1 task_completed
    // + 2 agent_stop + 1 session_end = 17
    assert.equal(eventsLines.length, 17);
  });

  it('all events have v: 1', () => {
    for (const evt of eventsLines) {
      assert.equal(evt.v, 1, `Event ${evt.event} is missing v: 1`);
    }
  });

  it('events appear in correct order', () => {
    const actualOrder = eventsLines.map((e) => e.event);
    // index 0-16: all 17 events in lifecycle order
    assert.equal(actualOrder[0],  'session_start');
    assert.equal(actualOrder[1],  'user_prompt');
    assert.equal(actualOrder[2],  'user_prompt');
    assert.equal(actualOrder[3],  'tool_start');    // Read pre
    assert.equal(actualOrder[4],  'tool_end');      // Read post
    assert.equal(actualOrder[5],  'tool_start');    // Bash pre
    assert.equal(actualOrder[6],  'tool_failure');  // Bash failure
    assert.equal(actualOrder[7],  'subagent_start');
    assert.equal(actualOrder[8],  'subagent_stop');
    assert.equal(actualOrder[9],  'compact_start');
    assert.equal(actualOrder[10], 'compact_end');
    assert.equal(actualOrder[11], 'worktree_create');
    assert.equal(actualOrder[12], 'worktree_remove');
    assert.equal(actualOrder[13], 'task_completed');
    assert.equal(actualOrder[14], 'agent_stop');    // first stop
    assert.equal(actualOrder[15], 'agent_stop');    // second stop
    assert.equal(actualOrder[16], 'session_end');   // session_end
  });

  // ── File system assertions ──────────────────────────────────────────────

  it('buffer file is deleted after session_end', () => {
    const buffer = store.readBuffer(SESSION_ID);
    assert.equal(buffer, null);
  });

  it('session summary file exists on disk', () => {
    const date = new Date().toISOString().slice(0, 10);
    const summaryPath = path.join(tmpDir, 'sessions', date, `${SESSION_ID}.json`);
    assert.ok(fs.existsSync(summaryPath));
  });

  // ── Event detail assertions ─────────────────────────────────────────────

  it('session_start event has correct session_id and channel', () => {
    const evt = eventsLines[0];
    assert.equal(evt.event, 'session_start');
    assert.equal(evt.session_id, SESSION_ID);
    assert.equal(evt.channel, CHANNEL);
  });

  it('tool_start for Read has redacted tool_input_summary', () => {
    const evt = eventsLines[3];
    assert.equal(evt.event, 'tool_start');
    assert.equal(evt.tool, 'Read');
    assert.equal(evt.tool_input_summary.file_path, '/tmp/config.json');
  });

  it('tool_failure for Bash has error message', () => {
    const evt = eventsLines[6];
    assert.equal(evt.event, 'tool_failure');
    assert.equal(evt.tool, 'Bash');
    assert.equal(evt.error, 'Command exited with code 1');
  });

  it('subagent events reference correct subagent_id and type', () => {
    const start = eventsLines[7];
    const stop = eventsLines[8];
    assert.equal(start.event, 'subagent_start');
    assert.equal(start.subagent_id, 'subagent-explore-001');
    assert.equal(start.subagent_type, 'Explore');
    assert.equal(stop.event, 'subagent_stop');
    assert.equal(stop.subagent_id, 'subagent-explore-001');
  });

  it('worktree_create event has worktree_path and branch', () => {
    const evt = eventsLines[11];
    assert.equal(evt.event, 'worktree_create');
    assert.equal(evt.worktree_path, '/tmp/worktrees/feature-branch');
    assert.equal(evt.branch, 'feature/new-thing');
  });

  it('task_completed event has task_id and task_subject', () => {
    const evt = eventsLines[13];
    assert.equal(evt.event, 'task_completed');
    assert.equal(evt.task_id, 'task-001');
    assert.equal(evt.task_subject, 'Build the feature');
  });

  it('both agent_stop events have token breakdowns', () => {
    const evt1 = eventsLines[14];
    const evt2 = eventsLines[15];
    for (const evt of [evt1, evt2]) {
      assert.equal(evt.event, 'agent_stop');
      assert.ok(evt.tokens);
      assert.ok(typeof evt.tokens.input === 'number');
      assert.ok(typeof evt.tokens.output === 'number');
    }
    // First stop tokens
    assert.equal(evt1.tokens.input, 1000);
    assert.equal(evt1.tokens.output, 500);
    // Second stop tokens
    assert.equal(evt2.tokens.input, 2000);
    assert.equal(evt2.tokens.output, 800);
  });

  it('summary: subagents.total_duration_ms is a non-negative number', () => {
    assert.ok(typeof summary.subagents.total_duration_ms === 'number');
    assert.ok(summary.subagents.total_duration_ms >= 0);
  });

  it('summary: timing fields are present', () => {
    assert.ok(summary.timing.start_time);
    assert.ok(summary.timing.end_time);
    assert.ok(summary.timing.duration_seconds >= 0);
  });
});
