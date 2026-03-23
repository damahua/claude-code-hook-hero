import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionStart } from '../lib/session-start.mjs';
import { handleSessionEnd } from '../lib/session-end.mjs';
import { handleStop } from '../lib/stop.mjs';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

const COST_RATES = {
  'claude-opus-4-6': {
    input_per_1k: 0.005,
    output_per_1k: 0.025,
    cache_read_per_1k: 0.0005,
    cache_write_per_1k: 0.00625,
  },
};

function readStatus(tmpDir) {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
}

function writeTranscript(dir, entries) {
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const lines = entries.map((usage, i) => JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg_${i}`,
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cache_read ?? 0,
        cache_creation_input_tokens: usage.cache_write ?? 0,
      },
    },
  }));
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');
  return transcriptPath;
}

describe('status-integration – status.json written after handleSessionStart', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-integration-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes status.json after handleSessionStart', () => {
    handleSessionStart(
      { session_id: 'sess-start', cwd: '/tmp', model: 'claude-opus-4-6' },
      store,
      'claude-code',
    );

    assert.ok(
      fs.existsSync(path.join(tmpDir, 'status.json')),
      'status.json should exist after handleSessionStart',
    );

    const status = readStatus(tmpDir);
    assert.equal(status.active_sessions, 1);
    assert.equal(status.active.length, 1);
    assert.equal(status.active[0].session_id, 'sess-start');
  });
});

describe('status-integration – full lifecycle start → prompt → stop → end', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-integration-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks status updates across the full session lifecycle', () => {
    const sessionId = 'lifecycle-sess';

    // Step 1: Session start
    handleSessionStart(
      { session_id: sessionId, cwd: '/tmp', model: 'claude-opus-4-6' },
      store,
      'claude-code',
    );

    let status = readStatus(tmpDir);
    assert.equal(status.active_sessions, 1, 'after start: active_sessions should be 1');
    assert.equal(status.today.prompts, 0, 'after start: prompts should be 0');

    // Step 2: User prompt submit
    handleUserPromptSubmit(
      { session_id: sessionId, prompt: 'hello world' },
      store,
    );

    status = readStatus(tmpDir);
    assert.equal(status.active_sessions, 1, 'after prompt: active_sessions should be 1');
    assert.equal(status.today.prompts, 1, 'after prompt: prompts should be 1');

    // Step 3: Stop (with transcript carrying token counts)
    const transcriptPath = writeTranscript(tmpDir, [
      { input: 1000, output: 500, cache_read: 0, cache_write: 0 },
    ]);

    handleStop(
      { session_id: sessionId, cwd: '/tmp', transcript_path: transcriptPath },
      store,
    );

    status = readStatus(tmpDir);
    assert.equal(status.active_sessions, 1, 'after stop: active_sessions should still be 1');
    assert.equal(status.today.tokens.input, 1000, 'after stop: tokens.input should be 1000');
    assert.equal(status.today.tokens.output, 500, 'after stop: tokens.output should be 500');

    // sessions_total includes active sessions
    assert.equal(status.today.sessions_total, 1, 'after stop: sessions_total should include active session');

    // Step 4: Session end
    handleSessionEnd(
      { session_id: sessionId, cwd: '/tmp' },
      store,
      COST_RATES,
    );

    status = readStatus(tmpDir);
    assert.equal(status.active_sessions, 0, 'after end: active_sessions should be 0');
    assert.equal(status.today.sessions_total, 1, 'after end: sessions_total should be 1');
    assert.equal(status.today.prompts, 1, 'after end: prompts should still be 1');
    // Tokens come from the completed session summary
    assert.equal(status.today.tokens.input, 1000, 'after end: tokens.input should be 1000');
    assert.equal(status.today.tokens.output, 500, 'after end: tokens.output should be 500');
  });
});
