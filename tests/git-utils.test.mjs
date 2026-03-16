import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitRemote, extractProjectName } from '../lib/git-utils.mjs';

describe('parseGitRemote', () => {
  it('parses SSH remote URL', () => {
    assert.equal(parseGitRemote('git@github.com:amplitude/nova.git'), 'amplitude/nova');
  });
  it('parses HTTPS remote URL', () => {
    assert.equal(parseGitRemote('https://github.com/amplitude/nova.git'), 'amplitude/nova');
  });
  it('handles URL without .git suffix', () => {
    assert.equal(parseGitRemote('https://github.com/amplitude/nova'), 'amplitude/nova');
  });
  it('returns null for invalid URL', () => {
    assert.equal(parseGitRemote('not-a-url'), null);
  });
});

describe('extractProjectName', () => {
  it('extracts last path component', () => {
    assert.equal(extractProjectName('/Users/leo/Work/nova'), 'nova');
  });
});
