# Menu Bar Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `status.json` writer to Hook Hero that aggregates today's metrics (active sessions, interaction time, cost) so a separate macOS menu bar app can display them.

**Architecture:** A new `lib/write-status.mjs` module reads today's completed sessions (JSON) and active buffers, computes aggregated metrics, and writes `~/.claude/hook-hero/status.json` atomically. Four existing hooks (SessionStart, SessionEnd, Stop, UserPromptSubmit) call it as a side effect. An `interaction_time_sec` accumulator is added to session buffers, updated on each Stop hook by pairing user_prompt/agent_stop events.

**Tech Stack:** Node.js ES modules, `node:fs`, `node:path`, `node:test`, `node:assert/strict`

**Spec:** `docs/specs/2026-03-22-menubar-status-design.md`

**Worktree:** `.claude/worktrees/feature-menubar-status/` on branch `feature/menubar-status`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/write-status.mjs` | Create | Reads sessions + buffers, computes aggregates, writes `status.json` atomically |
| `lib/stop.mjs` | Modify (lines 114-136) | Add `interaction_time_sec` accumulator to buffer update |
| `lib/session-start.mjs` | Modify (line 148) | Call `writeStatus()` after creating buffer |
| `lib/session-end.mjs` | Modify (line 145) | Call `writeStatus()` after deleting buffer |
| `lib/user-prompt-submit.mjs` | Modify (line 28) | Call `writeStatus()` after updating buffer |
| `tests/write-status.test.mjs` | Create | Unit tests for the status writer |
| `tests/status-integration.test.mjs` | Create | Integration tests for hook-triggered status writes |
| `config/status-schema.json` | Create | JSON Schema for `status.json` (consumer reference) |

---

### Task 1: Create `write-status.mjs` — core status aggregator

**Files:**
- Create: `lib/write-status.mjs`
- Test: `tests/write-status.test.mjs`

- [ ] **Step 1: Write failing test — empty state (no sessions, no buffers)**

```javascript
// tests/write-status.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeStatus } from '../lib/write-status.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

