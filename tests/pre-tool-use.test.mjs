import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePreToolUse } from '../lib/pre-tool-use.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('handlePreToolUse', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-15' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends tool_start event with v, tool_use_id and redacted input', () => {
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Read',
      tool_use_id: 'toolu_123',
      tool_input: { file_path: '/src/Main.java', content: 'secret stuff' },
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];

    assert.equal(event.event, 'tool_start');
    assert.equal(event.v, 1);
    assert.equal(event.tool, 'Read');
    assert.equal(event.tool_use_id, 'toolu_123');
    assert.equal(event.tool_input_summary.file_path, '/src/Main.java');
    assert.equal(event.tool_input_summary.content, undefined);
  });

  it('keeps safe keys and removes unsafe keys from tool_input_summary', () => {
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Grep',
      tool_use_id: 'toolu_456',
      tool_input: {
        pattern: 'test.*',
        glob: '**/*.js',
        path: '/src',
        url: 'https://example.com',
        file_path: '/src/app.js',
        secret_key: 'should-be-removed',
        password: 'secret123',
        api_token: 'xyz789',
      },
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];
    const summary = event.tool_input_summary;

    assert.equal(summary.pattern, 'test.*');
    assert.equal(summary.glob, '**/*.js');
    assert.equal(summary.path, '/src');
    assert.equal(summary.url, 'https://example.com');
    assert.equal(summary.file_path, '/src/app.js');
    assert.equal(summary.secret_key, undefined);
    assert.equal(summary.password, undefined);
    assert.equal(summary.api_token, undefined);
  });

  it('truncates command to first 100 characters', () => {
    const longCommand = 'a'.repeat(150);
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Bash',
      tool_use_id: 'toolu_789',
      tool_input: { command: longCommand },
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];

    assert.equal(event.tool_input_summary.command.length, 100);
    assert.equal(event.tool_input_summary.command, 'a'.repeat(100));
  });

  it('includes session_id and ts in event', () => {
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Read',
      tool_use_id: 'toolu_123',
      tool_input: { file_path: '/test.txt' },
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];

    assert.equal(event.session_id, 'sess1');
    assert.ok(event.ts, 'ts field should exist');
    assert.ok(typeof event.ts === 'string', 'ts should be a string');
  });

  it('handles tool_input not provided (defaults to empty object)', () => {
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Read',
      tool_use_id: 'toolu_123',
    }, store);

    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[events.length - 1];

    assert.equal(event.event, 'tool_start');
    assert.deepEqual(event.tool_input_summary, {});
  });
});
