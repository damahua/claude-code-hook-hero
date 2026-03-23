import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeStatus } from '../lib/write-status.mjs';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };

const MOCK_RATES = {
  'claude-sonnet-4-6': {
    input_per_1k: 0.003,
    output_per_1k: 0.015,
    cache_read_per_1k: 0.0003,
    cache_write_per_1k: 0.00375,
  },
};

// Helper: get today's date string
function todayDate() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

// Helper: read status.json
function readStatus(tmpDir) {
  return JSON.parse(fs.readFileSync(path.join(tmpDir, 'status.json'), 'utf-8'));
}

describe('writeStatus – Task 1: empty state', () => {
  let tmpDir, store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates status.json when no sessions or buffers exist', () => {
    writeStatus(store, MOCK_RATES);
    assert.ok(fs.existsSync(path.join(tmpDir, 'status.json')));
  });

  it('writes correct schema structure with all-zero values', () => {
    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

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
    assert.ok(typeof status.updated_at === 'string');
    assert.ok(status.updated_at.length > 0);
  });

  it('writes atomically (no .tmp file remains)', () => {
    writeStatus(store, MOCK_RATES);
    const tmpFile = path.join(tmpDir, 'status.json.tmp');
    assert.ok(!fs.existsSync(tmpFile), '.tmp file should not exist after write');
  });

  it('updated_at is a valid ISO timestamp', () => {
    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);
    const d = new Date(status.updated_at);
    assert.ok(!isNaN(d.getTime()), 'updated_at should be a valid date');
  });
});

