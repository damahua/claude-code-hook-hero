// tests/stdin-reader.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHookInput } from '../lib/stdin-reader.mjs';

describe('parseHookInput', () => {
  it('parses valid JSON with session_id and cwd', () => {
    const input = JSON.stringify({ session_id: 'abc123', cwd: '/tmp', hook_event_name: 'SessionStart' });
    const result = parseHookInput(input);
    assert.equal(result.session_id, 'abc123');
    assert.equal(result.cwd, '/tmp');
  });

  it('returns null for invalid JSON', () => {
    const result = parseHookInput('not json');
    assert.equal(result, null);
  });

  it('returns null for empty input', () => {
    const result = parseHookInput('');
    assert.equal(result, null);
  });
});
