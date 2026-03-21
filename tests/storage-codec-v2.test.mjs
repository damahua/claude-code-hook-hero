import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { StorageCodec } from '../lib/storage-codec.mjs';

// Helper: create a codec with a fresh random key (encrypted, msgpack)
function makeEncryptedCodec() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codec-v2-'));
  const keyPath = path.join(tmpDir, '.key');
  fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
  return new StorageCodec({
    storage: {
      format: 'msgpack',
      encryption: { enabled: true, key_source: 'env' },
    },
  });
}

// Helper: create a plain msgpack codec (no encryption)
function makePlainCodec() {
  return new StorageCodec({
    storage: { format: 'msgpack', encryption: { enabled: false } },
  });
}

// Helper: create a JSON codec
function makeJsonCodec() {
  return new StorageCodec({
    storage: { format: 'json', encryption: { enabled: false } },
  });
}

// ─── Test fixtures ────────────────────────────────────────────────────

const SESSION_START = {
  v: 1,
  ts: '2026-03-21T19:00:00.000Z',
  event: 'session_start',
  session_id: '9e4bf1dc-b8ba-4276-913d-d499e214ac37',
  channel: 'claude-cli',
  context: {
    project_path: '/Users/test/Work/myproject',
    project_name: 'myproject',
    directory: '',
    cwd: '/Users/test/Work/myproject',
    repo: 'user/myproject',
    git_remote_url: 'git@github.com:user/myproject.git',
    git_branch: 'main',
    model: 'claude-opus-4-6[1m]',
  },
};

const TOOL_START = {
  v: 1,
  ts: '2026-03-21T19:00:05.123Z',
  event: 'tool_start',
  session_id: '9e4bf1dc-b8ba-4276-913d-d499e214ac37',
  tool: 'Read',
  tool_use_id: 'toolu_01BXcvWsRsff8mikG2VPWdcr',
  tool_input_summary: { file_path: '/Users/test/Work/myproject/foo.ts' },
};

const TOOL_END = {
  v: 1,
  ts: '2026-03-21T19:00:05.456Z',
  event: 'tool_end',
  session_id: '9e4bf1dc-b8ba-4276-913d-d499e214ac37',
  tool: 'Read',
  tool_use_id: 'toolu_01BXcvWsRsff8mikG2VPWdcr',
  status: 'success',
};

const SESSION_END = {
  v: 1,
  ts: '2026-03-21T19:05:00.000Z',
  event: 'session_end',
  session_id: '9e4bf1dc-b8ba-4276-913d-d499e214ac37',
};

const ALL_EVENTS = [SESSION_START, TOOL_START, TOOL_END, SESSION_END];

// ─── Delta timestamp tests ──────────────────────────────────────────

describe('delta timestamps', () => {
  it('session_start keeps absolute ISO timestamp', () => {
    const codec = makePlainCodec();
    const transformed = codec._applyCompactTransforms(SESSION_START, SESSION_START.ts);
    assert.equal(typeof transformed.ts, 'string');
    assert.equal(transformed.ts, SESSION_START.ts);
  });

  it('tool_start gets delta ms from session start', () => {
    const codec = makePlainCodec();
    const transformed = codec._applyCompactTransforms(TOOL_START, SESSION_START.ts);
    assert.equal(typeof transformed.ts, 'number');
    assert.equal(transformed.ts, 5123); // 5.123 seconds
  });

  it('session_end gets delta ms', () => {
    const codec = makePlainCodec();
    const transformed = codec._applyCompactTransforms(SESSION_END, SESSION_START.ts);
    assert.equal(typeof transformed.ts, 'number');
    assert.equal(transformed.ts, 300000); // 5 minutes
  });

  it('no delta when sessionStartTs is null', () => {
    const codec = makePlainCodec();
    const transformed = codec._applyCompactTransforms(TOOL_START, null);
    assert.equal(typeof transformed.ts, 'string');
    assert.equal(transformed.ts, TOOL_START.ts);
  });

  it('round-trips through encode/decode (single frame)', () => {
    const codec = makePlainCodec();
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);

    const frames = ALL_EVENTS.map(e =>
      codec.encodeFrame(e, dict, SESSION_START.ts)
    );
    const buf = Buffer.concat([dictFrame, ...frames]);
    const decoded = codec.decodeAllFrames(buf);

    assert.equal(decoded.length, ALL_EVENTS.length);
    for (let i = 0; i < ALL_EVENTS.length; i++) {
      assert.equal(decoded[i].ts, ALL_EVENTS[i].ts);
      assert.equal(decoded[i].event, ALL_EVENTS[i].event);
    }
  });
});

