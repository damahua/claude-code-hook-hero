import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePostToolUseFailure } from '../lib/post-tool-use-failure.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('handlePostToolUseFailure', () => {
  let tmpDir, store;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1',
      date: '2026-03-15',
      tools_total: 0,
      tools_by_type: {},
      tools_failures: 0,
    });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends tool_failure event with v, error, and tool_use_id', () => {
    handlePostToolUseFailure(
      {
        session_id: 'sess1',
        tool_name: 'Bash',
        tool_use_id: 'toolu_xyz',
        error: 'Command exited with code 1',
      },
      store,
    );
    const events = store.readEvents('2026-03-15', 'sess1');
    const event = events[0];
    assert.equal(event.event, 'tool_failure');
    assert.equal(event.v, 1);
    assert.equal(event.tool, 'Bash');
    assert.equal(event.tool_use_id, 'toolu_xyz');
    assert.equal(event.error, 'Command exited with code 1');
  });

  it('updates buffer tools_failures AND tools_total', () => {
    handlePostToolUseFailure(
      {
        session_id: 'sess1',
        tool_name: 'Bash',
        tool_use_id: 'a',
        error: 'fail',
      },
      store,
    );
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tools_failures, 1);
    assert.equal(buffer.tools_total, 1);
    assert.equal(buffer.tools_by_type.Bash, 1);
  });
});
