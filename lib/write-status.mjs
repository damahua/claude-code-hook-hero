import fs from 'node:fs';
import path from 'node:path';
import { calculateCost, loadCostRates } from './cost-calculator.mjs';

/**
 * Get today's date as YYYY-MM-DD.
 * @returns {string}
 */
function getTodayDate() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Build the empty/zero status object.
 * @returns {object}
 */
function buildEmptyStatus() {
  return {
    schema_version: '1.0',
    active_sessions: 0,
    today: {
      sessions_total: 0,
      interaction_time_sec: 0,
      cost_usd: 0,
      tokens: {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
      },
      tool_calls: 0,
      prompts: 0,
      git: {
        commits: 0,
        files_changed: 0,
      },
    },
    active: [],
    updated_at: new Date().toISOString(),
  };
}

/**
 * Read all completed session summaries for today and aggregate their stats.
 *
 * @param {string} sessionsDir - Path to sessions/YYYY-MM-DD/
 * @param {object} status - Status object to mutate
 */
function aggregateCompletedSessions(sessionsDir, status) {
  let files;
  try {
    files = fs.readdirSync(sessionsDir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(sessionsDir, file);
    let summary;
    try {
      summary = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue;
    }

    status.today.sessions_total += 1;

    // Tokens
    const tokens = summary.tokens || {};
    status.today.tokens.input += tokens.input || 0;
    status.today.tokens.output += tokens.output || 0;
    status.today.tokens.cache_read += tokens.cache_read || 0;
    status.today.tokens.cache_write += tokens.cache_write || 0;

    // Cost (sum then round at the end)
    const cost = tokens.estimated_cost_usd;
    if (typeof cost === 'number' && !isNaN(cost)) {
      status.today.cost_usd += cost;
    }

    // Tools and prompts
    const tools = summary.tools || {};
    status.today.tool_calls += tools.total_calls || 0;

    const prompts = summary.prompts || {};
    status.today.prompts += prompts.count || 0;

    // Git
    const git = summary.git || {};
    status.today.git.commits += git.commits_made || 0;
    status.today.git.files_changed += git.files_changed || 0;
  }

  // Round cost to 2 decimal places
  status.today.cost_usd = Math.round(status.today.cost_usd * 100) / 100;
}

/**
 * Extensions that indicate active buffer files (positive match).
 * Skip .lock, .debug, .batch.
 */
const ACTIVE_EXTENSIONS = new Set(['.buf', '.json']);

/**
 * Read all active buffer files and aggregate stats into status.
 *
 * @param {string} bufferDir - Path to buffer/
 * @param {object} status - Status object to mutate
 * @param {object|null} costRates - Cost rates for active session cost calculation
 * @param {SessionStore} store - The session store for reading buffers
 */
function aggregateActiveBuffers(bufferDir, status, costRates, store) {
  let files;
  try {
    files = fs.readdirSync(bufferDir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const now = Date.now();

  // Collect unique session IDs from valid buffer files
  const sessionIds = new Set();
  for (const file of files) {
    const ext = path.extname(file);
    if (!ACTIVE_EXTENSIONS.has(ext)) continue;
    const sessionId = file.slice(0, -ext.length);
    sessionIds.add(sessionId);
  }

  for (const sessionId of sessionIds) {
    let buffer;
    try {
      buffer = store.readBuffer(sessionId);
    } catch {
      continue;
    }
    if (!buffer) continue;

    // Count this as an active session
    status.active_sessions += 1;

    // Accumulate tokens to today totals
    status.today.tokens.input += buffer.tokens_input || 0;
    status.today.tokens.output += buffer.tokens_output || 0;
    status.today.tokens.cache_read += buffer.tokens_cache_read || 0;
    status.today.tokens.cache_write += buffer.tokens_cache_write || 0;

    // Tools and prompts
    status.today.tool_calls += buffer.tools_total || 0;
    status.today.prompts += buffer.prompts_count || 0;

    // Compute duration
    let durationSec = 0;
    if (buffer.start_time) {
      const startMs = new Date(buffer.start_time).getTime();
      if (!isNaN(startMs)) {
        durationSec = Math.max(0, Math.round((now - startMs) / 1000));
      }
    }

    // Compute active session cost
    let sessionCost = 0;
    if (costRates) {
      const model = buffer.context?.model || null;
      if (model) {
        const cost = calculateCost(model, {
          input: buffer.tokens_input || 0,
          output: buffer.tokens_output || 0,
          cache_read: buffer.tokens_cache_read || 0,
          cache_write: buffer.tokens_cache_write || 0,
        }, costRates);
        if (typeof cost === 'number' && !isNaN(cost)) {
          sessionCost = cost;
        }
      }
    }

    // Add active session cost to today total
    status.today.cost_usd += sessionCost;

    // Build active entry
    status.active.push({
      session_id: sessionId,
      project: buffer.context?.project_name || null,
      duration_sec: durationSec,
      cost_usd: sessionCost,
      prompts: buffer.prompts_count || 0,
    });
  }

  // Round final cost to 2 decimal places
  status.today.cost_usd = Math.round(status.today.cost_usd * 100) / 100;
}

/**
 * Write the aggregated status JSON atomically to `status.json` in the store's base directory.
 *
 * @param {import('./session-store.mjs').SessionStore} store
 * @param {object} [costRates] - Optional cost rates; loaded from config if omitted
 */
export function writeStatus(store, costRates) {
  // Load cost rates if not provided
  const rates = costRates !== undefined ? costRates : loadCostRates();

  const today = getTodayDate();
  const status = buildEmptyStatus();

  // Task 2: aggregate completed sessions
  const sessionsDir = path.join(store.baseDir, 'sessions', today);
  aggregateCompletedSessions(sessionsDir, status);

  // Tasks 3 & 4: aggregate active buffers (adds to today totals, costs, builds active[])
  const bufferDir = path.join(store.baseDir, 'buffer');
  aggregateActiveBuffers(bufferDir, status, rates, store);

  // Update timestamp after all aggregation
  status.updated_at = new Date().toISOString();

  // Atomic write: tmp → rename
  const outputPath = path.join(store.baseDir, 'status.json');
  const tmpPath = outputPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, outputPath);
}
