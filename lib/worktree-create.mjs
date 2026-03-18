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
 * Handle a worktree_create hook invocation.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handleWorktreeCreate(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date ?? getTodayDate();

  store.ensureDirs(date);

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'worktree_create',
    session_id: sessionId,
    worktree_path: input.worktree_path,
    branch: input.branch,
  };

  store.appendEvent(date, sessionId, event);

  store.updateBuffer(sessionId, (buffer) => {
    buffer.worktrees_created += 1;
    return buffer;
  });
}

/**
 * Main entrypoint — reads from stdin and calls handleWorktreeCreate.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleWorktreeCreate(input, store);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
