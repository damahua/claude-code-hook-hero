# Hook-Hero Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that captures structured telemetry from 14 hook lifecycle events, writing raw JSONL events and aggregated JSON session summaries to `~/.claude/hook-hero/`.

**Architecture:** Hooks dispatch via a single `run-hook.cmd` polyglot wrapper to plain JavaScript `.mjs` files. Each hook reads JSON from stdin, appends to an event JSONL file, and optionally updates a buffer JSON file with running aggregates. `SessionEnd` finalizes by computing git stats + cost and writing the session summary.

**Tech Stack:** Plain JavaScript (ES modules, `.mjs`), Node.js stdlib only (`fs`, `path`, `child_process`, `crypto`, `os`), zero npm dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-hook-hero-design.md`

---

## File Structure

```
claude-code-hook-hero/
├── hooks/
│   ├── hooks.json                    # 14 hook registrations
│   └── run-hook.cmd                  # Polyglot bash/cmd dispatcher
├── lib/
│   ├── session-store.mjs            # Core: dirs, event append, buffer lock/read/write
│   ├── git-utils.mjs                # Git: repo, remote, branch, diff stats
│   ├── cost-calculator.mjs          # Token → USD calculation
│   ├── stdin-reader.mjs             # Read + parse JSON from stdin
│   ├── session-start.mjs            # Hook: create buffer + session_start event
│   ├── session-end.mjs              # Hook: git stats, cost, write summary, delete buffer
│   ├── stop.mjs                     # Hook: agent_stop event + update buffer tokens
│   ├── user-prompt-submit.mjs       # Hook: user_prompt event + increment prompt count
│   ├── pre-tool-use.mjs             # Hook: tool_start event
│   ├── post-tool-use.mjs            # Hook: tool_end event + update buffer tool counts
│   ├── post-tool-use-failure.mjs    # Hook: tool_failure event + update buffer failure count
│   ├── subagent-start.mjs           # Hook: subagent_start event + update buffer
│   ├── subagent-stop.mjs            # Hook: subagent_stop event + update buffer
│   ├── pre-compact.mjs              # Hook: compact_start event + update buffer
│   ├── post-compact.mjs             # Hook: compact_end event
│   ├── worktree-create.mjs          # Hook: worktree_create event + update buffer
│   ├── worktree-remove.mjs          # Hook: worktree_remove event + update buffer
│   └── task-completed.mjs           # Hook: task_completed event + update buffer
├── skills/
│   └── agent-metrics/
│       └── SKILL.md                  # /agent-metrics skill
├── commands/
│   └── hook-hero-stats.md            # /hook-hero-stats command
├── config/
│   └── defaults.json                 # Cost rates + retention
├── tests/
│   ├── session-store.test.mjs
│   ├── git-utils.test.mjs
│   ├── cost-calculator.test.mjs
│   ├── session-start.test.mjs
│   ├── session-end.test.mjs
│   ├── stop.test.mjs
│   └── integration.test.mjs         # Full lifecycle: start → tools → stop → end
├── README.md
└── LICENSE
```

---

## Chunk 1: Foundation — Core Libraries

### Task 1: Project scaffolding

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/run-hook.cmd`
- Create: `config/defaults.json`
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Create `config/defaults.json`**

```json
{
  "cost_rates": {
    "claude-opus-4-6": { "input_per_1k": 0.015, "output_per_1k": 0.075, "cache_read_per_1k": 0.00375, "cache_write_per_1k": 0.01875 },
    "claude-sonnet-4-6": { "input_per_1k": 0.003, "output_per_1k": 0.015, "cache_read_per_1k": 0.00075, "cache_write_per_1k": 0.00375 },
    "claude-haiku-4-5": { "input_per_1k": 0.0008, "output_per_1k": 0.004, "cache_read_per_1k": 0.0002, "cache_write_per_1k": 0.001 }
  },
  "retention_days": 90
}
```

- [ ] **Step 2: Create `hooks/hooks.json`**

Copy the full hooks.json from the spec (lines 76-248). All 14 hooks registered with correct async flags and `${CLAUDE_PLUGIN_ROOT}` paths.

- [ ] **Step 3: Create `hooks/run-hook.cmd`**

Polyglot bash/cmd wrapper. Follow the superpowers plugin pattern at `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.2/hooks/run-hook.cmd` but modify the Unix portion to dispatch to `.mjs` files:

```bash
# Unix portion:
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_NAME="$1"
shift
exec node "${PLUGIN_ROOT}/lib/${HOOK_NAME}.mjs" "$@"
```

Windows portion: find Git Bash in standard locations, fall back to `bash` on PATH, exit 0 if not found.

- [ ] **Step 4: Create minimal `README.md`**

One-paragraph description, installation instructions (`/plugin install`), and link to spec.

- [ ] **Step 5: Create `LICENSE`**

MIT license.

- [ ] **Step 6: Initialize git repo and commit**

```bash
cd /Users/leo.zhang/Work/claude-code-hook-hero
git init
git add hooks/ config/ README.md LICENSE
git commit -m "feat: project scaffolding — hooks.json, run-hook.cmd, defaults.json"
```

