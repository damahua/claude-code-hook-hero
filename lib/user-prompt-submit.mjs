import { SessionStore } from './session-store.mjs';
import { readStdin } from './stdin-reader.mjs';
import { writeStatus } from './write-status.mjs';

export function handleUserPromptSubmit(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date;

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'user_prompt',
    session_id: sessionId,
    prompt_length: (input.prompt || '').length,
  };

  store.appendEvent(date, sessionId, event);

  // Debug mode: capture the full prompt text
  if (store.isDebug(sessionId)) {
    store.appendDebug(date, sessionId, {
      ts: new Date().toISOString(),
      type: 'user_prompt',
      text: input.prompt,
    });
  }

  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    prompts_count: (buf.prompts_count ?? 0) + 1,
    last_prompt_ts: new Date().toISOString(),
  }));
  try { writeStatus(store); } catch { /* status write is best-effort */ }
}

async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleUserPromptSubmit(input, store);
  } catch {
    // exit 0 on any error
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
