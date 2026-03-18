import { SessionStore } from './session-store.mjs';
import { readStdin } from './stdin-reader.mjs';

export function handlePostToolUseFailure(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date;
  const toolName = input.tool_name;

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'tool_failure',
    session_id: sessionId,
    tool: toolName,
    tool_use_id: input.tool_use_id,
    error: input.error || 'unknown error',
  };

  store.appendEvent(date, sessionId, event);

  // Debug mode: capture full error details
  if (store.isDebug(sessionId)) {
    store.appendDebug(date, sessionId, {
      ts: new Date().toISOString(),
      type: 'tool_error',
      tool: toolName,
      tool_use_id: input.tool_use_id,
      error: input.tool_error || input.error,
    });
  }

  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    tools_failures: (buf.tools_failures ?? 0) + 1,
    tools_total: (buf.tools_total ?? 0) + 1,
    tools_by_type: {
      ...buf.tools_by_type,
      [toolName]: (buf.tools_by_type?.[toolName] ?? 0) + 1,
    },
  }));
}

async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handlePostToolUseFailure(input, store);
  } catch {
    // exit 0 on any error
  }
  process.exit(0);
}

main();