---

### Task 2: stdin-reader.mjs — Read JSON from stdin

**Files:**
- Create: `lib/stdin-reader.mjs`
- Create: `tests/stdin-reader.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/stdin-reader.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHookInput } from '../lib/stdin-reader.mjs';

describe('parseHookInput', () => {
  it('parses valid JSON with session_id and cwd', async () => {
    const input = JSON.stringify({ session_id: 'abc123', cwd: '/tmp', hook_event_name: 'SessionStart' });
    const result = await parseHookInput(input);
    assert.equal(result.session_id, 'abc123');
    assert.equal(result.cwd, '/tmp');
  });

  it('returns null for invalid JSON', async () => {
    const result = await parseHookInput('not json');
    assert.equal(result, null);
  });

  it('returns null for empty input', async () => {
    const result = await parseHookInput('');
    assert.equal(result, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/leo.zhang/Work/claude-code-hook-hero && node --test tests/stdin-reader.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/stdin-reader.mjs
import { stdin } from 'node:process';

export function parseHookInput(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

export async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return parseHookInput(Buffer.concat(chunks).toString('utf-8'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stdin-reader.test.mjs`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/stdin-reader.mjs tests/stdin-reader.test.mjs
git commit -m "feat: stdin-reader — parse JSON hook input from stdin"
```

---

### Task 3: session-store.mjs — File operations, locking, event append

**Files:**
- Create: `lib/session-store.mjs`
- Create: `tests/session-store.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/session-store.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../lib/session-store.mjs';