describe('writeStatus', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-status-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('writes status.json with zeros when no sessions exist', () => {
    writeStatus(store);

    const statusPath = path.join(tmpDir, 'status.json');
    assert.ok(fs.existsSync(statusPath), 'status.json should exist');

    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    assert.equal(status.schema_version, '1.0');
    assert.equal(status.active_sessions, 0);
    assert.equal(status.today.sessions_total, 0);
    assert.equal(status.today.interaction_time_sec, 0);
    assert.equal(status.today.cost_usd, 0);
    assert.equal(status.today.tokens.input, 0);
    assert.equal(status.today.tokens.output, 0);
    assert.equal(status.today.tokens.cache_read, 0);
    assert.equal(status.today.tokens.cache_write, 0);
    assert.equal(status.today.tool_calls, 0);
    assert.equal(status.today.prompts, 0);
    assert.equal(status.today.git.commits, 0);
    assert.equal(status.today.git.files_changed, 0);
    assert.deepEqual(status.active, []);
    assert.ok(status.updated_at);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/write-status.test.mjs`
Expected: FAIL — `writeStatus` not found

- [ ] **Step 3: Write minimal implementation — empty state only**

```javascript
// lib/write-status.mjs
import fs from 'node:fs';
import path from 'node:path';

/**
 * Get today's date as YYYY-MM-DD.
 * @returns {string}
 */
function getTodayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * Build an empty status object.
 * @returns {object}
 */
function emptyStatus() {
  return {
    schema_version: '1.0',
    active_sessions: 0,
    today: {
      sessions_total: 0,
      interaction_time_sec: 0,
      cost_usd: 0,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      tool_calls: 0,
      prompts: 0,
      git: { commits: 0, files_changed: 0 },
    },
    active: [],
    updated_at: new Date().toISOString(),
  };
}

/**
 * Compute aggregated status from today's sessions and active buffers,
 * then write atomically to status.json.
 *
 * @param {import('./session-store.mjs').SessionStore} store
 */
export function writeStatus(store) {
  const status = emptyStatus();

  // Atomic write: tmp file + rename
  const statusPath = path.join(store.baseDir, 'status.json');
  const tmpPath = statusPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, statusPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/write-status.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/write-status.mjs tests/write-status.test.mjs
git commit -m "feat: add write-status.mjs skeleton — empty state"
```

---

### Task 2: Aggregate completed sessions into status

**Files:**
- Modify: `lib/write-status.mjs`
- Modify: `tests/write-status.test.mjs`

- [ ] **Step 1: Write failing test — completed sessions aggregation**

Add to `tests/write-status.test.mjs`:

```javascript
  it('aggregates completed sessions for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    store.ensureDirs(today);

    // Write two completed session summaries
    store.writeSession(today, 'sess1', {
      schema_version: '1.0',
      session_id: 'sess1',
      channel: 'claude-code',
      timing: { start_time: '2026-03-22T09:00:00Z', end_time: '2026-03-22T09:30:00Z', duration_seconds: 1800 },
      context: { project_name: 'my-app', model: 'claude-opus-4-6' },
      tools: { total_calls: 50, by_type: { Read: 30, Edit: 20 }, failures: 2 },
      tokens: { input: 100000, output: 20000, total: 120000, cache_read: 50000, cache_write: 10000, estimated_cost_usd: 2.50 },
      git: { commits_made: 2, files_changed: 5, insertions: 100, deletions: 20, branches_touched: ['main'], prs_created: 0 },
      prompts: { count: 10 },
      subagents: { total_spawned: 1, by_type: {}, total_duration_ms: 0 },
      compactions: { count: 0 },
      worktrees: { created: 0, removed: 0 },
      tasks: { completed: 3 },
    });

    store.writeSession(today, 'sess2', {
      schema_version: '1.0',
      session_id: 'sess2',
      channel: 'claude-code',
      timing: { start_time: '2026-03-22T10:00:00Z', end_time: '2026-03-22T10:45:00Z', duration_seconds: 2700 },
      context: { project_name: 'other-app', model: 'claude-sonnet-4-6' },
      tools: { total_calls: 80, by_type: { Read: 40, Bash: 40 }, failures: 1 },
      tokens: { input: 80000, output: 15000, total: 95000, cache_read: 30000, cache_write: 5000, estimated_cost_usd: 1.80 },
      git: { commits_made: 1, files_changed: 3, insertions: 50, deletions: 10, branches_touched: ['feat'], prs_created: 1 },
      prompts: { count: 15 },
      subagents: { total_spawned: 0, by_type: {}, total_duration_ms: 0 },
      compactions: { count: 1 },
      worktrees: { created: 0, removed: 0 },
      tasks: { completed: 2 },
    });

    writeStatus(store);

    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.today.sessions_total, 2);
    assert.equal(status.today.cost_usd, 4.30); // 2.50 + 1.80
    assert.equal(status.today.tokens.input, 180000); // 100000 + 80000
    assert.equal(status.today.tokens.output, 35000);
    assert.equal(status.today.tokens.cache_read, 80000);
    assert.equal(status.today.tokens.cache_write, 15000);
    assert.equal(status.today.tool_calls, 130); // 50 + 80
    assert.equal(status.today.prompts, 25); // 10 + 15
    assert.equal(status.today.git.commits, 3); // 2 + 1
    assert.equal(status.today.git.files_changed, 8); // 5 + 3
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/write-status.test.mjs`
Expected: FAIL — all values are 0

- [ ] **Step 3: Implement session reading and aggregation**

Update `writeStatus` in `lib/write-status.mjs`:

```javascript
/**
 * Read all completed session summaries for today.
 * @param {SessionStore} store
 * @param {string} today — YYYY-MM-DD
 * @returns {object[]}
 */
function readTodaySessions(store, today) {
  const sessionsDir = path.join(store.baseDir, 'sessions', today);
  let files;
  try {
    files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const sessions = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
      sessions.push(data);
    } catch { /* skip malformed */ }
  }
  return sessions;
}

export function writeStatus(store) {
  const today = getTodayDate();
  const status = emptyStatus();

  // Aggregate completed sessions
  const sessions = readTodaySessions(store, today);
  status.today.sessions_total = sessions.length;

  for (const s of sessions) {
    status.today.cost_usd += s.tokens?.estimated_cost_usd ?? 0;
    status.today.tokens.input += s.tokens?.input ?? 0;
    status.today.tokens.output += s.tokens?.output ?? 0;
    status.today.tokens.cache_read += s.tokens?.cache_read ?? 0;
    status.today.tokens.cache_write += s.tokens?.cache_write ?? 0;
    status.today.tool_calls += s.tools?.total_calls ?? 0;
    status.today.prompts += s.prompts?.count ?? 0;
    status.today.git.commits += s.git?.commits_made ?? 0;
    status.today.git.files_changed += s.git?.files_changed ?? 0;
  }

  // Round cost to avoid floating point drift
  status.today.cost_usd = Math.round(status.today.cost_usd * 100) / 100;

  // Atomic write
  const statusPath = path.join(store.baseDir, 'status.json');
  const tmpPath = statusPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, statusPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/write-status.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/write-status.mjs tests/write-status.test.mjs
git commit -m "feat: aggregate completed sessions into status.json"
```

---

### Task 3: Add active buffer aggregation to status

**Files:**
- Modify: `lib/write-status.mjs`
- Modify: `tests/write-status.test.mjs`

- [ ] **Step 1: Write failing test — active buffers show up in status**

Add to `tests/write-status.test.mjs`:

```javascript
  it('counts active buffers and includes them in active array', () => {
    const today = new Date().toISOString().slice(0, 10);
    store.ensureDirs(today);

    store.createBuffer('active1', {
      session_id: 'active1',
      channel: 'claude-code',
      date: today,
      start_time: new Date(Date.now() - 600_000).toISOString(), // 10 min ago
      context: { project_name: 'my-app', model: 'claude-opus-4-6' },
      prompts_count: 5,
      tools_total: 20,
      tools_by_type: { Read: 10, Edit: 10 },
      tools_failures: 0,
      tokens_input: 30000,
      tokens_output: 8000,
      tokens_cache_read: 15000,
      tokens_cache_write: 3000,
      subagents_total: 0,
      subagents_by_type: {},
      compactions_count: 0,
      worktrees_created: 0,
      worktrees_removed: 0,
      tasks_completed: 0,
    });

    store.createBuffer('active2', {
      session_id: 'active2',
      channel: 'claude-code',
      date: today,
      start_time: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
      context: { project_name: 'other-app', model: 'claude-sonnet-4-6' },
      prompts_count: 3,
      tools_total: 10,
      tools_by_type: { Bash: 10 },
      tools_failures: 1,
      tokens_input: 20000,
      tokens_output: 5000,
      tokens_cache_read: 10000,
      tokens_cache_write: 2000,
      subagents_total: 0,
      subagents_by_type: {},
      compactions_count: 0,
      worktrees_created: 0,
      worktrees_removed: 0,
      tasks_completed: 0,
    });

    writeStatus(store);

    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.active_sessions, 2);
    assert.equal(status.active.length, 2);

    // Active buffers also count toward today's totals
    assert.equal(status.today.tokens.input, 50000); // 30000 + 20000
    assert.equal(status.today.prompts, 8); // 5 + 3
    assert.equal(status.today.tool_calls, 30); // 20 + 10

    // Check active array entries
    const a1 = status.active.find(a => a.session_id === 'active1');
    assert.ok(a1);
    assert.equal(a1.project, 'my-app');
    assert.equal(a1.prompts, 5);
    assert.ok(a1.duration_sec >= 599); // ~10 min wall clock
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/write-status.test.mjs`
Expected: FAIL — `active_sessions` is 0

- [ ] **Step 3: Implement active buffer reading**

Add to `lib/write-status.mjs`:

```javascript
/**
 * Read all active session buffers (files in buffer/ directory).
 * Uses a positive match on known buffer extensions to avoid picking up
 * .lock, .debug, .batch, or any other non-buffer files.
 * @param {SessionStore} store
 * @returns {object[]}
 */
function readActiveBuffers(store) {
  const bufferDir = path.join(store.baseDir, 'buffer');
  let entries;
  try {
    entries = fs.readdirSync(bufferDir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const seen = new Set();
  const buffers = [];
  for (const entry of entries) {
    // Only process actual buffer data files (.json or .buf)
    if (!/\.(json|buf)$/.test(entry)) continue;
    const sessionId = entry.replace(/\.(json|buf)$/, '');
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);

    const buf = store.readBuffer(sessionId);
    if (buf) buffers.push(buf);
  }
  return buffers;
}
```

Update `writeStatus` to include buffer aggregation:

```javascript
export function writeStatus(store) {
  const today = getTodayDate();
  const status = emptyStatus();

  // Aggregate completed sessions
  const sessions = readTodaySessions(store, today);
  status.today.sessions_total = sessions.length;

  for (const s of sessions) {
    status.today.cost_usd += s.tokens?.estimated_cost_usd ?? 0;
    status.today.tokens.input += s.tokens?.input ?? 0;
    status.today.tokens.output += s.tokens?.output ?? 0;
    status.today.tokens.cache_read += s.tokens?.cache_read ?? 0;
    status.today.tokens.cache_write += s.tokens?.cache_write ?? 0;
    status.today.tool_calls += s.tools?.total_calls ?? 0;
    status.today.prompts += s.prompts?.count ?? 0;
    status.today.git.commits += s.git?.commits_made ?? 0;
    status.today.git.files_changed += s.git?.files_changed ?? 0;
  }

  // Aggregate active buffers
  const buffers = readActiveBuffers(store);
  const now = Date.now();
  status.active_sessions = buffers.length;

  for (const buf of buffers) {
    status.today.tokens.input += buf.tokens_input ?? 0;
    status.today.tokens.output += buf.tokens_output ?? 0;
    status.today.tokens.cache_read += buf.tokens_cache_read ?? 0;
    status.today.tokens.cache_write += buf.tokens_cache_write ?? 0;
    status.today.tool_calls += buf.tools_total ?? 0;
    status.today.prompts += buf.prompts_count ?? 0;

    // Active sessions also contribute to sessions_total
    status.today.sessions_total += 1;

    // Build active entry
    const startMs = buf.start_time ? new Date(buf.start_time).getTime() : now;
    status.active.push({
      session_id: buf.session_id,
      project: buf.context?.project_name ?? null,
      duration_sec: Math.round((now - startMs) / 1000),
      cost_usd: 0, // cost calculated later when we add interaction_time
      prompts: buf.prompts_count ?? 0,
    });
  }

  // Round cost to avoid floating point drift
  status.today.cost_usd = Math.round(status.today.cost_usd * 100) / 100;

  // Atomic write
  const statusPath = path.join(store.baseDir, 'status.json');
  const tmpPath = statusPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, statusPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/write-status.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/write-status.mjs tests/write-status.test.mjs
git commit -m "feat: aggregate active buffers into status.json"
```

---

### Task 4: Add active session cost calculation using cost rates

**Files:**
- Modify: `lib/write-status.mjs`
- Modify: `tests/write-status.test.mjs`

- [ ] **Step 1: Write failing test — active session cost from tokens + cost rates**

Add to `tests/write-status.test.mjs`:

```javascript
  it('calculates cost for active sessions using cost rates', () => {
    const today = new Date().toISOString().slice(0, 10);
    store.ensureDirs(today);

    const costRates = {
      'claude-opus-4-6': {
        input_per_1k: 0.005,
        output_per_1k: 0.025,
        cache_read_per_1k: 0.0005,
        cache_write_per_1k: 0.00625,
      },
    };

    store.createBuffer('active1', {
      session_id: 'active1',
      channel: 'claude-code',
      date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'test', model: 'claude-opus-4-6' },
      prompts_count: 1,
      tools_total: 0,
      tools_by_type: {},
      tools_failures: 0,
      tokens_input: 10000,  // 10k * 0.005 = 0.05
      tokens_output: 2000,  // 2k * 0.025 = 0.05
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      subagents_total: 0,
      subagents_by_type: {},
      compactions_count: 0,
      worktrees_created: 0,
      worktrees_removed: 0,
      tasks_completed: 0,
    });

    writeStatus(store, costRates);

    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.active[0].cost_usd, 0.10); // 0.05 + 0.05
    assert.equal(status.today.cost_usd, 0.10);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/write-status.test.mjs`
Expected: FAIL — `cost_usd` is 0 for active sessions

- [ ] **Step 3: Add cost rates parameter and active cost calculation**

Update `writeStatus` signature to accept optional `costRates`:

```javascript
import { calculateCost, loadCostRates } from './cost-calculator.mjs';

/**
 * @param {SessionStore} store
 * @param {object} [costRates] — injected for testing; loaded from config if omitted
 */
export function writeStatus(store, costRates) {
  if (!costRates) {
    try { costRates = loadCostRates(process.env.HOOK_HERO_CONFIG); } catch { costRates = {}; }
  }

  // ... existing code ...

  for (const buf of buffers) {
    // ... existing aggregation ...

    // Calculate cost for active session
    const activeCost = calculateCost(
      buf.context?.model,
      { input: buf.tokens_input ?? 0, output: buf.tokens_output ?? 0,
        cache_read: buf.tokens_cache_read ?? 0, cache_write: buf.tokens_cache_write ?? 0 },
      costRates
    ) ?? 0;

    status.today.cost_usd += activeCost;

    status.active.push({
      session_id: buf.session_id,
      project: buf.context?.project_name ?? null,
      duration_sec: Math.round((now - startMs) / 1000),
      cost_usd: Math.round(activeCost * 100) / 100,
      prompts: buf.prompts_count ?? 0,
    });
  }

  status.today.cost_usd = Math.round(status.today.cost_usd * 100) / 100;
  // ... atomic write ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/write-status.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/write-status.mjs tests/write-status.test.mjs
git commit -m "feat: calculate active session cost from tokens and cost rates"
```

---

### Task 5: Add `interaction_time_sec` accumulator to Stop hook

**Files:**
- Modify: `lib/stop.mjs` (lines 114-136)
- Modify: `tests/stop.test.mjs`

The Stop hook fires at the end of each AI turn. We compute interaction time as the duration between the most recent `user_prompt` event and the current `agent_stop` event. This accumulates across turns.

- [ ] **Step 1: Write failing test — interaction time accumulates on stop**

Add to `tests/stop.test.mjs`:

```javascript
  it('accumulates interaction_time_sec in buffer on each stop', () => {
    // Create buffer with initial interaction_time_sec = 60 (1 min from prior turns)
    // last_prompt_ts is set to a known time
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0,
      interaction_time_sec: 60,
      last_prompt_ts: '2026-03-15T10:00:00.000Z',
    });

    const transcriptPath = writeTranscript(tmpDir, [
      { input: 5000, output: 1000, cache_read: 0, cache_write: 0 },
    ]);

    // Inject `now` = 30 seconds after last_prompt_ts for deterministic test
    const nowMs = new Date('2026-03-15T10:00:30.000Z').getTime();
    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: transcriptPath }, store, nowMs);

    const buf = store.readBuffer('sess1');
    assert.equal(buf.interaction_time_sec, 90); // 60 prior + 30 new
  });

  it('handles missing last_prompt_ts gracefully', () => {
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0,
      interaction_time_sec: 45,
      // no last_prompt_ts
    });

    const transcriptPath = writeTranscript(tmpDir, [
      { input: 1000, output: 500 },
    ]);

    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: transcriptPath }, store);

    const buf = store.readBuffer('sess1');
    assert.equal(buf.interaction_time_sec, 45); // unchanged — no prompt to measure from
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stop.test.mjs`
Expected: FAIL — `interaction_time_sec` undefined in buffer

- [ ] **Step 3: Update Stop handler to accumulate interaction time**

Update `handleStop` signature to accept optional `nowMs` (for testability):

```javascript
export function handleStop(input, store, nowMs) {
```

Then modify the `updateBuffer` call (around line 117):

```javascript
  const stopTime = nowMs ?? Date.now();

  store.updateBuffer(sessionId, (buf) => {
    if (buf === null) {
      return {
        session_id: sessionId,
        date,
        start_time: new Date().toISOString(),
        tokens_input: tokens.input,
        tokens_output: tokens.output,
        tokens_cache_read: tokens.cache_read,
        tokens_cache_write: tokens.cache_write,
        interaction_time_sec: 0,
      };
    }

    // Accumulate interaction time: duration since last user prompt
    let interactionTime = buf.interaction_time_sec ?? 0;
    if (buf.last_prompt_ts) {
      const promptMs = new Date(buf.last_prompt_ts).getTime();
      const deltaSec = Math.max(0, (stopTime - promptMs) / 1000);
      interactionTime += deltaSec;
    }

    return {
      ...buf,
      tokens_input: tokens.input,
      tokens_output: tokens.output,
      tokens_cache_read: tokens.cache_read,
      tokens_cache_write: tokens.cache_write,
      interaction_time_sec: interactionTime,
    };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stop.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stop.mjs tests/stop.test.mjs
git commit -m "feat: accumulate interaction_time_sec in buffer on Stop"
```

---

### Task 6: Record `last_prompt_ts` in UserPromptSubmit

**Files:**
- Modify: `lib/user-prompt-submit.mjs` (line 28)
- Modify: `tests/user-prompt-submit.test.mjs`

The Stop hook needs to know when the last user prompt was sent. We record the timestamp in the buffer.

- [ ] **Step 1: Write failing test — last_prompt_ts saved in buffer**

Add to `tests/user-prompt-submit.test.mjs`:

```javascript
  it('stores last_prompt_ts in buffer', () => {
    // Create buffer first
    const today = new Date().toISOString().slice(0, 10);
    store.ensureDirs(today);
    store.createBuffer('sess1', {
      session_id: 'sess1', date: today, channel: 'claude-code',
      start_time: new Date().toISOString(),
      context: {},
      prompts_count: 0,
    });

    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello' }, store);

    const buf = store.readBuffer('sess1');
    assert.ok(buf.last_prompt_ts, 'should have last_prompt_ts');
    // Verify it's a valid ISO timestamp
    assert.ok(!isNaN(new Date(buf.last_prompt_ts).getTime()));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/user-prompt-submit.test.mjs`
Expected: FAIL — `last_prompt_ts` undefined

- [ ] **Step 3: Add `last_prompt_ts` to buffer update**

In `lib/user-prompt-submit.mjs`, update the `updateBuffer` call (line 28):

```javascript
  store.updateBuffer(sessionId, (buf) => ({
    ...buf,
    prompts_count: (buf.prompts_count ?? 0) + 1,
    last_prompt_ts: new Date().toISOString(),
  }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/user-prompt-submit.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/user-prompt-submit.mjs tests/user-prompt-submit.test.mjs
git commit -m "feat: record last_prompt_ts in buffer on UserPromptSubmit"
```

---

### Task 7: Include `interaction_time_sec` in status aggregation

**Files:**
- Modify: `lib/write-status.mjs`
- Modify: `tests/write-status.test.mjs`

- [ ] **Step 1: Write failing test — interaction time from buffers and sessions**

Add to `tests/write-status.test.mjs`:

```javascript
  it('aggregates interaction_time_sec from active buffers', () => {
    const today = new Date().toISOString().slice(0, 10);
    store.ensureDirs(today);

    store.createBuffer('active1', {
      session_id: 'active1', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'test', model: null },
      prompts_count: 0, tools_total: 0, tools_by_type: {}, tools_failures: 0,
      tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0,
      subagents_total: 0, subagents_by_type: {},
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 0,
      interaction_time_sec: 120, // 2 minutes
    });

    // Also write a completed session with timing data
    store.writeSession(today, 'done1', {
      schema_version: '1.0', session_id: 'done1', channel: 'claude-code',
      timing: { start_time: '2026-03-22T08:00:00Z', end_time: '2026-03-22T08:30:00Z', duration_seconds: 1800 },
      context: { project_name: 'test', model: null },
      tools: { total_calls: 0, by_type: {}, failures: 0 },
      tokens: { input: 0, output: 0, total: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0 },
      git: { commits_made: 0, files_changed: 0 },
      prompts: { count: 5 },
      subagents: { total_spawned: 0, by_type: {}, total_duration_ms: 0 },
      compactions: { count: 0 }, worktrees: { created: 0, removed: 0 }, tasks: { completed: 0 },
      interaction_time_sec: 300, // 5 minutes (new field in session summary)
    });

    writeStatus(store);

    const status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.today.interaction_time_sec, 420); // 120 + 300
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/write-status.test.mjs`
Expected: FAIL — `interaction_time_sec` is 0

- [ ] **Step 3: Implement interaction time aggregation**

In `writeStatus` in `lib/write-status.mjs`, add interaction time reading for both sessions and buffers:

```javascript
  // In the completed sessions loop:
  for (const s of sessions) {
    // ... existing aggregation ...
    status.today.interaction_time_sec += s.interaction_time_sec ?? 0;
  }

  // In the active buffers loop:
  for (const buf of buffers) {
    // ... existing aggregation ...
    status.today.interaction_time_sec += buf.interaction_time_sec ?? 0;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/write-status.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/write-status.mjs tests/write-status.test.mjs
git commit -m "feat: aggregate interaction_time_sec into status"
```

---

### Task 8: Persist `interaction_time_sec` in session summary on SessionEnd

**Files:**
- Modify: `lib/session-end.mjs` (around line 96)
- Modify: `tests/session-end.test.mjs`

When a session ends, copy the `interaction_time_sec` accumulator from the buffer into the session summary JSON.

- [ ] **Step 1: Write failing test — interaction_time_sec in session summary**

Add to `tests/session-end.test.mjs`:

```javascript
  it('includes interaction_time_sec from buffer in session summary', () => {
    store.createBuffer('sess1', {
      session_id: 'sess1', channel: 'claude-code', date: '2026-03-15',
      start_time: '2026-03-15T10:00:00Z',
      context: { project_path: '/tmp', project_name: 'test', directory: '.', cwd: '/tmp', repo: null, git_remote_url: null, git_branch: null, model: 'claude-opus-4-6' },
      prompts_count: 5, tools_total: 10, tools_by_type: { Read: 10 }, tools_failures: 0,
      tokens_input: 50000, tokens_output: 10000, tokens_cache_read: 20000, tokens_cache_write: 10000,
      subagents_total: 0, subagents_by_type: {},
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 0,
      interaction_time_sec: 245.5,
    });

    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store, costRates);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'sessions', '2026-03-15', 'sess1.json'), 'utf-8')
    );
    assert.equal(summary.interaction_time_sec, 245.5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-end.test.mjs`
Expected: FAIL — `interaction_time_sec` not in summary

- [ ] **Step 3: Add `interaction_time_sec` to session summary**

In `lib/session-end.mjs`, add to the summary object (around line 131):

```javascript
  const summary = {
    schema_version: '1.0',
    session_id: sessionId,
    // ... existing fields ...
    tasks: { completed: buffer.tasks_completed },
    interaction_time_sec: buffer.interaction_time_sec ?? 0,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-end.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/session-end.mjs tests/session-end.test.mjs
git commit -m "feat: persist interaction_time_sec in session summary"
```

---

### Task 9: Integrate `writeStatus()` calls into hooks

**Files:**
- Modify: `lib/session-start.mjs` (after line 154)
- Modify: `lib/session-end.mjs` (after line 145)
- Modify: `lib/stop.mjs` (after line 136)
- Modify: `lib/user-prompt-submit.mjs` (after line 31)
- Create: `tests/status-integration.test.mjs`

- [ ] **Step 1: Write failing integration test**

```javascript
// tests/status-integration.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionStart } from '../lib/session-start.mjs';
import { handleStop } from '../lib/stop.mjs';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { handleSessionEnd } from '../lib/session-end.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };
const COST_RATES = {
  'claude-opus-4-6': {
    input_per_1k: 0.005,
    output_per_1k: 0.025,
    cache_read_per_1k: 0.0005,
    cache_write_per_1k: 0.00625,
  },
};

function writeTranscript(dir, entries) {
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  const lines = entries.map((usage, i) => JSON.stringify({
    type: 'assistant',
    message: { id: `msg_${i}`, usage: {
      input_tokens: usage.input, output_tokens: usage.output,
      cache_read_input_tokens: usage.cache_read ?? 0,
      cache_creation_input_tokens: usage.cache_write ?? 0,
    }},
  }));
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');
  return transcriptPath;
}

describe('status.json integration', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-status-int-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('status.json is written after SessionStart', () => {
    handleSessionStart({ session_id: 'sess1', cwd: '/tmp' }, store, 'claude-code');

    const statusPath = path.join(tmpDir, 'status.json');
    assert.ok(fs.existsSync(statusPath), 'status.json should exist after session start');

    const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    assert.equal(status.active_sessions, 1);
  });

  it('status.json updates after full session lifecycle', () => {
    // Start session
    handleSessionStart({ session_id: 'sess1', cwd: '/tmp' }, store, 'claude-code');
    let status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.active_sessions, 1);

    // User prompt
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello' }, store);
    status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.today.prompts, 1);

    // Stop (AI turn complete)
    const transcriptPath = writeTranscript(tmpDir, [
      { input: 5000, output: 1000 },
    ]);
    handleStop({ session_id: 'sess1', cwd: '/tmp', transcript_path: transcriptPath }, store);
    status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.today.tokens.input, 5000);

    // End session
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store, COST_RATES);
    status = JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
    assert.equal(status.active_sessions, 0);
    assert.equal(status.today.sessions_total, 1);
    assert.ok(status.today.cost_usd > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/status-integration.test.mjs`
Expected: FAIL — status.json not written by hooks

- [ ] **Step 3: Add `writeStatus()` calls to each hook handler**

In `lib/session-start.mjs`, after `store.appendEvent(date, sessionId, event);` (line 154):

```javascript
import { writeStatus } from './write-status.mjs';

// Add at end of handleSessionStart, after appendEvent:
  try { writeStatus(store); } catch { /* status write is best-effort */ }
```

In `lib/session-end.mjs`, after `store.deleteBuffer(sessionId);` (line 145):

```javascript
import { writeStatus } from './write-status.mjs';

// Add at end of handleSessionEnd, after deleteBuffer:
  try { writeStatus(store, costRates); } catch { /* status write is best-effort */ }
```

In `lib/stop.mjs`, after the `updateBuffer` call (line 136):

```javascript
import { writeStatus } from './write-status.mjs';

// Add at end of handleStop, after updateBuffer:
  try { writeStatus(store); } catch { /* status write is best-effort */ }
```

In `lib/user-prompt-submit.mjs`, after the `updateBuffer` call (line 31):

```javascript
import { writeStatus } from './write-status.mjs';

// Add at end of handleUserPromptSubmit, after updateBuffer:
  try { writeStatus(store); } catch { /* status write is best-effort */ }
```

**Important:** All `writeStatus()` calls are wrapped in try/catch — status writing is best-effort and must never break existing hook behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/status-integration.test.mjs`
Expected: PASS

Also run all existing tests to verify nothing is broken:
Run: `node --test tests/*.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/session-start.mjs lib/session-end.mjs lib/stop.mjs lib/user-prompt-submit.mjs tests/status-integration.test.mjs
git commit -m "feat: trigger writeStatus() from SessionStart, SessionEnd, Stop, UserPromptSubmit"
```

---

### Task 10: Create status schema reference file

**Files:**
- Create: `config/status-schema.json`

- [ ] **Step 1: Write the JSON Schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Hook Hero Menu Bar Status",
  "description": "Aggregated today's metrics for the macOS menu bar app. Written to ~/.claude/hook-hero/status.json",
  "type": "object",
  "required": ["schema_version", "active_sessions", "today", "active", "updated_at"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "active_sessions": { "type": "integer", "minimum": 0 },
    "today": {
      "type": "object",
      "required": ["sessions_total", "interaction_time_sec", "cost_usd", "tokens", "tool_calls", "prompts", "git"],
      "properties": {
        "sessions_total": { "type": "integer", "minimum": 0 },
        "interaction_time_sec": { "type": "number", "minimum": 0 },
        "cost_usd": { "type": "number", "minimum": 0 },
        "tokens": {
          "type": "object",
          "required": ["input", "output", "cache_read", "cache_write"],
          "properties": {
            "input": { "type": "integer", "minimum": 0 },
            "output": { "type": "integer", "minimum": 0 },
            "cache_read": { "type": "integer", "minimum": 0 },
            "cache_write": { "type": "integer", "minimum": 0 }
          }
        },
        "tool_calls": { "type": "integer", "minimum": 0 },
        "prompts": { "type": "integer", "minimum": 0 },
        "git": {
          "type": "object",
          "required": ["commits", "files_changed"],
          "properties": {
            "commits": { "type": "integer", "minimum": 0 },
            "files_changed": { "type": "integer", "minimum": 0 }
          }
        }
      }
    },
    "active": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["session_id", "project", "duration_sec", "cost_usd", "prompts"],
        "properties": {
          "session_id": { "type": "string" },
          "project": { "type": ["string", "null"] },
          "duration_sec": { "type": "integer", "minimum": 0 },
          "cost_usd": { "type": "number", "minimum": 0 },
          "prompts": { "type": "integer", "minimum": 0 }
        }
      }
    },
    "updated_at": { "type": "string", "format": "date-time" }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config/status-schema.json
git commit -m "docs: add status.json schema reference for menu bar app consumers"
```

---

### Task 11: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `node --test tests/*.test.mjs`
Expected: All tests PASS, including existing tests (no regressions)

- [ ] **Step 2: Manual smoke test**

Run Hook Hero in a real Claude Code session and verify:
1. `~/.claude/hook-hero/status.json` is created after session starts
2. Numbers update after prompts and stops
3. After session ends, `active_sessions` goes to 0 and `sessions_total` increments

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