describe('writeStatus – Task 2: aggregate completed sessions', () => {
  let tmpDir, store;
  const today = todayDate();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs(today);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sums tokens, tool_calls, prompts, git from completed sessions', () => {
    const sess1 = {
      schema_version: '1.0',
      session_id: 'sess1',
      tokens: {
        input: 1000,
        output: 500,
        cache_read: 200,
        cache_write: 100,
        estimated_cost_usd: 0.05,
      },
      tools: { total_calls: 8 },
      prompts: { count: 3 },
      git: { commits_made: 2, files_changed: 5 },
    };

    const sess2 = {
      schema_version: '1.0',
      session_id: 'sess2',
      tokens: {
        input: 2000,
        output: 1000,
        cache_read: 400,
        cache_write: 200,
        estimated_cost_usd: 0.10,
      },
      tools: { total_calls: 12 },
      prompts: { count: 5 },
      git: { commits_made: 1, files_changed: 3 },
    };

    store.writeSession(today, 'sess1', sess1);
    store.writeSession(today, 'sess2', sess2);

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.today.sessions_total, 2);
    assert.equal(status.today.tokens.input, 3000);
    assert.equal(status.today.tokens.output, 1500);
    assert.equal(status.today.tokens.cache_read, 600);
    assert.equal(status.today.tokens.cache_write, 300);
    assert.equal(status.today.tool_calls, 20);
    assert.equal(status.today.prompts, 8);
    assert.equal(status.today.git.commits, 3);
    assert.equal(status.today.git.files_changed, 8);
  });

  it('rounds cost to 2 decimal places', () => {
    // 0.001 + 0.001 + 0.001 = 0.003 — well-behaved, but test rounding logic
    const sess = {
      schema_version: '1.0',
      session_id: 'sessA',
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0.005 },
      tools: { total_calls: 0 },
      prompts: { count: 0 },
      git: { commits_made: 0, files_changed: 0 },
    };
    store.writeSession(today, 'sessA', sess);
    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);
    // Cost should be rounded to 2 decimal places
    const costStr = status.today.cost_usd.toString();
    const decimalPart = costStr.includes('.') ? costStr.split('.')[1] : '';
    assert.ok(decimalPart.length <= 2, `cost_usd should have at most 2 decimal places, got: ${status.today.cost_usd}`);
  });

  it('skips null estimated_cost_usd without crashing', () => {
    const sess = {
      schema_version: '1.0',
      session_id: 'sessB',
      tokens: { input: 1000, output: 500, cache_read: 0, cache_write: 0, estimated_cost_usd: null },
      tools: { total_calls: 2 },
      prompts: { count: 1 },
      git: { commits_made: 0, files_changed: 0 },
    };
    store.writeSession(today, 'sessB', sess);
    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);
    assert.equal(status.today.cost_usd, 0);
    assert.equal(status.today.sessions_total, 1);
  });

  it('handles missing sessions directory gracefully', () => {
    // Don't call ensureDirs — sessions dir won't exist
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-empty-'));
    const store2 = new SessionStore(tmpDir2, new StorageCodec(JSON_CONFIG));
    try {
      writeStatus(store2, MOCK_RATES);
      const status = JSON.parse(fs.readFileSync(path.join(tmpDir2, 'status.json'), 'utf-8'));
      assert.equal(status.today.sessions_total, 0);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});

describe('writeStatus – Task 3: active buffer aggregation', () => {
  let tmpDir, store;
  const today = todayDate();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs(today);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts active sessions from buffer files', () => {
    store.createBuffer('active1', {
      session_id: 'active1',
      channel: 'claude-code',
      date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'ProjectA', model: 'claude-sonnet-4-6' },
      tokens_input: 500,
      tokens_output: 100,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      tools_total: 3,
      prompts_count: 2,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.active_sessions, 1);
    assert.equal(status.active.length, 1);
    assert.equal(status.active[0].session_id, 'active1');
    assert.equal(status.active[0].project, 'ProjectA');
    assert.equal(status.active[0].prompts, 2);
  });

  it('accumulates active buffer tokens to today totals', () => {
    store.createBuffer('active2', {
      session_id: 'active2',
      channel: 'claude-code',
      date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'ProjectB', model: 'claude-sonnet-4-6' },
      tokens_input: 1000,
      tokens_output: 200,
      tokens_cache_read: 50,
      tokens_cache_write: 25,
      tools_total: 5,
      prompts_count: 3,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.today.tokens.input, 1000);
    assert.equal(status.today.tokens.output, 200);
    assert.equal(status.today.tokens.cache_read, 50);
    assert.equal(status.today.tokens.cache_write, 25);
    assert.equal(status.today.tool_calls, 5);
    assert.equal(status.today.prompts, 3);
  });

  it('computes duration_sec from start_time', () => {
    // Create buffer with start_time 10 seconds ago
    const startTime = new Date(Date.now() - 10000).toISOString();
    store.createBuffer('durTest', {
      session_id: 'durTest',
      channel: 'claude-code',
      date: today,
      start_time: startTime,
      context: { project_name: 'DurProj', model: 'claude-sonnet-4-6' },
      tokens_input: 0,
      tokens_output: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      tools_total: 0,
      prompts_count: 0,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.ok(status.active.length === 1);
    // duration_sec should be approximately 10 seconds (allow generous ±5s slack)
    assert.ok(status.active[0].duration_sec >= 5, `Expected ~10s, got ${status.active[0].duration_sec}`);
    assert.ok(status.active[0].duration_sec <= 60, `Expected ~10s, got ${status.active[0].duration_sec}`);
  });

  it('skips .lock, .debug, .batch files', () => {
    // Create a .lock and .debug file in buffer dir
    const bufferDir = path.join(tmpDir, 'buffer');
    fs.mkdirSync(bufferDir, { recursive: true });
    fs.writeFileSync(path.join(bufferDir, 'fakesess.lock'), '');
    fs.writeFileSync(path.join(bufferDir, 'fakesess.debug'), '');
    fs.writeFileSync(path.join(bufferDir, 'fakesess.batch'), '');

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.active_sessions, 0);
    assert.deepEqual(status.active, []);
  });

  it('multiple active buffers are all counted', () => {
    store.createBuffer('m1', {
      session_id: 'm1', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'P1', model: 'claude-sonnet-4-6' },
      tokens_input: 100, tokens_output: 50, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 1, prompts_count: 1,
    });
    store.createBuffer('m2', {
      session_id: 'm2', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'P2', model: 'claude-sonnet-4-6' },
      tokens_input: 200, tokens_output: 100, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 2, prompts_count: 2,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.active_sessions, 2);
    assert.equal(status.active.length, 2);
    assert.equal(status.today.tokens.input, 300);
    assert.equal(status.today.prompts, 3);
  });
});

