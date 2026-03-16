import { readStdin } from './stdin-reader.mjs';
import { SessionStore } from './session-store.mjs';

/**
 * Get today's date as YYYY-MM-DD.
 *
 * @returns {string}
 */
function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Handle a post_compact hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handlePostCompact(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date ?? getTodayDate();

  store.ensureDirs(date);

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'compact_end',
    session_id: sessionId,
  };

  store.appendEvent(date, sessionId, event);
}

/**
 * Main entrypoint — reads from stdin and calls handlePostCompact.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handlePostCompact(input, store);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
