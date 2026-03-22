import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleStop } from '../lib/stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

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

  it('appends agent_stop event with v and token counts from transcript', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      { input: 5000, output: 1000, cache_read: 2000, cache_write: 1000 },
    ]);

    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: transcriptPath }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[0];
    assert.equal(event.event, 'agent_stop');
    assert.equal(event.v, 1);
    assert.equal(event.tokens.input, 5000);
  });

  it('updates buffer with cumulative token counts from transcript', () => {
    // First stop with transcript
    const tp1 = writeTranscript(tmpDir, [
      { input: 5000, output: 1000 },
    ]);
    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: tp1 }, store);

    // Second stop: transcript has all messages (cumulative), so sum = 8000/1500
    const tp2 = path.join(tmpDir, 'transcript2.jsonl');
    fs.writeFileSync(tp2, [
      JSON.stringify({ type: 'assistant', message: { id: 'msg_0', usage: { input_tokens: 5000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_1', usage: { input_tokens: 3000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    ].join('\n') + '\n');
    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: tp2 }, store);

    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 8000);
    assert.equal(buffer.tokens_output, 1500);
  });

  it('handles missing token_usage gracefully', () => {
    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 0);
  });

  it('accumulates interaction_time_sec from last_prompt_ts', () => {
    const baseTs = '2026-03-15T10:00:00.000Z';
    const baseMs = new Date(baseTs).getTime();
    store.updateBuffer('sess1', (buf) => ({
      ...buf,
      interaction_time_sec: 60,
      last_prompt_ts: baseTs,
    }));
    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store, baseMs + 30_000);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.interaction_time_sec, 90);
  });

  it('does not crash when last_prompt_ts is missing', () => {
    store.updateBuffer('sess1', (buf) => ({
      ...buf,
      interaction_time_sec: 45,
    }));
    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store, Date.now());
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.interaction_time_sec, 45);
  });
});
