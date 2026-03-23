import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleStop } from '../lib/stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

/**
 * Write a mock transcript JSONL file with the given token usage.
 * Each call writes one assistant message entry with the specified usage.
 */
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
    assert.equal(event.tokens.output, 1000);
    assert.equal(event.tokens.cache_read, 2000);
    assert.equal(event.tokens.cache_write, 1000);
  });

  it('updates buffer with cumulative token counts from transcript', () => {
    // Write transcript with two messages — handleStop sums all unique messages
    const transcriptPath = writeTranscript(tmpDir, [
      { input: 5000, output: 1000 },
      { input: 3000, output: 500 },
    ]);

    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: transcriptPath }, store);

    const buffer = store.readBuffer('sess1');
    // sumTokensFromTranscript sums all unique assistant message usages
    assert.equal(buffer.tokens_input, 8000);
    assert.equal(buffer.tokens_output, 1500);
  });

  it('handles missing transcript gracefully (zero tokens)', () => {
    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 0);
  });

  it('recovers buffer when it is missing (premature session end)', () => {
    // Delete the buffer to simulate premature session end
    store.deleteBuffer('sess1');
    assert.equal(store.readBuffer('sess1'), null);

    handleStop({ session_id: 'sess1', cwd: '/tmp' }, store);

    const buffer = store.readBuffer('sess1');
    assert.notEqual(buffer, null, 'Buffer should be reconstructed');
    assert.equal(buffer.session_id, 'sess1');
    assert.ok(buffer.date, 'Reconstructed buffer should have date');
  });
});
