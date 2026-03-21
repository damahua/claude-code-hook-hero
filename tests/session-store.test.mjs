import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('SessionStore', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDirs creates events/, sessions/, buffer/ directories', () => {
    store.ensureDirs('2026-03-15');
    assert.ok(fs.existsSync(path.join(tmpDir, 'events', '2026-03-15')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'sessions', '2026-03-15')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'buffer')));
  });

  it('appendEvent writes a single JSONL line', () => {
    store.ensureDirs('2026-03-15');
    store.appendEvent('2026-03-15', 'sess1', { v: 1, ts: '2026-03-15T10:00:00Z', event: 'session_start', session_id: 'sess1' });
    const content = fs.readFileSync(path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.event, 'session_start');
  });

  it('appendEvent appends multiple lines', () => {
    store.ensureDirs('2026-03-15');
    store.appendEvent('2026-03-15', 'sess1', { v: 1, event: 'a', session_id: 'sess1' });
    store.appendEvent('2026-03-15', 'sess1', { v: 1, event: 'b', session_id: 'sess1' });
    const lines = fs.readFileSync(path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('createBuffer writes initial buffer JSON', () => {
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', channel: 'claude-code', date: '2026-03-15' });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), 'utf-8'));
    assert.equal(content.session_id, 'sess1');
  });

  it('updateBuffer does locked read-modify-write', () => {
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', tools_total: 0 });
    store.updateBuffer('sess1', (buf) => { buf.tools_total += 1; return buf; });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), 'utf-8'));
    assert.equal(content.tools_total, 1);
  });

  it('readBuffer returns null if no buffer exists', () => {
    const result = store.readBuffer('nonexistent');
    assert.equal(result, null);
  });

  it('writeSession writes to sessions/{date}/', () => {
    store.ensureDirs('2026-03-15');
    store.writeSession('2026-03-15', 'sess1', { schema_version: '1.0', session_id: 'sess1' });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sessions', '2026-03-15', 'sess1.json'), 'utf-8'));
    assert.equal(content.schema_version, '1.0');
  });

  it('deleteBuffer removes the buffer file', () => {
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1' });
    store.deleteBuffer('sess1');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'buffer', 'sess1.json')));
  });

  it('cleanOrphanedBuffers removes buffers older than 24 hours', () => {
    store.ensureDirs('2026-03-15');
    const bufPath = path.join(tmpDir, 'buffer', 'old-sess.json');
    fs.writeFileSync(bufPath, '{}');
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(bufPath, oldTime, oldTime);
    store.cleanOrphanedBuffers();
    assert.ok(!fs.existsSync(bufPath));
  });
});
