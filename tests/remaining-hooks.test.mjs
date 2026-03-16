import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePreCompact } from '../lib/pre-compact.mjs';
import { handlePostCompact } from '../lib/post-compact.mjs';
import { handleWorktreeCreate } from '../lib/worktree-create.mjs';
import { handleWorktreeRemove } from '../lib/worktree-remove.mjs';
import { handleTaskCompleted } from '../lib/task-completed.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('remaining hooks', () => {
  let tmpDir, store;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1',
      date: '2026-03-15',
      compactions_count: 0,
      worktrees_created: 0,
      worktrees_removed: 0,
      tasks_completed: 0,
    });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pre-compact appends compact_start and increments buffer', () => {
    handlePreCompact({ session_id: 'sess1' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'compact_start');
    assert.equal(event.v, 1);
    assert.equal(store.readBuffer('sess1').compactions_count, 1);
  });

  it('post-compact appends compact_end (no buffer update)', () => {
    handlePostCompact({ session_id: 'sess1' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'compact_end');
    assert.equal(event.v, 1);
  });

  it('worktree-create appends event with path + branch and increments buffer', () => {
    handleWorktreeCreate(
      { session_id: 'sess1', worktree_path: '/tmp/wt', branch: 'feat-x' },
      store,
    );
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'worktree_create');
    assert.equal(event.v, 1);
    assert.equal(event.worktree_path, '/tmp/wt');
    assert.equal(event.branch, 'feat-x');
    assert.equal(store.readBuffer('sess1').worktrees_created, 1);
  });

  it('worktree-remove appends event and increments buffer', () => {
    handleWorktreeRemove({ session_id: 'sess1', worktree_path: '/tmp/wt' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'worktree_remove');
    assert.equal(event.v, 1);
    assert.equal(store.readBuffer('sess1').worktrees_removed, 1);
  });

  it('task-completed appends event with task_id + subject and increments buffer', () => {
    handleTaskCompleted(
      { session_id: 'sess1', task_id: '5', task_subject: 'Fix bug' },
      store,
    );
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'task_completed');
    assert.equal(event.v, 1);
    assert.equal(event.task_id, '5');
    assert.equal(event.task_subject, 'Fix bug');
    assert.equal(store.readBuffer('sess1').tasks_completed, 1);
  });
});
