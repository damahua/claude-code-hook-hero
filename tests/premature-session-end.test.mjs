import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';
import { handleSessionStart } from '../lib/session-start.mjs';
import { handleSessionEnd } from '../lib/session-end.mjs';
import { handleStop } from '../lib/stop.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('Premature session-end recovery', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-22');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('cleanOrphanedBuffers with grace period', () => {
    it('does NOT delete buffer with recent activity even if finalized summary exists', () => {
      // Simulate: session finalized (summary exists) but buffer was just recreated (session resumed)
      store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-22' });
      store.writeSession('2026-03-22', 'sess1', { session_id: 'sess1', tokens: {} });

      store.cleanOrphanedBuffers();

      // Buffer should still exist — recent mtime protects it
      const buf = store.readBuffer('sess1');
      assert.notEqual(buf, null, 'Buffer should survive cleanup when recently modified');
    });

    it('removes stale finalized summary when buffer has recent activity', () => {
      store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-22' });
      store.writeSession('2026-03-22', 'sess1', { session_id: 'sess1', tokens: {} });

      store.cleanOrphanedBuffers();

      // Stale summary should be removed
      const summaryPath = path.join(tmpDir, 'sessions', '2026-03-22', 'sess1.json');
      assert.ok(!fs.existsSync(summaryPath), 'Stale finalized summary should be removed');
    });

    it('deletes buffer for truly finished sessions (old mtime)', () => {
      store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-22' });
      store.writeSession('2026-03-22', 'sess1', { session_id: 'sess1', tokens: {} });

      // Make buffer file old
      const bufPath = path.join(tmpDir, 'buffer', 'sess1.json');
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      fs.utimesSync(bufPath, oldTime, oldTime);

      store.cleanOrphanedBuffers();

      // Buffer should be deleted — old mtime means it's truly done
      assert.equal(store.readBuffer('sess1'), null, 'Old buffer with finalized summary should be deleted');
    });

    it('does NOT delete buffer when .batch has recent activity', () => {
      // Only a .batch file (no .buf), but with finalized summary
      store.writeSession('2026-03-22', 'sess1', { session_id: 'sess1', tokens: {} });
      const batchPath = path.join(tmpDir, 'buffer', 'sess1.batch');
      fs.writeFileSync(batchPath, 'pending-events');

      store.cleanOrphanedBuffers();

      // Batch should survive — recent mtime
      assert.ok(fs.existsSync(batchPath), '.batch file should survive cleanup when recently modified');
    });

    it('still removes truly orphaned buffers older than 24h', () => {
      const bufPath = path.join(tmpDir, 'buffer', 'orphan.json');
      fs.writeFileSync(bufPath, '{}');
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
      fs.utimesSync(bufPath, oldTime, oldTime);

      store.cleanOrphanedBuffers();

      assert.ok(!fs.existsSync(bufPath), 'Truly orphaned old buffer should be deleted');
    });
  });

  describe('session-start removes stale finalized summary', () => {
    it('removes stale summary when session resumes', () => {
      const summaryPath = path.join(tmpDir, 'sessions', '2026-03-22', 'sess-resume.json');
      store.writeSession('2026-03-22', 'sess-resume', { session_id: 'sess-resume', tokens: {} });

      assert.ok(fs.existsSync(summaryPath), 'Summary should exist before resume');

      handleSessionStart(
        { session_id: 'sess-resume', cwd: tmpDir },
        store,
        'claude-code'
      );

      // Stale summary should be removed
      assert.ok(!fs.existsSync(summaryPath), 'Stale summary should be removed on session resume');
      // New buffer should exist
      assert.notEqual(store.readBuffer('sess-resume'), null, 'New buffer should be created');
    });
  });

  describe('stop hook recovers missing buffer', () => {
    it('reconstructs buffer with date when buffer is null', () => {
      // No buffer exists for this session — simulates post-premature-end state
      store.ensureDirs('2026-03-22');

      handleStop({ session_id: 'no-buf', cwd: tmpDir }, store);

      // Buffer should be recreated with date field
      const buf = store.readBuffer('no-buf');
      assert.notEqual(buf, null, 'Buffer should be recreated by stop hook');
      assert.ok(buf.date, 'Reconstructed buffer should have date field');
      assert.equal(buf.session_id, 'no-buf');
    });

    it('still updates existing buffer normally', () => {
      store.createBuffer('sess1', {
        session_id: 'sess1', date: '2026-03-22',
        tokens_input: 100, tokens_output: 50,
        tokens_cache_read: 0, tokens_cache_write: 0,
      });

      handleStop({ session_id: 'sess1', cwd: tmpDir }, store);

      const buf = store.readBuffer('sess1');
      assert.equal(buf.date, '2026-03-22', 'Date should be preserved');
    });
  });

  describe('full premature-end-then-resume scenario', () => {
    it('survives the full sequence: start → premature end → resume → another session start', () => {
      // 1. Session A starts
      handleSessionStart({ session_id: 'sessA', cwd: tmpDir }, store, 'claude-code');
      assert.notEqual(store.readBuffer('sessA'), null, 'sessA buffer should exist after start');

      // 2. Session A ends prematurely
      handleSessionEnd({ session_id: 'sessA', cwd: tmpDir }, store, {});
      assert.equal(store.readBuffer('sessA'), null, 'sessA buffer should be deleted after end');
      const summaryPath = path.join(tmpDir, 'sessions', store.readBuffer('sessA') === null ? '2026-03-22' : '', 'sessA.json');

      // 3. Session A resumes (same session_id)
      handleSessionStart({ session_id: 'sessA', cwd: tmpDir }, store, 'claude-code');
      assert.notEqual(store.readBuffer('sessA'), null, 'sessA buffer should exist after resume');

      // Stale summary should be cleaned
      const staleExists = fs.existsSync(path.join(tmpDir, 'sessions', '2026-03-22', 'sessA.json'));
      assert.ok(!staleExists, 'Stale finalized summary should be removed on resume');

      // 4. Session B starts (triggers cleanOrphanedBuffers)
      handleSessionStart({ session_id: 'sessB', cwd: tmpDir }, store, 'claude-code');

      // Session A's buffer should survive Session B's cleanup
      const bufAfterB = store.readBuffer('sessA');
      assert.notEqual(bufAfterB, null, 'sessA buffer should survive cleanup from sessB start');
    });
  });

  describe('readBatchEvents', () => {
    it('returns empty array when no batch file exists', () => {
      const events = store.readBatchEvents('nonexistent');
      assert.deepEqual(events, []);
    });
  });
});
