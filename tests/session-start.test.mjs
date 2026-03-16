import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionStart } from '../lib/session-start.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleSessionStart', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates buffer file and writes session_start event', () => {
    const input = { session_id: 'sess1', cwd: '/tmp/myproject' };
    handleSessionStart(input, store, 'claude-code');

    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.session_id, 'sess1');
    assert.equal(buffer.channel, 'claude-code');
    assert.equal(buffer.prompts_count, 0);
    assert.equal(buffer.tools_total, 0);
    assert.equal(buffer.tokens_input, 0);
    assert.equal(buffer.subagents_total, 0);

    const date = buffer.date;
    const eventFile = path.join(tmpDir, 'events', date, 'sess1.jsonl');
    assert.ok(fs.existsSync(eventFile));
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'session_start');
    assert.equal(event.v, 1);
    assert.equal(event.channel, 'claude-code');
  });

  it('cleans orphaned buffers on start', () => {
    store.ensureDirs('2026-03-15');
    const oldBuf = path.join(tmpDir, 'buffer', 'old-sess.json');
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    fs.writeFileSync(oldBuf, '{}');
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(oldBuf, oldTime, oldTime);

    handleSessionStart({ session_id: 'new-sess', cwd: '/tmp' }, store, 'claude-code');
    assert.ok(!fs.existsSync(oldBuf));
  });
});
