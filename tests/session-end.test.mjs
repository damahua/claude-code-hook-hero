import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionEnd } from '../lib/session-end.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('handleSessionEnd', () => {
  let tmpDir, store;
  const mockRates = { 'claude-opus-4-6': { input_per_1k: 0.015, output_per_1k: 0.075, cache_read_per_1k: 0.00375, cache_write_per_1k: 0.01875 } };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', channel: 'claude-code', date: '2026-03-15',
      start_time: '2026-03-15T10:30:00Z',
      context: { project_path: '/tmp', project_name: 'test', directory: '', cwd: '/tmp', repo: null, git_remote_url: null, git_branch: null, model: 'claude-opus-4-6' },
      prompts_count: 3, tools_total: 10, tools_by_type: { Read: 5, Edit: 5 }, tools_failures: 1,
      tokens_input: 50000, tokens_output: 10000, tokens_cache_read: 20000, tokens_cache_write: 10000,
      subagents_total: 1, subagents_by_type: { Explore: 1 },
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 2
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes session summary JSON with correct aggregates', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store, mockRates);

    const summaryPath = path.join(tmpDir, 'sessions', '2026-03-15', 'sess1.json');
    assert.ok(fs.existsSync(summaryPath));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    assert.equal(summary.schema_version, '1.0');
    assert.equal(summary.session_id, 'sess1');
    assert.equal(summary.channel, 'claude-code');
    assert.equal(summary.tools.total_calls, 10);
    assert.equal(summary.tools.failures, 1);
    assert.equal(summary.prompts.count, 3);
    assert.equal(summary.tokens.total, 60000);
    assert.equal(summary.tokens.input, 50000);
    assert.ok(summary.tokens.estimated_cost_usd > 0);
    assert.equal(summary.subagents.total_spawned, 1);
    assert.equal(summary.tasks.completed, 2);
    assert.ok(summary.timing.duration_seconds >= 0);
  });

  it('appends session_end event to JSONL', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store, mockRates);
    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];
    assert.equal(event.event, 'session_end');
    assert.equal(event.v, 1);
  });

  it('deletes buffer after finalization', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store, mockRates);
    assert.equal(store.readBuffer('sess1'), null);
  });

  it('handles missing buffer gracefully', () => {
    handleSessionEnd({ session_id: 'sess2', cwd: '/tmp' }, store, mockRates);
    // Should not throw
  });

  it('sets estimated_cost_usd to null for unknown model', () => {
    store.createBuffer('sess2', {
      session_id: 'sess2', channel: 'claude-code', date: '2026-03-15',
      start_time: '2026-03-15T10:30:00Z',
      context: { project_path: '/tmp', project_name: 'test', directory: '', cwd: '/tmp', repo: null, git_remote_url: null, git_branch: null, model: 'unknown-model' },
      prompts_count: 0, tools_total: 0, tools_by_type: {}, tools_failures: 0,
      tokens_input: 1000, tokens_output: 500, tokens_cache_read: 0, tokens_cache_write: 0,
      subagents_total: 0, subagents_by_type: {},
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 0
    });
    handleSessionEnd({ session_id: 'sess2', cwd: '/tmp' }, store, mockRates);
    const summary = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sessions', '2026-03-15', 'sess2.json'), 'utf-8'));
    assert.equal(summary.tokens.estimated_cost_usd, null);
  });
});
