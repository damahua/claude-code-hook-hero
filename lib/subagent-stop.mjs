import { readStdin } from './stdin-reader.mjs';
import { SessionStore } from './session-store.mjs';

/**
 * Get today's date as YYYY-MM-DD.
 *
 * @returns {string}
 */
function getTodayDate() {
  const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * Build the subagent_stop event object.
 *
 * @param {string} sessionId
 * @param {string} subagentId
 * @param {string} subagentType
 * @returns {object}
 */
function buildSubagentStopEvent(sessionId, subagentId, subagentType) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    event: 'subagent_stop',
    session_id: sessionId,
    subagent_id: subagentId,
    subagent_type: subagentType,
  };
}

/**
 * Handle a subagent_stop hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handleSubagentStop(input, store) {
  const sessionId = input.session_id;
  const subagentId = input.subagent_id;
  const subagentType = input.subagent_type;

  const buffer = store.readBuffer(sessionId);
  if (!buffer) {
    throw new Error(`Buffer not found for session ${sessionId}`);
  }

  const date = buffer.date;

  const event = buildSubagentStopEvent(sessionId, subagentId, subagentType);
  store.appendEvent(date, sessionId, event);
}

/**
 * Main entrypoint — reads from stdin and calls handleSubagentStop.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleSubagentStop(input, store);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
