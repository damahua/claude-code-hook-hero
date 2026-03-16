import { SessionStore } from './session-store.mjs';
import { readStdin } from './stdin-reader.mjs';

function extractTokenDeltas(input) {
  const usage = input.token_usage || input.usage || {};
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cache_read: usage.cache_read ?? 0,
    cache_write: usage.cache_write ?? 0,
  };
}

export function handleStop(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date;
  const tokens = extractTokenDeltas(input);

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'agent_stop',
    session_id: sessionId,
    tokens,
  };

  store.appendEvent(date, sessionId, event);

  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    tokens_input: (buf.tokens_input ?? 0) + tokens.input,
    tokens_output: (buf.tokens_output ?? 0) + tokens.output,
    tokens_cache_read: (buf.tokens_cache_read ?? 0) + tokens.cache_read,
    tokens_cache_write: (buf.tokens_cache_write ?? 0) + tokens.cache_write,
  }));
}

async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handleStop(input, store);
  } catch {
    // exit 0 on any error
  }
  process.exit(0);
}

main();