// ─── Compact tool_use_id tests ──────────────────────────────────────

describe('compact tool_use_id', () => {
  it('compresses toolu_01 prefix + base58 suffix', () => {
    const codec = makePlainCodec();
    const transformed = codec._applyCompactTransforms(TOOL_START, null);
    // Should not be a string anymore
    assert.notEqual(typeof transformed.tool_use_id, 'string');
  });

  it('leaves non-standard tool_use_ids unchanged', () => {
    const codec = makePlainCodec();
    const evt = { ...TOOL_START, tool_use_id: 'custom_id_123' };
    const transformed = codec._applyCompactTransforms(evt, null);
    assert.equal(transformed.tool_use_id, 'custom_id_123');
  });

  it('round-trips through single frame encode/decode', () => {
    const codec = makePlainCodec();
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);

    const frame1 = codec.encodeFrame(SESSION_START, dict, SESSION_START.ts);
    const frame2 = codec.encodeFrame(TOOL_START, dict, SESSION_START.ts);
    const frame3 = codec.encodeFrame(TOOL_END, dict, SESSION_START.ts);

    const buf = Buffer.concat([dictFrame, frame1, frame2, frame3]);
    const decoded = codec.decodeAllFrames(buf);

    assert.equal(decoded[1].tool_use_id, TOOL_START.tool_use_id);
    assert.equal(decoded[2].tool_use_id, TOOL_END.tool_use_id);
  });

  it('round-trips multiple distinct tool_use_ids', () => {
    const codec = makePlainCodec();
    const ids = [
      'toolu_01BXcvWsRsff8mikG2VPWdcr',
      'toolu_01CnYcdKcRf3zxxgz8KP2jAb',
      'toolu_01Pd4p7qJkzmfbCFff6qDVDn',
    ];
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);
    const frames = [codec.encodeFrame(SESSION_START, dict, SESSION_START.ts)];

    for (const id of ids) {
      frames.push(codec.encodeFrame(
        { ...TOOL_START, tool_use_id: id },
        dict, SESSION_START.ts
      ));
    }

    const buf = Buffer.concat([dictFrame, ...frames]);
    const decoded = codec.decodeAllFrames(buf);

    for (let i = 0; i < ids.length; i++) {
      assert.equal(decoded[i + 1].tool_use_id, ids[i]);
    }
  });
});

// ─── Batch encryption tests ─────────────────────────────────────────

