import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './stdin-reader.mjs';
import { SessionStore } from './session-store.mjs';
import { getGitContext } from './git-utils.mjs';

const SCHEMA_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'schema.json'
);

/**
 * Detect the channel based on environment.
 *
 * @returns {'claude-code'|'claude-cli'}
 */
function detectChannel() {
  if (process.stdin.isTTY || process.env.CLAUDE_CODE) {
    return 'claude-code';
  }
  return 'claude-cli';
}

/**
 * Get today's date as YYYY-MM-DD.
 *
 * @returns {string}
 */
function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the initial buffer object for a new session.
 *
 * @param {string} sessionId
 * @param {string} channel
 * @param {string} date
 * @param {object} context
 * @returns {object}
 */
function buildBuffer(sessionId, channel, date, context) {
  return {
    session_id: sessionId,
    channel,
    date,
    start_time: new Date().toISOString(),
    context,
    prompts_count: 0,
    tools_total: 0,
    tools_by_type: {},
    tools_failures: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    subagents_total: 0,
    subagents_by_type: {},
    compactions_count: 0,
    worktrees_created: 0,
    worktrees_removed: 0,
    tasks_completed: 0,
  };
}

/**
 * Build the session_start event object.
 *
 * @param {string} sessionId
 * @param {string} channel
 * @param {object} context
 * @returns {object}
 */
function buildSessionStartEvent(sessionId, channel, context) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    event: 'session_start',
    session_id: sessionId,
    channel,
    context,
  };
}

/**
 * Copy the bundled schema.json to the hook-hero base directory so consumers
 * can reference a stable local path for validation.
 *
 * @param {string} baseDir — hook-hero base directory (e.g. ~/.claude/hook-hero)
 */
function copySchema(baseDir) {
  const dest = path.join(baseDir, 'schema.json');
  fs.copyFileSync(SCHEMA_SRC, dest);
}

/**
 * Handle a session_start hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 * @param {string} channel
 */
export function handleSessionStart(input, store, channel) {
  const sessionId = input.session_id;
  const date = getTodayDate();

  store.ensureDirs(date);
  copySchema(store.baseDir);
  store.cleanOrphanedBuffers();

  const gitContext = getGitContext(input.cwd);
  const model = input.model ?? input.model_id ?? null;
  const context = { ...gitContext, model };

  const buffer = buildBuffer(sessionId, channel, date, context);
  store.createBuffer(sessionId, buffer);

  const event = buildSessionStartEvent(sessionId, channel, context);
  store.appendEvent(date, sessionId, event);
}

/**
 * Main entrypoint — reads from stdin and calls handleSessionStart.
 */
async function main() {
  try {
    const input = await readStdin();
    const channel = detectChannel();
    const store = new SessionStore();
    handleSessionStart(input, store, channel);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
    process.exit(0);
  }
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
