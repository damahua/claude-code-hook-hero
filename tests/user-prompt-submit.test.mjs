import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleUserPromptSubmit', () => {
  let tmpDir, store;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-15', prompts_count: 0 });
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends user_prompt event with prompt_length but not content', () => {
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello world' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
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
});
