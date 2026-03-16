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
 * Handle a task_completed hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handleTaskCompleted(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date ?? getTodayDate();

  store.ensureDirs(date);

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'task_completed',
    session_id: sessionId,
    task_id: input.task_id,
    task_subject: input.task_subject,
  };

  store.appendEvent(date, sessionId, event);

  store.updateBuffer(sessionId, (buffer) => {
    buffer.tasks_completed += 1;
    return buffer;
  });
}

/**
 * Main entrypoint — reads from stdin and calls handleTaskCompleted.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleTaskCompleted(input, store);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