describe('writeStatus – Task 7: interaction_time_sec aggregation', () => {
  let tmpDir, store;
  const today = todayDate();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs(today);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sums interaction_time_sec from completed sessions and active buffers', () => {
    // Completed session with 300s
    store.writeSession(today, 'completed-time', {
      schema_version: '1.0',
      session_id: 'completed-time',
      interaction_time_sec: 300,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, estimated_cost_usd: 0 },
      tools: { total_calls: 0 },
      prompts: { count: 0 },
      git: { commits_made: 0, files_changed: 0 },
    });

    // Active buffer with 120s
    store.createBuffer('active-time', {
      session_id: 'active-time',
      channel: 'claude-code',
      date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'TimeProj', model: 'claude-sonnet-4-6' },
      tokens_input: 0,
      tokens_output: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      tools_total: 0,
      prompts_count: 0,
      interaction_time_sec: 120,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.today.interaction_time_sec, 420);
  });
});

describe('writeStatus – Task 4: active session cost from cost rates', () => {
  let tmpDir, store;
  const today = todayDate();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-status-test-'));
    store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    store.ensureDirs(today);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calculates active session cost using provided rates', () => {
    // 1000 input tokens @ 0.003/1k = 0.003
    // 500 output tokens @ 0.015/1k = 0.0075
    // total = 0.0105
    store.createBuffer('costSess', {
      session_id: 'costSess', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'CostProj', model: 'claude-sonnet-4-6' },
      tokens_input: 1000, tokens_output: 500, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 0, prompts_count: 1,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    const expectedCost = (1000 / 1000) * 0.003 + (500 / 1000) * 0.015;
    assert.ok(
      Math.abs(status.today.cost_usd - Math.round(expectedCost * 100) / 100) < 0.001,
      `Expected cost ~${expectedCost}, got ${status.today.cost_usd}`
    );

    // active[] cost_usd should also reflect the session cost
    assert.ok(status.active.length === 1);
    assert.ok(
      Math.abs(status.active[0].cost_usd - expectedCost) < 0.001,
      `Expected active cost ~${expectedCost}, got ${status.active[0].cost_usd}`
    );
  });

  it('sums completed and active session costs into today.cost_usd', () => {
    // Write a completed session with real tokens (cost recalculated from tokens)
    // 2000 input @ 0.003/1k = 0.006, 1000 output @ 0.015/1k = 0.015 → 0.021
    store.writeSession(today, 'completed1', {
      schema_version: '1.0',
      session_id: 'completed1',
      context: { model: 'claude-sonnet-4-6' },
      tokens: {
        input: 2000, output: 1000, cache_read: 0, cache_write: 0,
        estimated_cost_usd: null, // null — should be recalculated
      },
      tools: { total_calls: 0 },
      prompts: { count: 0 },
      git: { commits_made: 0, files_changed: 0 },
    });

    // Active session: 1000 input @ 0.003/1k = 0.003
    store.createBuffer('activeCost', {
      session_id: 'activeCost', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'MixProj', model: 'claude-sonnet-4-6' },
      tokens_input: 1000, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 0, prompts_count: 0,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    const completedCost = (2000 / 1000) * 0.003 + (1000 / 1000) * 0.015; // 0.021
    const activeCost = (1000 / 1000) * 0.003; // 0.003
    const totalExpected = Math.round((completedCost + activeCost) * 100) / 100;
    assert.ok(
      Math.abs(status.today.cost_usd - totalExpected) < 0.001,
      `Expected total cost ~${totalExpected}, got ${status.today.cost_usd}`
    );
  });

  it('uses 0 cost for unknown model (no rate entry)', () => {
    store.createBuffer('unknownModel', {
      session_id: 'unknownModel', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'X', model: 'some-unknown-model' },
      tokens_input: 1000, tokens_output: 500, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 0, prompts_count: 0,
    });

    writeStatus(store, MOCK_RATES);
    const status = readStatus(tmpDir);

    assert.equal(status.today.cost_usd, 0);
    assert.equal(status.active[0].cost_usd, 0);
  });

  it('accepts costRates=null without crashing (no cost calculation)', () => {
    store.createBuffer('nullRates', {
      session_id: 'nullRates', channel: 'claude-code', date: today,
      start_time: new Date().toISOString(),
      context: { project_name: 'NR', model: 'claude-sonnet-4-6' },
      tokens_input: 1000, tokens_output: 500, tokens_cache_read: 0, tokens_cache_write: 0,
      tools_total: 0, prompts_count: 0,
    });

    // Pass null explicitly — should not crash
    writeStatus(store, null);
    const status = readStatus(tmpDir);

    // With null rates, active cost should be 0
    assert.equal(status.active[0].cost_usd, 0);
  });
});
