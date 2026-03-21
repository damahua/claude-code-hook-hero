import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitRemote, extractProjectName } from '../lib/git-utils.mjs';

describe('parseGitRemote', () => {
  it('parses SSH remote URL', () => {
    assert.equal(parseGitRemote('git@github.com:acme/my-app.git'), 'acme/my-app');
  });
  it('parses HTTPS remote URL', () => {
    assert.equal(parseGitRemote('https://github.com/acme/my-app.git'), 'acme/my-app');
  });
  it('handles URL without .git suffix', () => {
    assert.equal(parseGitRemote('https://github.com/acme/my-app'), 'acme/my-app');
  });
  it('returns null for invalid URL', () => {
    assert.equal(parseGitRemote('not-a-url'), null);
  });
});

describe('extractProjectName', () => {
  it('extracts last path component', () => {
    assert.equal(extractProjectName('/Users/you/Work/my-app'), 'nova');
  });
});
