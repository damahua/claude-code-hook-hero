import { readStdin } from './stdin-reader.mjs';
import { SessionStore } from './session-store.mjs';
import { getGitStats } from './git-utils.mjs';
import { calculateCost, loadCostRates } from './cost-calculator.mjs';

/**
 * Read the events JSONL file for a session and compute total subagent duration
 * by pairing subagent_start / subagent_stop events on subagent_id.
 *
 * @param {SessionStore} store
 * @param {string} date
 * @param {string} sessionId
 * @returns {number} total duration in milliseconds
 */
function computeSubagentDuration(store, date, sessionId) {
  try {
    const events = store.readEvents(date, sessionId);
    const starts = new Map();
    let totalMs = 0;

    for (const evt of events) {
      if (evt.event === 'subagent_start' && evt.subagent_id) {
        starts.set(evt.subagent_id, new Date(evt.ts).getTime());
      } else if (evt.event === 'subagent_stop' && evt.subagent_id) {
        const startMs = starts.get(evt.subagent_id);
        if (startMs !== undefined) {
          totalMs += new Date(evt.ts).getTime() - startMs;
          starts.delete(evt.subagent_id);
        }
      }
    }

    return totalMs;
  } catch {
    return 0;
  }
}

/**
 * Build a bare session_end event for sessions with no buffer.
 *
 * @param {string} sessionId
 * @returns {object}
 */
function buildBareSessionEndEvent(sessionId) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    event: 'session_end',
    session_id: sessionId,
  };
}

/**
 * Handle the session_end hook: finalize the session summary, write it to disk,
 * append a session_end event, and delete the buffer.
 *
 * @param {object} input      — parsed hook payload (session_id, cwd)
 * @param {SessionStore} store
 * @param {object} costRates  — cost rate map (injected for testing)
 */
export function handleSessionEnd(input, store, costRates) {
  const sessionId = input.session_id;
  const buffer = store.readBuffer(sessionId);

  if (!buffer) {
    // No buffer — append a bare session_end event if we can determine the date
    const d = new Date(); const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    store.ensureDirs(today);
    store.appendEvent(today, sessionId, buildBareSessionEndEvent(sessionId));
    return;
  }

  const date = buffer.date;
  const now = new Date();
  const endTime = now.toISOString();
  const startMs = new Date(buffer.start_time).getTime();
  const durationSeconds = Math.max(0, (now.getTime() - startMs) / 1000);

  const gitStats = getGitStats(input.cwd, buffer.start_time);

  const cost = calculateCost(
    buffer.context.model,
    {
      input: buffer.tokens_input,
      output: buffer.tokens_output,
      cache_read: buffer.tokens_cache_read,
      cache_write: buffer.tokens_cache_write,
    },
    costRates,
  );

  store.flushEvents(date, sessionId); // Flush pending batch before reading events
  const subagentDurationMs = computeSubagentDuration(store, date, sessionId);

  const summary = {
    schema_version: '1.0',
    session_id: sessionId,
    channel: buffer.channel,
    timing: {
      start_time: buffer.start_time,
      end_time: endTime,
      duration_seconds: durationSeconds,
    },
    context: { ...buffer.context },
    tools: {
      total_calls: buffer.tools_total,
      by_type: buffer.tools_by_type,
      failures: buffer.tools_failures,
    },
    tokens: {
      input: buffer.tokens_input,
      output: buffer.tokens_output,
      total: buffer.tokens_input + buffer.tokens_output,
      cache_read: buffer.tokens_cache_read,
      cache_write: buffer.tokens_cache_write,
      estimated_cost_usd: cost,
    },
    git: { ...gitStats },
    prompts: { count: buffer.prompts_count },
    subagents: {
      total_spawned: buffer.subagents_total,
      by_type: buffer.subagents_by_type,
      total_duration_ms: subagentDurationMs,
    },
    compactions: { count: buffer.compactions_count },
    worktrees: {
      created: buffer.worktrees_created,
      removed: buffer.worktrees_removed,
    },
    tasks: { completed: buffer.tasks_completed },
  };

  const sessionEndEvent = {
    v: 1,
    ts: endTime,
    event: 'session_end',
    session_id: sessionId,
  };

  store.appendEvent(date, sessionId, sessionEndEvent);
  store.flushEvents(date, sessionId); // Flush any remaining batched events
  store.writeSession(date, sessionId, summary);
  store.disableDebug(sessionId); // clean up debug marker (debug logs persist in debug/)
  store.deleteBuffer(sessionId);
}

/**
 * Main entrypoint — reads from stdin and calls handleSessionEnd.
 */
async function main() {
  try {
    const input = await readStdin();
    const configPath = process.env.HOOK_HERO_CONFIG;
    const store = new SessionStore();
    const costRates = loadCostRates(configPath);
    handleSessionEnd(input, store, costRates);
  } catch {
    // Silent fail — exit 0 so Claude Code continues
  }
  process.exit(0);
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
