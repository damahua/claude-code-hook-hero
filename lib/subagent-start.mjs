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
 * Build the subagent_start event object.
 *
 * @param {string} sessionId
 * @param {string} subagentId
 * @param {string} subagentType
 * @returns {object}
 */
function buildSubagentStartEvent(sessionId, subagentId, subagentType) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    event: 'subagent_start',
    session_id: sessionId,
    subagent_id: subagentId,
    subagent_type: subagentType,
  };
}

/**
 * Handle a subagent_start hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handleSubagentStart(input, store) {
  const sessionId = input.session_id;
  const subagentId = input.subagent_id;
  const subagentType = input.subagent_type;

  const buffer = store.readBuffer(sessionId);
  if (!buffer) {
    throw new Error(`Buffer not found for session ${sessionId}`);
  }

  const date = buffer.date;

  const event = buildSubagentStartEvent(sessionId, subagentId, subagentType);
  store.appendEvent(date, sessionId, event);

  store.updateBuffer(sessionId, (buffer) => {
    if (!buffer) return buffer;
    return {
      ...buffer,
      subagents_total: (buffer.subagents_total ?? 0) + 1,
      subagents_by_type: {
        ...buffer.subagents_by_type,
        [subagentType]: (buffer.subagents_by_type?.[subagentType] ?? 0) + 1,
      },
    };
  });
}

/**
 * Main entrypoint — reads from stdin and calls handleSubagentStart.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleSubagentStart(input, store);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