describe('SessionStore', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDirs creates events/, sessions/, buffer/ directories', () => {
    store.ensureDirs('2026-03-15');
    assert.ok(fs.existsSync(path.join(tmpDir, 'events', '2026-03-15')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'sessions', '2026-03-15')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'buffer')));
  });

  it('appendEvent writes a single JSONL line', () => {
    store.ensureDirs('2026-03-15');
    store.appendEvent('2026-03-15', 'sess1', { v: 1, ts: '2026-03-15T10:00:00Z', event: 'session_start', session_id: 'sess1' });
    const content = fs.readFileSync(path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl'), 'utf-8');
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.event, 'session_start');
  });

  it('appendEvent appends multiple lines', () => {
    store.ensureDirs('2026-03-15');
    store.appendEvent('2026-03-15', 'sess1', { v: 1, event: 'a', session_id: 'sess1' });
    store.appendEvent('2026-03-15', 'sess1', { v: 1, event: 'b', session_id: 'sess1' });
    const lines = fs.readFileSync(path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('createBuffer writes initial buffer JSON', () => {
    store.ensureDirs('2026-03-15');
    const data = { session_id: 'sess1', channel: 'claude-code', date: '2026-03-15', start_time: '2026-03-15T10:00:00Z' };
    store.createBuffer('sess1', data);
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), 'utf-8'));
    assert.equal(content.session_id, 'sess1');
  });

  it('updateBuffer does locked read-modify-write', () => {
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', tools_total: 0 });
    store.updateBuffer('sess1', (buf) => { buf.tools_total += 1; return buf; });
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), 'utf-8'));
    assert.equal(content.tools_total, 1);
  });

  it('readBuffer returns null if no buffer exists', () => {
    const result = store.readBuffer('nonexistent');
    assert.equal(result, null);
  });

  it('writeSession writes to sessions/{date}/', () => {
    store.ensureDirs('2026-03-15');
    const summary = { schema_version: '1.0', session_id: 'sess1' };
    store.writeSession('2026-03-15', 'sess1', summary);
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sessions', '2026-03-15', 'sess1.json'), 'utf-8'));
    assert.equal(content.schema_version, '1.0');
  });

  it('deleteBuffer removes the buffer file', () => {
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1' });
    store.deleteBuffer('sess1');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'buffer', 'sess1.json')));
  });

  it('cleanOrphanedBuffers removes buffers older than 24 hours', () => {
    store.ensureDirs('2026-03-15');
    const bufPath = path.join(tmpDir, 'buffer', 'old-sess.json');
    fs.writeFileSync(bufPath, '{}');
    // Set mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(bufPath, oldTime, oldTime);
    store.cleanOrphanedBuffers();
    assert.ok(!fs.existsSync(bufPath));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-store.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

`lib/session-store.mjs` — implement `SessionStore` class with methods:
- `constructor(baseDir)` — defaults to `~/.claude/hook-hero`
- `ensureDirs(date)` — `fs.mkdirSync` with recursive for events/{date}, sessions/{date}, buffer/
- `appendEvent(date, sessionId, eventObj)` — `fs.appendFileSync` with `JSON.stringify(eventObj) + '\n'`
- `createBuffer(sessionId, data)` — `fs.writeFileSync` to buffer/{sessionId}.json
- `updateBuffer(sessionId, mutatorFn)` — locked read-modify-write:
  - Acquire lock: `fs.openSync(lockPath, 'wx')` (O_CREAT | O_EXCL)
  - Retry loop: 10 attempts, 50ms sleep, stale lock detection (>30s)
  - Read, call mutatorFn, write back
  - Delete lock file in finally block
- `readBuffer(sessionId)` — read + parse, return null if not found
- `writeSession(date, sessionId, summary)` — `fs.writeFileSync` pretty-printed
- `deleteBuffer(sessionId)` — `fs.unlinkSync`, ignore ENOENT
- `cleanOrphanedBuffers()` — scan buffer/, remove files with mtime > 24h

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-store.test.mjs`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add lib/session-store.mjs tests/session-store.test.mjs
git commit -m "feat: session-store — file ops, locking, event append, buffer management"
```

---

### Task 4: git-utils.mjs — Git context extraction

**Files:**
- Create: `lib/git-utils.mjs`
- Create: `tests/git-utils.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/git-utils.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitRemote, extractProjectName } from '../lib/git-utils.mjs';

describe('parseGitRemote', () => {
  it('parses SSH remote URL', () => {
    assert.equal(parseGitRemote('git@github.com:amplitude/nova.git'), 'amplitude/nova');
  });

  it('parses HTTPS remote URL', () => {
    assert.equal(parseGitRemote('https://github.com/amplitude/nova.git'), 'amplitude/nova');
  });

  it('returns null for invalid URL', () => {
    assert.equal(parseGitRemote('not-a-url'), null);
  });
});

describe('extractProjectName', () => {
  it('extracts last path component', () => {
    assert.equal(extractProjectName('/Users/leo/Work/nova'), 'nova');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git-utils.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

`lib/git-utils.mjs` — exports:
- `parseGitRemote(url)` — regex parse SSH (`git@host:owner/repo.git`) and HTTPS (`https://host/owner/repo.git`), return `owner/repo` or null
- `extractProjectName(cwd)` — `path.basename(cwd)`
- `getGitContext(cwd)` — runs `git rev-parse --show-toplevel`, `git remote get-url origin`, `git rev-parse --abbrev-ref HEAD` via `child_process.execSync`. Returns `{ project_path, project_name, directory, cwd, repo, git_remote_url, git_branch }`. All fields default to null/empty if not in a git repo.
- `getGitStats(cwd, startTime)` — runs `git log --since=...`, `git diff --stat`. Returns `{ commits_made, branches_touched, files_changed, insertions, deletions, prs_created }`. All fields default to 0/[]. `prs_created` is detected by running `git log --since=... --format="%s" | grep -c "^Merge pull request"` AND checking for `gh pr list --state merged --search "merged:>={startTime}"` if `gh` is available. Falls back to 0 if neither heuristic finds anything. This is best-effort — PRs created via `gh pr create` during the session may not appear in git log yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/git-utils.test.mjs`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/git-utils.mjs tests/git-utils.test.mjs
git commit -m "feat: git-utils — remote parsing, context extraction, diff stats"
```

---

### Task 5: cost-calculator.mjs — Token → USD

**Files:**
- Create: `lib/cost-calculator.mjs`
- Create: `tests/cost-calculator.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/cost-calculator.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost, loadCostRates } from '../lib/cost-calculator.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('calculateCost', () => {
  const rates = {
    'claude-opus-4-6': { input_per_1k: 0.015, output_per_1k: 0.075, cache_read_per_1k: 0.00375, cache_write_per_1k: 0.01875 }
  };

  it('calculates cost for known model', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, 0.015 + 0.075); // 0.09
  });

  it('returns null for unknown model', () => {
    const cost = calculateCost('unknown-model', { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, null);
  });

  it('handles zero tokens', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 0, output: 0, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, 0);
  });

  it('includes cache costs', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 0, output: 0, cache_read: 1000, cache_write: 1000 }, rates);
    assert.ok(cost > 0);
    assert.equal(cost, 0.00375 + 0.01875);
  });
});

describe('loadCostRates', () => {
  it('merges user overrides with defaults', () => {
    // Create a temp override file
    const tmpFile = path.join(os.tmpdir(), 'hook-hero-cost-override-test.json');
    fs.writeFileSync(tmpFile, JSON.stringify({
      cost_rates: { 'custom-model': { input_per_1k: 0.001, output_per_1k: 0.002, cache_read_per_1k: 0, cache_write_per_1k: 0 } }
    }));
    const rates = loadCostRates(tmpFile);
    // Default model still exists
    assert.ok(rates['claude-opus-4-6']);
    // Override model added
    assert.equal(rates['custom-model'].input_per_1k, 0.001);
    fs.unlinkSync(tmpFile);
  });

  it('returns defaults when override path is missing', () => {
    const rates = loadCostRates('/nonexistent/path.json');
    assert.ok(rates['claude-opus-4-6']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cost-calculator.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```javascript
// lib/cost-calculator.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadCostRates(overridePath) {
  const defaults = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'defaults.json'), 'utf-8'));
  let overrides = {};
  try {
    if (overridePath) {
      overrides = JSON.parse(readFileSync(overridePath, 'utf-8'));
    }
  } catch { /* no overrides */ }
  return { ...defaults.cost_rates, ...(overrides.cost_rates || {}) };
}

