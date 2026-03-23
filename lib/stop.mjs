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

    // Deduplicate by message ID — Claude Code writes multiple entries
    // per API call (streaming progress + final). Keep the last per ID.
    const byMsgId = new Map();
    for (const line of content.split('\n')) {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;
      const usage = entry.message?.usage;
      if (!usage) continue;
      const msgId = entry.message?.id;
      if (!msgId) continue;
      // Last entry per ID wins (has final output_tokens)
      byMsgId.set(msgId, usage);
    }

    for (const usage of byMsgId.values()) {
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

/**
 * Get today's date as YYYY-MM-DD.
 * @returns {string}
 */
function getTodayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

export function handleStop(input, store) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);
  const date = buffer?.date || getTodayDate();

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

  // Ensure the events directory exists (buffer loss means ensureDirs may not have been called)
  store.ensureDirs(date);

  store.appendEvent(date, sessionId, event);
  store.flushEvents(date, sessionId); // Flush — stop events should be on disk immediately

  // Debug mode: capture assistant message + extract thinking from transcript
  if (store.isDebug(sessionId)) {
    const ts = new Date().toISOString();
    // Capture last assistant message
    if (input.last_assistant_message) {
      store.appendDebug(date, sessionId, {
        ts,
        type: 'assistant_message',
        text: input.last_assistant_message,
      });
    }
    // Extract latest thinking block from transcript
    if (transcriptPath) {
      try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
        // Walk backwards to find the most recent assistant message with thinking
        for (let i = lines.length - 1; i >= 0; i--) {
          const entry = JSON.parse(lines[i]);
          if (entry.type !== 'assistant') continue;
          const content = entry.message?.content || [];
          for (const block of content) {
            if (block.type === 'thinking' && block.thinking?.length > 0) {
              store.appendDebug(date, sessionId, {
                ts,
                type: 'thinking',
                text: block.thinking,
              });
              break;
            }
          }
          break; // only check most recent assistant message
        }
      } catch {}
    }
  }

  // Write cumulative totals (replace, not delta — transcript gives full sum)
  // If buffer was lost (premature session_end), reconstruct with date field
  // so event flushing can work on subsequent stops.
  store.updateBuffer(sessionId, (buf) => {
    if (buf === null) {
      // Omit start_time — it would be used as a delta-encoding base
      // that mismatches the events file's session_start timestamp,
      // producing wrong decoded timestamps. Without start_time,
      // events use full ISO strings instead of deltas.
      return {
        session_id: sessionId,
        date,
        tokens_input: tokens.input,
        tokens_output: tokens.output,
        tokens_cache_read: tokens.cache_read,
        tokens_cache_write: tokens.cache_write,
      };
    }
    return {
      ...buf,
      tokens_input: tokens.input,
      tokens_output: tokens.output,
      tokens_cache_read: tokens.cache_read,
      tokens_cache_write: tokens.cache_write,
    };
  });
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
