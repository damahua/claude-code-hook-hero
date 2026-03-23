import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('handleUserPromptSubmit', () => {
  let tmpDir, store;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-15', prompts_count: 0 });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends user_prompt event with prompt_length but not content', () => {
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello world' }, store);
    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[0];
    assert.equal(event.event, 'user_prompt');
    assert.equal(event.v, 1);
    assert.equal(event.prompt_length, 11);
    assert.equal(event.prompt, undefined);
    assert.equal(event.prompt_content, undefined);
  });

  it('increments buffer prompts_count', () => {
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'a' }, store);
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'bb' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.prompts_count, 2);
  });

  it('sets last_prompt_ts to a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello' }, store);
    const after = new Date().toISOString();
    const buffer = store.readBuffer('sess1');
    assert.ok(typeof buffer.last_prompt_ts === 'string', 'last_prompt_ts should be a string');
    assert.ok(buffer.last_prompt_ts >= before, 'last_prompt_ts should be >= before');
    assert.ok(buffer.last_prompt_ts <= after, 'last_prompt_ts should be <= after');
    // Verify it's a valid ISO timestamp by parsing it
    assert.ok(!isNaN(new Date(buffer.last_prompt_ts).getTime()), 'last_prompt_ts should be a valid date');
  });
});
