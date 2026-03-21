import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleStop } from '../lib/stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('handleStop', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends agent_stop event with v and token deltas', () => {
    handleStop({
      session_id: 'sess1', cwd: '/tmp',
      token_usage: { input: 5000, output: 1000, cache_read: 2000, cache_write: 1000 }
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[0];
    assert.equal(event.event, 'agent_stop');
    assert.equal(event.v, 1);
    assert.equal(event.tokens.input, 5000);
  });

  it('updates buffer with cumulative token counts', () => {
    handleStop({ session_id: 'sess1', cwd: '/tmp', token_usage: { input: 5000, output: 1000, cache_read: 0, cache_write: 0 } }, store);
    handleStop({ session_id: 'sess1', cwd: '/tmp', token_usage: { input: 3000, output: 500, cache_read: 0, cache_write: 0 } }, store);

    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 8000);
    assert.equal(buffer.tokens_output, 1500);
  });

  it('handles missing token_usage gracefully', () => {
    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 0);
  });
});