describe('batch encryption', () => {
  // Use env-based key for testing
  let codec;
  const testKey = crypto.randomBytes(32);

  beforeEach(() => {
    process.env.HOOK_HERO_KEY = testKey.toString('hex');
    codec = new StorageCodec({
      storage: {
        format: 'msgpack',
        encryption: { enabled: true, key_source: 'env' },
      },
    });
  });

  it('encodeBatchFrame produces a single encrypted frame for multiple events', () => {
    const { dict } = codec.buildDynamicDict(SESSION_START);
    const payloads = ALL_EVENTS.map(e =>
      codec.encodeEventPayload(e, dict, SESSION_START.ts)
    );
    const frame = codec.encodeBatchFrame(payloads);

    // Should be a single length-prefixed frame
    assert.ok(frame.length > 4);
    const frameLen = frame.readUInt32BE(0);
    assert.equal(frame.length, 4 + frameLen);
  });

  it('batch frame decodes all events correctly', () => {
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);
    const payloads = ALL_EVENTS.map(e =>
      codec.encodeEventPayload(e, dict, SESSION_START.ts)
    );
    const batchFrame = codec.encodeBatchFrame(payloads);

    const buf = Buffer.concat([dictFrame, batchFrame]);
    const decoded = codec.decodeAllFrames(buf);

    assert.equal(decoded.length, ALL_EVENTS.length);
    for (let i = 0; i < ALL_EVENTS.length; i++) {
      assert.equal(decoded[i].event, ALL_EVENTS[i].event);
      assert.equal(decoded[i].ts, ALL_EVENTS[i].ts);
      assert.equal(decoded[i].session_id, ALL_EVENTS[i].session_id);
    }
  });

  it('mixed single + batch frames decode in order', () => {
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);

    // session_start as single frame
    const singleFrame = codec.encodeFrame(SESSION_START, dict, SESSION_START.ts);

    // tool events as batch
    const batchPayloads = [TOOL_START, TOOL_END].map(e =>
      codec.encodeEventPayload(e, dict, SESSION_START.ts)
    );
    const batchFrame = codec.encodeBatchFrame(batchPayloads);

    // session_end as single frame
    const endFrame = codec.encodeFrame(SESSION_END, dict, SESSION_START.ts);

    const buf = Buffer.concat([dictFrame, singleFrame, batchFrame, endFrame]);
    const decoded = codec.decodeAllFrames(buf);

    assert.equal(decoded.length, 4);
    assert.equal(decoded[0].event, 'session_start');
    assert.equal(decoded[1].event, 'tool_start');
    assert.equal(decoded[1].tool_use_id, TOOL_START.tool_use_id);
    assert.equal(decoded[2].event, 'tool_end');
    assert.equal(decoded[3].event, 'session_end');
  });

  it('single-item batch uses regular frame (no batch marker)', () => {
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const payload = codec.encodeEventPayload(SESSION_START, dict, SESSION_START.ts);
    const batchFrame = codec.encodeBatchFrame([payload]);
    const singleFrame = codec.encodeFrame(SESSION_START, dict, SESSION_START.ts);

    // Both should be similar size (single-item batch = single encrypted frame)
    // The sizes won't be identical due to random IVs
    assert.ok(Math.abs(batchFrame.length - singleFrame.length) < 4);
  });

  it('empty batch returns empty buffer', () => {
    const frame = codec.encodeBatchFrame([]);
    assert.equal(frame.length, 0);
  });

  it('batch is smaller than individual frames', () => {
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);

    // 8 tool call pairs
    const events = [SESSION_START];
    for (let i = 0; i < 8; i++) {
      events.push({ ...TOOL_START, ts: new Date(Date.parse(SESSION_START.ts) + (i+1)*1000).toISOString() });
      events.push({ ...TOOL_END, ts: new Date(Date.parse(SESSION_START.ts) + (i+1)*1000 + 200).toISOString() });
    }
    events.push(SESSION_END);

    // Old: individual frames
    const oldFrames = events.map(e => codec.encodeFrame(e, dict, SESSION_START.ts));
    const oldSize = dictFrame.length + oldFrames.reduce((s, b) => s + b.length, 0);

    // New: batched
    const newFrames = [dictFrame];
    for (let i = 0; i < events.length; i += 8) {
      const batch = events.slice(i, i + 8);
      const payloads = batch.map(e => codec.encodeEventPayload(e, dict, SESSION_START.ts));
      newFrames.push(codec.encodeBatchFrame(payloads));
    }
    const newSize = newFrames.reduce((s, b) => s + b.length, 0);

    assert.ok(newSize < oldSize, `Expected ${newSize} < ${oldSize}`);
  });
});

// ─── Backwards compatibility tests ──────────────────────────────────

