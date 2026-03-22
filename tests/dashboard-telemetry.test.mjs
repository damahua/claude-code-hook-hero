import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../lib/session-store.mjs';
import { StorageCodec } from '../lib/storage-codec.mjs';

/**
 * These tests verify that the dashboard's data reading patterns work correctly
 * with both JSON and msgpack formats, mixed formats, and edge cases like
 * duplicate buffer files (.json + .buf for same session).
 */

const JSON_CONFIG = { storage: { format: 'json', encryption: { enabled: false } } };
const MSGPACK_CONFIG = { storage: { format: 'msgpack', encryption: { enabled: false } } };

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Simulate what the dashboard's useTelemetry does:
 * 1. Read buffer dir for active sessions
 * 2. Read events from all relevant dates
 * 3. Count sessions, events, etc.
 */
function simulateDashboardRead(baseDir) {
  const codec = new StorageCodec(MSGPACK_CONFIG);
  const date = today();
  const bufferDir = path.join(baseDir, 'buffer');

  // Step 1: Collect dates from buffers
  const datesToRead = new Set([date]);
  const bufferSessionIds = new Set();
  try {
    for (const f of fs.readdirSync(bufferDir).filter(f => f.endsWith('.json') || f.endsWith('.buf'))) {
      const sessionId = f.replace(/\.(json|buf)$/, '');
      bufferSessionIds.add(sessionId);
      try {
        const buf = codec.decode(fs.readFileSync(path.join(bufferDir, f)));
        if (buf?.date) datesToRead.add(buf.date);
      } catch {}
    }
  } catch {}

  // Step 2: Read events
  let totalEvents = 0;
  for (const d of datesToRead) {
    const eventsDir = path.join(baseDir, 'events', d);
    if (!fs.existsSync(eventsDir)) continue;
    const files = fs.readdirSync(eventsDir).filter(f => f.endsWith('.jsonl') || f.endsWith('.events'));
    for (const f of files) {
      try {
        const buf = fs.readFileSync(path.join(eventsDir, f));
        const events = codec.decodeAllFrames(buf);
        totalEvents += events.length;
      } catch {}
    }
  }

  // Step 3: Count finalized sessions
  let finalizedSessions = 0;
  const sd = path.join(baseDir, 'sessions', date);
  if (fs.existsSync(sd)) {
    finalizedSessions = fs.readdirSync(sd).filter(f => f.endsWith('.json')).length;
  }

  return {
    activeBuffers: bufferSessionIds.size,
    totalSessions: finalizedSessions + bufferSessionIds.size,
    totalEvents,
    datesToRead: [...datesToRead],
  };
}

