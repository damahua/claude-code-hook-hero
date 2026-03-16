import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSubagentStart } from '../lib/subagent-start.mjs';
import { handleSubagentStop } from '../lib/subagent-stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('subagent hooks', () => {
  let tmpDir, store;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      subagents_total: 0, subagents_by_type: {}
    });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('subagent_start appends event with v, subagent_id, and type', () => {
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'subagent_start');
    assert.equal(event.v, 1);
    assert.equal(event.subagent_id, 'sub-1');
    assert.equal(event.subagent_type, 'Explore');
  });

  it('subagent_start updates buffer counts', () => {
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore' }, store);
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-2', subagent_type: 'Explore' }, store);
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-3', subagent_type: 'general-purpose' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.subagents_total, 3);
    assert.equal(buffer.subagents_by_type.Explore, 2);
    assert.equal(buffer.subagents_by_type['general-purpose'], 1);
  });

  it('subagent_stop appends event with v and subagent_id', () => {
    handleSubagentStop({ session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'subagent_stop');
    assert.equal(event.v, 1);
    assert.equal(event.subagent_id, 'sub-1');
  });
});