describe('backwards compatibility', () => {
  it('decodes legacy JSONL format', () => {
    const codec = makePlainCodec();
    const jsonl = ALL_EVENTS.map(e => JSON.stringify(e)).join('\n');
    const decoded = codec.decodeAllFrames(Buffer.from(jsonl));
    assert.equal(decoded.length, ALL_EVENTS.length);
    assert.equal(decoded[0].event, 'session_start');
    assert.equal(decoded[3].event, 'session_end');
  });

  it('decodes old-format single encrypted frames (no delta/compact)', () => {
    const testKey = crypto.randomBytes(32);
    process.env.HOOK_HERO_KEY = testKey.toString('hex');
    const codec = new StorageCodec({
      storage: {
        format: 'msgpack',
        encryption: { enabled: true, key_source: 'env' },
      },
    });

    // Simulate old-format encoding: no delta ts, no compact tool_use_id
    // Using encodeFrame with null sessionStartTs (old behavior)
    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);
    const frames = ALL_EVENTS.map(e => codec.encodeFrame(e, dict, null));
    const buf = Buffer.concat([dictFrame, ...frames]);

    const decoded = codec.decodeAllFrames(buf);
    assert.equal(decoded.length, ALL_EVENTS.length);
    // Timestamps should be original ISO strings (no delta encoding)
    assert.equal(decoded[0].ts, SESSION_START.ts);
    assert.equal(decoded[1].ts, TOOL_START.ts);
    assert.equal(decoded[1].tool_use_id, TOOL_START.tool_use_id);
  });

  it('reads real encrypted event files from disk', () => {
    // Only runs if real data exists
    const eventsDir = path.join(os.homedir(), '.claude', 'hook-hero', 'events');
    if (!fs.existsSync(eventsDir)) return;

    // Clear test env key so the real keyfile is used
    delete process.env.HOOK_HERO_KEY;
    const codec = new StorageCodec();
    const dateDirs = fs.readdirSync(eventsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dateDirs.length === 0) return;

    const dateDir = dateDirs[dateDirs.length - 1];
    const files = fs.readdirSync(path.join(eventsDir, dateDir)).filter(f => f.endsWith('.events'));
    if (files.length === 0) return;

    const buf = fs.readFileSync(path.join(eventsDir, dateDir, files[0]));
    const events = codec.decodeAllFrames(buf);

    assert.ok(events.length > 0, 'Should decode at least one event');
    assert.equal(events[0].event, 'session_start');
    assert.ok(typeof events[0].ts === 'string', 'First event should have ISO timestamp');
    assert.ok(events[0].session_id, 'First event should have session_id');
  });
});

// ─── Combined optimizations round-trip ──────────────────────────────

describe('combined optimizations round-trip', () => {
  it('all three optimizations together with encrypted batch', () => {
    const testKey = crypto.randomBytes(32);
    process.env.HOOK_HERO_KEY = testKey.toString('hex');
    const codec = new StorageCodec({
      storage: {
        format: 'msgpack',
        encryption: { enabled: true, key_source: 'env' },
      },
    });

    const { dict, reverseDict } = codec.buildDynamicDict(SESSION_START);
    const dictFrame = codec.encodeDictFrame(reverseDict);

    // session_start as single frame (always first, starts the file)
    const startFrame = codec.encodeFrame(SESSION_START, dict, SESSION_START.ts);

    // tool events as batch
    const batchPayloads = [TOOL_START, TOOL_END].map(e =>
      codec.encodeEventPayload(e, dict, SESSION_START.ts)
    );
    const batchFrame = codec.encodeBatchFrame(batchPayloads);

    // session_end as single frame
    const endFrame = codec.encodeFrame(SESSION_END, dict, SESSION_START.ts);

    const buf = Buffer.concat([dictFrame, startFrame, batchFrame, endFrame]);
    const decoded = codec.decodeAllFrames(buf);

    assert.equal(decoded.length, 4);

    // Verify all fields round-trip perfectly
    assert.deepStrictEqual(decoded[0], SESSION_START);

    assert.equal(decoded[1].ts, TOOL_START.ts);
    assert.equal(decoded[1].tool_use_id, TOOL_START.tool_use_id);
    assert.equal(decoded[1].tool, 'Read');
    assert.equal(decoded[1].event, 'tool_start');
    assert.deepStrictEqual(decoded[1].tool_input_summary, TOOL_START.tool_input_summary);

    assert.equal(decoded[2].ts, TOOL_END.ts);
    assert.equal(decoded[2].tool_use_id, TOOL_END.tool_use_id);
    assert.equal(decoded[2].status, 'success');

    assert.equal(decoded[3].ts, SESSION_END.ts);
    assert.equal(decoded[3].event, 'session_end');
  });
});
