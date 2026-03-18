import { SessionStore } from './session-store.mjs';
import { readStdin } from './stdin-reader.mjs';

export function handlePostToolUse(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date;

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'tool_end',
    session_id: sessionId,
    tool: input.tool_name,
    tool_use_id: input.tool_use_id,
    status: 'success',
  };

  store.appendEvent(date, sessionId, event);

  // Debug mode: capture tool response
  if (store.isDebug(sessionId)) {
    store.appendDebug(date, sessionId, {
      ts: new Date().toISOString(),
      type: 'tool_result',
      tool: input.tool_name,
      tool_use_id: input.tool_use_id,
      result: input.tool_response,
    });
  }

  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    tools_total: (buf.tools_total ?? 0) + 1,
    tools_by_type: {
      ...buf.tools_by_type,
      [input.tool_name]: (buf.tools_by_type?.[input.tool_name] ?? 0) + 1,
    },
  }));
}

async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handlePostToolUse(input, store);
  } catch {
    // exit 0 on any error
  }
  process.exit(0);
}

main();