export function calculateCost(model, tokens, rates) {
  const rate = rates[model];
  if (!rate) return null;
  const { input = 0, output = 0, cache_read = 0, cache_write = 0 } = tokens;
  return (
    (input / 1000) * rate.input_per_1k +
    (output / 1000) * rate.output_per_1k +
    (cache_read / 1000) * rate.cache_read_per_1k +
    (cache_write / 1000) * rate.cache_write_per_1k
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cost-calculator.test.mjs`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/cost-calculator.mjs tests/cost-calculator.test.mjs
git commit -m "feat: cost-calculator — token to USD with model rates and unknown fallback"
```

---

## Chunk 2: Core Hooks — Session Lifecycle

### Task 6: session-start.mjs

**Files:**
- Create: `lib/session-start.mjs`
- Create: `tests/session-start.test.mjs`

- [ ] **Step 1: Write the failing test**

Test the core logic function (not stdin reading — that's tested separately):

```javascript
// tests/session-start.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionStart } from '../lib/session-start.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleSessionStart', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates buffer file and writes session_start event', () => {
    const input = { session_id: 'sess1', cwd: '/tmp/myproject' };
    handleSessionStart(input, store, 'claude-code');

    // Buffer exists
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.session_id, 'sess1');
    assert.equal(buffer.channel, 'claude-code');
    assert.equal(buffer.prompts_count, 0);
    assert.equal(buffer.tools_total, 0);

    // Event file exists with session_start event
    const date = buffer.date;
    const eventFile = path.join(tmpDir, 'events', date, 'sess1.jsonl');
    assert.ok(fs.existsSync(eventFile));
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'session_start');
    assert.equal(event.v, 1);
  });

  it('cleans orphaned buffers on start', () => {
    store.ensureDirs('2026-03-15');
    const oldBuf = path.join(tmpDir, 'buffer', 'old-sess.json');
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    fs.writeFileSync(oldBuf, '{}');
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(oldBuf, oldTime, oldTime);

    handleSessionStart({ session_id: 'new-sess', cwd: '/tmp' }, store, 'claude-code');
    assert.ok(!fs.existsSync(oldBuf));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-start.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

`lib/session-start.mjs`:
- Export `handleSessionStart(input, store, channel)` for testing
- Detect channel via `process.stdin.isTTY` and env vars
- Call `getGitContext(input.cwd)` for context fields
- Create buffer with all zero counters
- Append `session_start` event to JSONL
- Clean orphaned buffers
- Main: `readStdin()` → `handleSessionStart()`, wrapped in try/catch that exits 0 on error

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-start.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/session-start.mjs tests/session-start.test.mjs
git commit -m "feat: session-start hook — create buffer, write session_start event, clean orphans"
```

---

### Task 7: stop.mjs

**Files:**
- Create: `lib/stop.mjs`
- Create: `tests/stop.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/stop.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleStop } from '../lib/stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleStop', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends agent_stop event with v and token deltas', () => {
    const input = {
      session_id: 'sess1',
      cwd: '/tmp',
      token_usage: { input: 5000, output: 1000, cache_read: 2000, cache_write: 1000 }
    };
    handleStop(input, store);

    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'agent_stop');
    assert.equal(event.v, 1);
    assert.equal(event.tokens.input, 5000);
  });

  it('updates buffer with cumulative token counts', () => {
    handleStop({ session_id: 'sess1', cwd: '/tmp', token_usage: { input: 5000, output: 1000, cache_read: 0, cache_write: 0 } }, store);
    handleStop({ session_id: 'sess1', cwd: '/tmp', token_usage: { input: 3000, output: 500, cache_read: 0, cache_write: 0 } }, store);

    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tokens_input, 8000);
    assert.equal(buffer.tokens_output, 1500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stop.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

`lib/stop.mjs`:
- Export `handleStop(input, store)` for testing
- Extract token deltas from `input.token_usage` (or wherever Claude Code puts them — verify at implementation time)
- Append `agent_stop` event with token deltas
- `updateBuffer` to add deltas to cumulative totals
- Main: try/catch, exit 0 on error

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stop.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stop.mjs tests/stop.test.mjs
git commit -m "feat: stop hook — agent_stop event, cumulative token buffer updates"
```

---

### Task 8: session-end.mjs — Finalization

**Files:**
- Create: `lib/session-end.mjs`
- Create: `tests/session-end.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/session-end.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSessionEnd } from '../lib/session-end.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleSessionEnd', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', channel: 'claude-code', date: '2026-03-15',
      start_time: '2026-03-15T10:30:00Z',
      context: { project_path: '/tmp', project_name: 'test', directory: '', cwd: '/tmp', repo: null, git_remote_url: null, git_branch: null, model: 'claude-opus-4-6' },
      prompts_count: 3, tools_total: 10, tools_by_type: { Read: 5, Edit: 5 }, tools_failures: 1,
      tokens_input: 50000, tokens_output: 10000, tokens_cache_read: 20000, tokens_cache_write: 10000,
      subagents_total: 1, subagents_by_type: { Explore: 1 },
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 2
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes session summary JSON', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store);

    const summaryPath = path.join(tmpDir, 'sessions', '2026-03-15', 'sess1.json');
    assert.ok(fs.existsSync(summaryPath));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    assert.equal(summary.schema_version, '1.0');
    assert.equal(summary.session_id, 'sess1');
    assert.equal(summary.channel, 'claude-code');
    assert.equal(summary.tools.total_calls, 10);
    assert.equal(summary.prompts.count, 3);
    assert.equal(summary.tokens.total, 60000);
  });

  it('appends session_end event to JSONL', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store);

    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'session_end');
  });

  it('deletes buffer after finalization', () => {
    handleSessionEnd({ session_id: 'sess1', cwd: '/tmp' }, store);
    assert.equal(store.readBuffer('sess1'), null);
  });

  it('handles missing buffer gracefully', () => {
    // No buffer for sess2
    handleSessionEnd({ session_id: 'sess2', cwd: '/tmp' }, store);
    // Should not throw — writes bare session_end event only
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-end.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write implementation**

`lib/session-end.mjs`:
- Export `handleSessionEnd(input, store)` for testing
- Read buffer — if missing, write bare `session_end` event and return
- Compute git stats via `getGitStats(input.cwd, buffer.start_time)`
- Compute cost via `calculateCost(buffer.context.model, tokens, rates)`
- Compute `subagents.total_duration_ms` by reading the events JSONL, finding paired `subagent_start`/`subagent_stop` events by `subagent_id`, and summing the timestamp deltas
- Build session summary object (spec lines 565-649)
- Append `session_end` event to JSONL
- Write session summary to `sessions/{date}/{session_id}.json`
- Delete buffer

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-end.test.mjs`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/session-end.mjs tests/session-end.test.mjs
git commit -m "feat: session-end hook — finalize summary, git stats, cost, cleanup buffer"
```

---

## Chunk 3: Event Hooks — Tools, Prompts, Subagents

### Task 9: user-prompt-submit.mjs

**Files:**
- Create: `lib/user-prompt-submit.mjs`
- Create: `tests/user-prompt-submit.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/user-prompt-submit.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleUserPromptSubmit } from '../lib/user-prompt-submit.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handleUserPromptSubmit', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-15', prompts_count: 0 });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends user_prompt event with prompt_length but not content', () => {
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'hello world' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'user_prompt');
    assert.equal(event.v, 1);
    assert.equal(event.prompt_length, 11);
    // Privacy: prompt content must NOT be logged
    assert.equal(event.prompt, undefined);
    assert.equal(event.prompt_content, undefined);
  });

  it('increments buffer prompts_count', () => {
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'a' }, store);
    handleUserPromptSubmit({ session_id: 'sess1', prompt: 'bb' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.prompts_count, 2);
  });
});
```

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write implementation** — append event (log length not content), updateBuffer increment
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/user-prompt-submit.mjs tests/user-prompt-submit.test.mjs
git commit -m "feat: user-prompt-submit hook — prompt length event, buffer count"
```