describe('Dashboard telemetry reading', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-dash-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads msgpack buffers and events', () => {
    const store = new SessionStore(tmpDir, new StorageCodec(MSGPACK_CONFIG));
    const date = today();
    store.ensureDirs(date);

    const event = { v: 1, ts: new Date().toISOString(), event: 'session_start', session_id: 'sess1', channel: 'claude-code' };
    store.initEventFile(date, 'sess1', event);
    store.appendEvent(date, 'sess1', event);
    store.createBuffer('sess1', { session_id: 'sess1', date, channel: 'claude-code' });

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 1);
    assert.equal(result.totalSessions, 1);
    assert.equal(result.totalEvents, 1);
  });

  it('reads JSON buffers and events (legacy format)', () => {
    const store = new SessionStore(tmpDir, new StorageCodec(JSON_CONFIG));
    const date = today();
    store.ensureDirs(date);

    const event = { v: 1, ts: new Date().toISOString(), event: 'session_start', session_id: 'sess1', channel: 'claude-code' };
    store.appendEvent(date, 'sess1', event);
    store.createBuffer('sess1', { session_id: 'sess1', date, channel: 'claude-code' });

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 1);
    assert.equal(result.totalSessions, 1);
    assert.equal(result.totalEvents, 1);
  });

  it('deduplicates when both .json and .buf exist for same session', () => {
    const date = today();
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'events', date), { recursive: true });

    // Write both formats for the same session (simulates migration mid-session)
    const bufData = { session_id: 'sess1', date, channel: 'claude-code' };
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), JSON.stringify(bufData));

    const codec = new StorageCodec(MSGPACK_CONFIG);
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.buf'), codec.encode(bufData));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 1, 'should deduplicate .json and .buf for same session');
    assert.equal(result.totalSessions, 1);
  });

  it('reads mixed format events (JSONL + msgpack) in same date directory', () => {
    const date = today();
    fs.mkdirSync(path.join(tmpDir, 'events', date), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });

    // Session 1: JSONL format
    const ev1 = { v: 1, ts: new Date().toISOString(), event: 'session_start', session_id: 'sess1' };
    fs.writeFileSync(path.join(tmpDir, 'events', date, 'sess1.jsonl'), JSON.stringify(ev1) + '\n');
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), JSON.stringify({ session_id: 'sess1', date }));

    // Session 2: msgpack format
    const codec = new StorageCodec(MSGPACK_CONFIG);
    const ev2 = { v: 1, ts: new Date().toISOString(), event: 'session_start', session_id: 'sess2', channel: 'claude-code' };
    const { reverseDict } = codec.buildDynamicDict(ev2);
    const dictFrame = codec.encodeDictFrame(reverseDict);
    const frame = codec.encodeFrame(ev2, {});
    fs.writeFileSync(path.join(tmpDir, 'events', date, 'sess2.events'), Buffer.concat([dictFrame, frame]));
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess2.buf'), codec.encode({ session_id: 'sess2', date }));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 2);
    assert.equal(result.totalSessions, 2);
    assert.equal(result.totalEvents, 2);
  });

  it('counts finalized sessions separately from active buffers', () => {
    const date = today();
    fs.mkdirSync(path.join(tmpDir, 'sessions', date), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'events', date), { recursive: true });

    // Finalized session
    fs.writeFileSync(
      path.join(tmpDir, 'sessions', date, 'done1.json'),
      JSON.stringify({ session_id: 'done1', tokens: { total: 1000 } })
    );

    // Active buffer
    const codec = new StorageCodec(MSGPACK_CONFIG);
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'active1.buf'), codec.encode({ session_id: 'active1', date }));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 1);
    assert.equal(result.totalSessions, 2, '1 finalized + 1 active');
  });

  it('reads events across multiple dates when buffer references old date', () => {
    const oldDate = '2026-03-01';
    const todayDate = today();

    fs.mkdirSync(path.join(tmpDir, 'events', oldDate), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'events', todayDate), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });

    // Old event
    const ev = { v: 1, ts: '2026-03-01T10:00:00Z', event: 'session_start', session_id: 'old-sess' };
    fs.writeFileSync(path.join(tmpDir, 'events', oldDate, 'old-sess.jsonl'), JSON.stringify(ev) + '\n');

    // Active buffer pointing to old date
    const codec = new StorageCodec(MSGPACK_CONFIG);
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'old-sess.buf'), codec.encode({ session_id: 'old-sess', date: oldDate }));

    const result = simulateDashboardRead(tmpDir);
    assert.ok(result.datesToRead.includes(oldDate), 'should include old date from buffer');
    assert.equal(result.totalEvents, 1);
  });

  it('handles empty buffer directory gracefully', () => {
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 0);
    assert.equal(result.totalSessions, 0);
    assert.equal(result.totalEvents, 0);
  });

  it('handles missing buffer directory gracefully', () => {
    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 0);
    assert.equal(result.totalSessions, 0);
  });

  it('ignores non-buffer files (.debug, .lock, .batch)', () => {
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });

    // These should NOT be counted as sessions
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.debug'), '');
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.batch'), '{}');

    // Only this should count
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), JSON.stringify({ session_id: 'sess1', date: today() }));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 1, 'only .json/.buf should count');
  });

  it('handles corrupted buffer file without crashing', () => {
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'bad.buf'), Buffer.from([0xFF, 0xFE, 0x00]));
    fs.writeFileSync(path.join(tmpDir, 'buffer', 'good.json'), JSON.stringify({ session_id: 'good', date: today() }));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.activeBuffers, 2, 'corrupted file still counted by filename');
  });

  it('handles corrupted events file without crashing', () => {
    const date = today();
    fs.mkdirSync(path.join(tmpDir, 'events', date), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });

    // Good events file
    const ev = { v: 1, ts: new Date().toISOString(), event: 'session_start', session_id: 'sess1' };
    fs.writeFileSync(path.join(tmpDir, 'events', date, 'sess1.jsonl'), JSON.stringify(ev) + '\n');

    // Corrupted events file
    fs.writeFileSync(path.join(tmpDir, 'events', date, 'bad.events'), Buffer.from([0x00, 0x00, 0x00, 0x05, 0xFF, 0xFE]));

    fs.writeFileSync(path.join(tmpDir, 'buffer', 'sess1.json'), JSON.stringify({ session_id: 'sess1', date }));

    const result = simulateDashboardRead(tmpDir);
    assert.equal(result.totalEvents, 1, 'good events should still be read');
  });
});

describe('StorageCodec round-trip with encryption', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-hero-enc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypted buffer round-trips correctly', () => {
    const keyPath = path.join(tmpDir, '.key');
    const encConfig = { storage: { format: 'msgpack', encryption: { enabled: true, key_source: 'keyfile' } } };

    // Set env to use our temp key location
    const origHome = process.env.HOME;
    // Create a codec that will auto-generate a key
    const codec = new StorageCodec(encConfig);

    const data = { session_id: 'test-enc', date: '2026-03-21', tools_total: 42 };
    const encoded = codec.encode(data);

    // Verify it's encrypted (doesn't start with '{')
    assert.notEqual(encoded[0], 0x7B, 'should not be plain JSON');

    // Decode
    const decoded = codec.decode(encoded);
    assert.equal(decoded.session_id, 'test-enc');
    assert.equal(decoded.tools_total, 42);
  });

  it('encrypted events round-trip correctly', () => {
    const encConfig = { storage: { format: 'msgpack', encryption: { enabled: true, key_source: 'keyfile' } } };
    const codec = new StorageCodec(encConfig);

    const ev1 = { v: 1, ts: '2026-03-21T10:00:00Z', event: 'session_start', session_id: 'enc-sess', channel: 'claude-code' };
    const ev2 = { v: 1, ts: '2026-03-21T10:00:01Z', event: 'tool_start', session_id: 'enc-sess', tool: 'Read' };

    const { dict, reverseDict } = codec.buildDynamicDict(ev1);
    const dictFrame = codec.encodeDictFrame(reverseDict);
    const f1 = codec.encodeFrame(ev1, dict);
    const f2 = codec.encodeFrame(ev2, dict);

    const combined = Buffer.concat([dictFrame, f1, f2]);
    const decoded = codec.decodeAllFrames(combined);

    assert.equal(decoded.length, 2);
    assert.equal(decoded[0].event, 'session_start');
    assert.equal(decoded[0].session_id, 'enc-sess');
    assert.equal(decoded[1].event, 'tool_start');
    assert.equal(decoded[1].tool, 'Read');
  });
});
