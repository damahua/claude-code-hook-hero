import fs from 'node:fs';
import { SessionStore } from './session-store.mjs';
import { readStdin } from './stdin-reader.mjs';

/**
 * Parse the Claude Code transcript file and sum token usage
 * from all assistant messages.
 *
 * @param {string} transcriptPath
 * @returns {{ input: number, output: number, cache_read: number, cache_write: number }}
 */
function sumTokensFromTranscript(transcriptPath) {
  const totals = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8').trim();
    if (!content) return totals;
    for (const line of content.split('\n')) {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      const usage = entry.message?.usage;
      if (!usage) continue;
      totals.input += usage.input_tokens ?? 0;
      totals.output += usage.output_tokens ?? 0;
      totals.cache_read += usage.cache_read_input_tokens ?? 0;
      totals.cache_write += usage.cache_creation_input_tokens ?? 0;
    }
  } catch {
    // Transcript unavailable or malformed — return zeros
  }
  return totals;
}

export function handleStop(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date;

  // Parse transcript for cumulative token usage
  const transcriptPath = input.transcript_path;
  const tokens = transcriptPath
    ? sumTokensFromTranscript(transcriptPath)
    : { input: 0, output: 0, cache_read: 0, cache_write: 0 };

  const event = {
    v: 1,
    ts: new Date().toISOString(),
    event: 'agent_stop',
    session_id: sessionId,
    tokens,
  };

  store.appendEvent(date, sessionId, event);

  // Write cumulative totals (replace, not delta — transcript gives full sum)
  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    tokens_input: tokens.input,
    tokens_output: tokens.output,
    tokens_cache_read: tokens.cache_read,
    tokens_cache_write: tokens.cache_write,
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