---

### Task 10: pre-tool-use.mjs

**Files:**
- Create: `lib/pre-tool-use.mjs`
- Create: `tests/pre-tool-use.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pre-tool-use.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePreToolUse } from '../lib/pre-tool-use.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handlePreToolUse', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', { session_id: 'sess1', date: '2026-03-15' });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends tool_start event with tool_use_id and redacted input', () => {
    handlePreToolUse({
      session_id: 'sess1',
      tool_name: 'Read',
      tool_use_id: 'toolu_123',
      tool_input: { file_path: '/src/Main.java', content: 'secret stuff' }
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'tool_start');
    assert.equal(event.v, 1);
    assert.equal(event.tool, 'Read');
    assert.equal(event.tool_use_id, 'toolu_123');
    // file_path is kept, content is redacted
    assert.equal(event.tool_input_summary.file_path, '/src/Main.java');
    assert.equal(event.tool_input_summary.content, undefined);
  });
});
```

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write implementation** — append event with redacted `tool_input_summary` (keep only `file_path`, `pattern`, `glob`, `path`, `url` keys; strip everything else)
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/pre-tool-use.mjs tests/pre-tool-use.test.mjs
git commit -m "feat: pre-tool-use hook — tool_start event with redacted input summary"
```

---

### Task 11: post-tool-use.mjs

**Files:**
- Create: `lib/post-tool-use.mjs`
- Create: `tests/post-tool-use.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/post-tool-use.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePostToolUse } from '../lib/post-tool-use.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handlePostToolUse', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tools_total: 0, tools_by_type: {}, tools_failures: 0
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends tool_end event with v, tool_use_id and status', () => {
    handlePostToolUse({
      session_id: 'sess1', tool_name: 'Read', tool_use_id: 'toolu_abc'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'tool_end');
    assert.equal(event.v, 1);
    assert.equal(event.tool, 'Read');
    assert.equal(event.tool_use_id, 'toolu_abc');
    assert.equal(event.status, 'success');
  });

  it('updates buffer tools_total and tools_by_type', () => {
    handlePostToolUse({ session_id: 'sess1', tool_name: 'Read', tool_use_id: 'a' }, store);
    handlePostToolUse({ session_id: 'sess1', tool_name: 'Read', tool_use_id: 'b' }, store);
    handlePostToolUse({ session_id: 'sess1', tool_name: 'Edit', tool_use_id: 'c' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tools_total, 3);
    assert.equal(buffer.tools_by_type.Read, 2);
    assert.equal(buffer.tools_by_type.Edit, 1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write implementation** — append `tool_end` event, updateBuffer incrementing `tools_total` and `tools_by_type[toolName]`
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/post-tool-use.mjs tests/post-tool-use.test.mjs
git commit -m "feat: post-tool-use hook — tool_end event, buffer tool counts"
```

---

### Task 12: post-tool-use-failure.mjs

**Files:**
- Create: `lib/post-tool-use-failure.mjs`
- Create: `tests/post-tool-use-failure.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/post-tool-use-failure.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePostToolUseFailure } from '../lib/post-tool-use-failure.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('handlePostToolUseFailure', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      tools_total: 0, tools_by_type: {}, tools_failures: 0
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends tool_failure event with v, error, and tool_use_id', () => {
    handlePostToolUseFailure({
      session_id: 'sess1', tool_name: 'Bash', tool_use_id: 'toolu_xyz',
      error: 'Command exited with code 1'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'tool_failure');
    assert.equal(event.v, 1);
    assert.equal(event.tool, 'Bash');
    assert.equal(event.tool_use_id, 'toolu_xyz');
    assert.equal(event.error, 'Command exited with code 1');
  });

  it('updates buffer tools_failures AND tools_total', () => {
    handlePostToolUseFailure({
      session_id: 'sess1', tool_name: 'Bash', tool_use_id: 'a', error: 'fail'
    }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tools_failures, 1);
    assert.equal(buffer.tools_total, 1);
    assert.equal(buffer.tools_by_type.Bash, 1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write implementation** — append `tool_failure` event, updateBuffer incrementing `tools_failures`, `tools_total`, and `tools_by_type[toolName]`
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/post-tool-use-failure.mjs tests/post-tool-use-failure.test.mjs
git commit -m "feat: post-tool-use-failure hook — tool_failure event, buffer failure count"
```

---

### Task 13: subagent-start.mjs and subagent-stop.mjs

**Files:**
- Create: `lib/subagent-start.mjs`
- Create: `lib/subagent-stop.mjs`
- Create: `tests/subagent-hooks.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/subagent-hooks.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleSubagentStart } from '../lib/subagent-start.mjs';
import { handleSubagentStop } from '../lib/subagent-stop.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('subagent hooks', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      subagents_total: 0, subagents_by_type: {}
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('subagent_start appends event with v, subagent_id, and type', () => {
    handleSubagentStart({
      session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'subagent_start');
    assert.equal(event.v, 1);
    assert.equal(event.subagent_id, 'sub-1');
    assert.equal(event.subagent_type, 'Explore');
  });

  it('subagent_start updates buffer counts', () => {
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore' }, store);
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-2', subagent_type: 'Explore' }, store);
    handleSubagentStart({ session_id: 'sess1', subagent_id: 'sub-3', subagent_type: 'general-purpose' }, store);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.subagents_total, 3);
    assert.equal(buffer.subagents_by_type.Explore, 2);
    assert.equal(buffer.subagents_by_type['general-purpose'], 1);
  });

  it('subagent_stop appends event with v and subagent_id', () => {
    handleSubagentStop({
      session_id: 'sess1', subagent_id: 'sub-1', subagent_type: 'Explore'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'subagent_stop');
    assert.equal(event.v, 1);
    assert.equal(event.subagent_id, 'sub-1');
  });
});
```

Note: `subagents.total_duration_ms` in the session summary is computed by `SessionEnd` by correlating `subagent_start` and `subagent_stop` events from the JSONL via `subagent_id` timestamps. It is NOT tracked in the buffer — it's derived at finalization time.

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write both implementations**
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/subagent-start.mjs lib/subagent-stop.mjs tests/subagent-hooks.test.mjs
git commit -m "feat: subagent hooks — start/stop events, buffer subagent tracking"
```

---

### Task 14: Remaining event hooks — compact, worktree, task

**Files:**
- Create: `lib/pre-compact.mjs`
- Create: `lib/post-compact.mjs`
- Create: `lib/worktree-create.mjs`
- Create: `lib/worktree-remove.mjs`
- Create: `lib/task-completed.mjs`
- Create: `tests/remaining-hooks.test.mjs`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/remaining-hooks.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handlePreCompact } from '../lib/pre-compact.mjs';
import { handlePostCompact } from '../lib/post-compact.mjs';
import { handleWorktreeCreate } from '../lib/worktree-create.mjs';
import { handleWorktreeRemove } from '../lib/worktree-remove.mjs';
import { handleTaskCompleted } from '../lib/task-completed.mjs';
import { SessionStore } from '../lib/session-store.mjs';

describe('remaining hooks', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-test-'));
    store = new SessionStore(tmpDir);
    store.ensureDirs('2026-03-15');
    store.createBuffer('sess1', {
      session_id: 'sess1', date: '2026-03-15',
      compactions_count: 0, worktrees_created: 0, worktrees_removed: 0, tasks_completed: 0
    });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('pre-compact appends compact_start and increments buffer', () => {
    handlePreCompact({ session_id: 'sess1' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'compact_start');
    assert.equal(event.v, 1);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.compactions_count, 1);
  });

  it('post-compact appends compact_end (no buffer update)', () => {
    handlePostCompact({ session_id: 'sess1' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'compact_end');
    assert.equal(event.v, 1);
  });

  it('worktree-create appends event with path + branch and increments buffer', () => {
    handleWorktreeCreate({
      session_id: 'sess1', worktree_path: '/tmp/wt', branch: 'feat-x'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'worktree_create');
    assert.equal(event.v, 1);
    assert.equal(event.worktree_path, '/tmp/wt');
    assert.equal(event.branch, 'feat-x');
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.worktrees_created, 1);
  });

  it('worktree-remove appends event with path and increments buffer', () => {
    handleWorktreeRemove({ session_id: 'sess1', worktree_path: '/tmp/wt' }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'worktree_remove');
    assert.equal(event.v, 1);
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.worktrees_removed, 1);
  });

  it('task-completed appends event with task_id + subject and increments buffer', () => {
    handleTaskCompleted({
      session_id: 'sess1', task_id: '5', task_subject: 'Fix bug'
    }, store);
    const eventFile = path.join(tmpDir, 'events', '2026-03-15', 'sess1.jsonl');
    const event = JSON.parse(fs.readFileSync(eventFile, 'utf-8').trim());
    assert.equal(event.event, 'task_completed');
    assert.equal(event.v, 1);
    assert.equal(event.task_id, '5');
    assert.equal(event.task_subject, 'Fix bug');
    const buffer = store.readBuffer('sess1');
    assert.equal(buffer.tasks_completed, 1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**
- [ ] **Step 3: Write all 5 implementations** — each follows same pattern: append event (with `v: 1`) + optional buffer update
- [ ] **Step 4: Run test, verify pass**
- [ ] **Step 5: Commit**

```bash
git add lib/pre-compact.mjs lib/post-compact.mjs lib/worktree-create.mjs lib/worktree-remove.mjs lib/task-completed.mjs tests/remaining-hooks.test.mjs
git commit -m "feat: compact, worktree, task hooks — events and buffer tracking"
```

---

## Chunk 4: Integration Test, Skill, Command

### Task 15: Full lifecycle integration test

**Files:**
- Create: `tests/integration.test.mjs`

- [ ] **Step 1: Write the integration test**

Simulates a full session with all 14 hook types:
1. Call `handleSessionStart` → verify buffer + event
2. Call `handleUserPromptSubmit` x2 → verify prompt count
3. Call `handlePreToolUse` (Read) → verify event
4. Call `handlePostToolUse` (Read) → verify event + buffer
5. Call `handlePreToolUse` (Bash) → verify event
6. Call `handlePostToolUseFailure` (Bash) → verify event + failure count
7. Call `handleSubagentStart` → verify event + buffer
8. Call `handleSubagentStop` → verify event
9. Call `handlePreCompact` → verify event + buffer
10. Call `handlePostCompact` → verify event
11. Call `handleWorktreeCreate` → verify event + buffer
12. Call `handleWorktreeRemove` → verify event + buffer
13. Call `handleTaskCompleted` → verify event + buffer
14. Call `handleStop` x2 (two turns) → verify token accumulation
15. Call `handleSessionEnd` → verify final summary JSON has correct aggregates

Assert:
- Summary `tools.total_calls` = 2 (Read + Bash)
- Summary `tools.failures` = 1
- Summary `prompts.count` = 2
- Summary `subagents.total_spawned` = 1
- Summary `compactions.count` = 1
- Summary `worktrees.created` = 1
- Summary `worktrees.removed` = 1
- Summary `tasks.completed` = 1
- Summary `tokens.total` = sum of both stop deltas
- All events have `v: 1`
- Events JSONL has correct number of lines (15 events)
- Buffer file is deleted

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/integration.test.mjs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.mjs
git commit -m "test: full lifecycle integration test — all 14 hooks end-to-end"
```

---

### Task 16: Agent-metrics skill

**Files:**
- Create: `skills/agent-metrics/SKILL.md`

- [ ] **Step 1: Write the skill file**

```markdown
---
name: agent-metrics
description: >
  Query agent session metrics from hook-hero telemetry data. Use when the user
  asks about agent activity, efficiency, token spend, tool usage, session history,
  cost tracking, or productivity metrics. Examples: "how efficient was I this week",
  "show me my agent metrics", "which repo used the most tokens", "how much did I
  spend on Claude today".
allowed-tools: Bash, Read, Grep, Glob
---

# Agent Metrics — Hook-Hero Telemetry

Query and analyze agent session telemetry captured by the hook-hero plugin.

## Data Location

Session summaries: `~/.claude/hook-hero/sessions/{YYYY-MM-DD}/{session_id}.json`
Raw events: `~/.claude/hook-hero/events/{YYYY-MM-DD}/{session_id}.jsonl`

## How to Query

### Quick stats for today
```bash
for f in ~/.claude/hook-hero/sessions/$(date +%Y-%m-%d)/*.json; do cat "$f"; done | node -e "
  const lines = require('fs').readFileSync('/dev/stdin','utf-8').trim().split('}{').map((s,i,a) => (i?'{':'') + s + (i<a.length-1?'}':''));
  const sessions = lines.map(JSON.parse);
  const total_cost = sessions.reduce((s,x) => s + (x.tokens?.estimated_cost_usd || 0), 0);
  const total_tokens = sessions.reduce((s,x) => s + (x.tokens?.total || 0), 0);
  const total_tools = sessions.reduce((s,x) => s + (x.tools?.total_calls || 0), 0);
  console.log('Sessions:', sessions.length);
  console.log('Tokens:', total_tokens.toLocaleString());
  console.log('Cost: $' + total_cost.toFixed(2));
  console.log('Tool calls:', total_tools);
"
```

### Filter by repo or channel
Use Glob to find sessions, Read to parse them, then aggregate:
```bash
# Find all sessions for a specific repo
grep -rl '"repo": "amplitude/nova"' ~/.claude/hook-hero/sessions/
```

### Analyze raw events for a session
```bash
cat ~/.claude/hook-hero/events/2026-03-15/{session_id}.jsonl
```

## Session Summary Schema

Each JSON file contains: timing, context (project/repo/branch/model), tools (counts by type), tokens (with estimated cost), git (commits/PRs/lines), prompts, subagents, compactions, worktrees, tasks.

## Insights to Provide

When presenting metrics, highlight:
- Total sessions, time, and cost for the period
- Which repos consume the most effort/tokens
- Channel comparison (claude-code vs claude-cli)
- Most-used tools and failure rates
- Git productivity (commits, PRs, lines changed per session)
- Subagent usage patterns
- Context compaction frequency (signals complex sessions)
```

- [ ] **Step 2: Commit**

```bash
git add skills/agent-metrics/SKILL.md
git commit -m "feat: agent-metrics skill — query and analyze hook-hero telemetry"
```

---

### Task 17: hook-hero-stats command

**Files:**
- Create: `commands/hook-hero-stats.md`

- [ ] **Step 1: Write the command file**

```markdown
---
name: hook-hero-stats
description: Show a quick summary of recent agent session activity.
---

Read all session summary files from `~/.claude/hook-hero/sessions/` for today (or the date range the user specifies). Aggregate and display:

- Number of sessions
- Total duration
- Total tokens and estimated cost
- Top tools by usage
- Repos worked on
- Channels used (claude-code vs claude-cli)
- Git activity (commits, PRs, lines changed)

Format as a clean terminal-friendly summary table.
```

- [ ] **Step 2: Commit**

```bash
git add commands/hook-hero-stats.md
git commit -m "feat: hook-hero-stats command — quick terminal summary"
```

---

### Task 18: schema.json — Published schema for consumers

**Files:**
- Create: `config/schema.json`

- [ ] **Step 1: Create schema.json**

A JSON Schema (draft-07) file that defines both:
1. The session summary format (`sessions/{date}/{id}.json`)
2. The event envelope format (JSONL lines)

This file gets copied to `~/.claude/hook-hero/schema.json` on first `SessionStart` if it doesn't exist. Consumers can validate against it.

Include all fields from the spec's Session Summary Schema (lines 565-649) and Event Schema (lines 321-557) as formal JSON Schema definitions.

- [ ] **Step 2: Update `session-start.mjs` to copy schema.json**

In `handleSessionStart`, after `ensureDirs`, always copy `config/schema.json` from the plugin root to `~/.claude/hook-hero/schema.json` (overwrite if exists). This ensures schema updates propagate on plugin upgrades.

- [ ] **Step 3: Commit**

```bash
git add config/schema.json
git commit -m "feat: schema.json — published JSON Schema for consumer validation"
```

---

### Task 19: Run all tests, final commit

- [ ] **Step 1: Run all tests**

```bash
cd /Users/leo.zhang/Work/claude-code-hook-hero
node --test tests/*.test.mjs
```

Expected: All tests pass.

- [ ] **Step 2: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: final cleanup and all tests passing"
```

- [ ] **Step 3: Verify plugin structure matches spec**

Check that all files from the spec's Plugin Structure section exist:
```bash
ls hooks/hooks.json hooks/run-hook.cmd
ls lib/*.mjs
ls skills/agent-metrics/SKILL.md
ls commands/hook-hero-stats.md
ls config/defaults.json
```
