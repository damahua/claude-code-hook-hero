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
