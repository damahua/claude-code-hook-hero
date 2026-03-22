import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StorageCodec } from './storage-codec.mjs';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.claude', 'hook-hero');
const LOCK_RETRIES = 10;
const LOCK_RETRY_DELAY_MS = 50;
const STALE_LOCK_AGE_MS = 30_000;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export class SessionStore {
  /**
   * @param {string} [baseDir]
   * @param {StorageCodec} [codec]
   */
  constructor(baseDir = DEFAULT_BASE_DIR, codec = null) {
    this.baseDir = baseDir;
    this.codec = codec || new StorageCodec();
    // Per-session dynamic dictionaries (in-memory, keyed by sessionId)
    this._dynamicDicts = new Map();
    // Per-session start timestamps for delta encoding
    this._sessionStartTs = new Map();
  }

  ensureDirs(date) {
    fs.mkdirSync(path.join(this.baseDir, 'events', date), { recursive: true });
    fs.mkdirSync(path.join(this.baseDir, 'sessions', date), { recursive: true });
    fs.mkdirSync(path.join(this.baseDir, 'debug', date), { recursive: true });
    fs.mkdirSync(path.join(this.baseDir, 'buffer'), { recursive: true });
  }

  /**
   * Initialize a new event file with a dictionary header frame.
   * Called once per session from session-start.
   */
  initEventFile(date, sessionId, firstEvent) {
    if (this.codec.format === 'json') return; // JSON mode: no dictionary needed

    const { dict, reverseDict } = this.codec.buildDynamicDict(firstEvent);
    this._dynamicDicts.set(sessionId, dict);

    // Capture session start timestamp for delta encoding
    if (firstEvent.ts) {
      this._sessionStartTs.set(sessionId, firstEvent.ts);
    }

    const filePath = this.#eventPath(date, sessionId);
    const dictFrame = this.codec.encodeDictFrame(reverseDict);
    fs.writeFileSync(filePath, dictFrame);
  }

  // Events skipped in summary mode — only per-tool granular events
  static SUMMARY_SKIP_EVENTS = new Set(['tool_start', 'tool_end', 'tool_failure']);

  appendEvent(date, sessionId, eventObj) {
    // In summary mode, skip per-tool events (aggregates still tracked in buffer)
    if (this.codec.detailLevel === 'summary' && SessionStore.SUMMARY_SKIP_EVENTS.has(eventObj.event)) {
      return;
    }

    const dict = this._dynamicDicts.get(sessionId) || null;

    // Resolve session start timestamp for delta encoding
    let startTs = this._sessionStartTs.get(sessionId) || null;
    if (!startTs) {
      // Each hook runs in a separate process — read start_time from buffer
      const buffer = this.readBuffer(sessionId);
      if (buffer?.start_time) {
        startTs = buffer.start_time;
        this._sessionStartTs.set(sessionId, startTs);
      }
    }

    if (this.codec.format === 'json') {
      const frame = this.codec.encodeFrame(eventObj, dict, startTs);
      fs.appendFileSync(this.#eventPath(date, sessionId), frame);
      return;
    }

    // Msgpack + encryption: use disk-backed batching
    if (this.codec.encryption.enabled) {
      const payload = this.codec.encodeEventPayload(eventObj, dict, startTs);
      this.#addToBatch(sessionId, payload);
      return;
    }

    // Msgpack without encryption: single frame
    const frame = this.codec.encodeFrame(eventObj, dict, startTs);
    fs.appendFileSync(this.#eventPath(date, sessionId), frame);
  }

  /**
   * Flush any pending batched events for a session.
   * Call at session end, stop, or any boundary where events must be on disk.
   */
  flushEvents(date, sessionId) {
    const batchPath = this.#batchPath(sessionId);
    let payloads;
    try {
      const raw = fs.readFileSync(batchPath);
      payloads = this.codec.format === 'json' ? [] : this.#decodeBatchFile(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    if (payloads.length === 0) return;

    const frame = this.codec.encodeBatchFrame(payloads);
    if (frame.length > 0) {
      fs.appendFileSync(this.#eventPath(date, sessionId), frame);
    }

    // Clear the batch file
    try { fs.unlinkSync(batchPath); } catch {}
  }

  /** @private Append a payload to the disk-backed batch; flush when full. */
  #addToBatch(sessionId, payload) {
    const batchPath = this.#batchPath(sessionId);

    // Append length-prefixed payload to batch file
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(payload.length, 0);
    fs.appendFileSync(batchPath, Buffer.concat([lenBuf, payload]));

    // Check batch size — read count from file
    const count = this.#countBatchPayloads(batchPath);
    if (count >= 8) {
      // Read buffer to get the date
      const buffer = this.readBuffer(sessionId);
      if (buffer?.date) {
        this.flushEvents(buffer.date, sessionId);
      }
    }
  }

  /** @private Read all payloads from a batch file. */
  #decodeBatchFile(raw) {
    const payloads = [];
    let offset = 0;
    while (offset + 4 <= raw.length) {
      const len = raw.readUInt32BE(offset);
      offset += 4;
      if (offset + len > raw.length) break;
      payloads.push(raw.subarray(offset, offset + len));
      offset += len;
    }
    return payloads;
  }

  /** @private Count payloads in a batch file without reading them all. */
  #countBatchPayloads(batchPath) {
    try {
      const raw = fs.readFileSync(batchPath);
      let count = 0;
      let offset = 0;
      while (offset + 4 <= raw.length) {
        const len = raw.readUInt32BE(offset);
        offset += 4 + len;
        count++;
      }
      return count;
    } catch {
      return 0;
    }
  }

  #batchPath(sessionId) {
    return path.join(this.baseDir, 'buffer', `${sessionId}.batch`);
  }

  /**
   * Read all events from a session's event file.
   * Auto-detects format (JSONL or binary msgpack).
   */
  readEvents(date, sessionId) {
    // Try new format first, fall back to legacy .jsonl
    let filePath = this.#eventPath(date, sessionId);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(this.baseDir, 'events', date, `${sessionId}.jsonl`);
    }
    try {
      const buf = fs.readFileSync(filePath);
      return this.codec.decodeAllFrames(buf);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  createBuffer(sessionId, data) {
    const filePath = this.#bufferPath(sessionId);
    fs.writeFileSync(filePath, this.codec.encode(data));
  }

  updateBuffer(sessionId, mutatorFn) {
    const lockPath = this.#lockPath(sessionId);
    let lockFd = null;

    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        lockFd = fs.openSync(lockPath, 'wx');
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (this.#isLockStale(lockPath)) {
          fs.unlinkSync(lockPath);
          continue;
        }
        if (attempt < LOCK_RETRIES - 1) {
          sleepSync(LOCK_RETRY_DELAY_MS);
        } else {
          throw new Error(`Could not acquire lock for session ${sessionId} after ${LOCK_RETRIES} attempts`);
        }
      }
    }

    try {
      const buffer = this.readBuffer(sessionId);
      const updated = mutatorFn(buffer);
      fs.writeFileSync(this.#bufferPath(sessionId), this.codec.encode(updated));
    } finally {
      if (lockFd !== null) {
        fs.closeSync(lockFd);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  readBuffer(sessionId) {
    // Try new format, fall back to legacy .json
    const newPath = this.#bufferPath(sessionId);
    const legacyPath = path.join(this.baseDir, 'buffer', `${sessionId}.json`);
    const filePath = fs.existsSync(newPath) ? newPath : (fs.existsSync(legacyPath) ? legacyPath : newPath);

    try {
      const buf = fs.readFileSync(filePath);
      return this.codec.decode(buf);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // Sessions stay as JSON (human-readable, write-once)
  writeSession(date, sessionId, summary) {
    const filePath = path.join(this.baseDir, 'sessions', date, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
  }

  deleteBuffer(sessionId) {
    // Delete buffer, legacy buffer, and batch files
    for (const ext of [this.codec.bufferExtension, '.json', '.batch']) {
      try {
        fs.unlinkSync(path.join(this.baseDir, 'buffer', `${sessionId}${ext}`));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  cleanOrphanedBuffers() {
    const bufferDir = path.join(this.baseDir, 'buffer');
    let entries;
    try {
      entries = fs.readdirSync(bufferDir);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    // Collect finalized session IDs (any date) to detect stale buffers
    const finalizedIds = new Set();
    const sessionsBase = path.join(this.baseDir, 'sessions');
    try {
      for (const dateDir of fs.readdirSync(sessionsBase)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
        const dir = path.join(sessionsBase, dateDir);
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
          finalizedIds.add(f.replace('.json', ''));
        }
      }
    } catch {}

    const bufferExts = new Set(['.json', '.buf', '.batch']);
    const now = Date.now();
    for (const entry of entries) {
      const ext = path.extname(entry);
      if (!bufferExts.has(ext)) continue;
      const filePath = path.join(bufferDir, entry);
      const sessionId = entry.replace(/\.(json|buf|batch)$/, '');

      // Remove if: older than 24h OR session already finalized
      const shouldRemove = finalizedIds.has(sessionId);
      if (shouldRemove) {
        try { fs.unlinkSync(filePath); } catch {}
        continue;
      }

      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > ORPHAN_AGE_MS) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  // --- Debug mode (stays as JSONL — human-readable) ---

  isDebug(sessionId) {
    return fs.existsSync(path.join(this.baseDir, 'buffer', `${sessionId}.debug`));
  }

  enableDebug(sessionId) {
    fs.writeFileSync(path.join(this.baseDir, 'buffer', `${sessionId}.debug`), '');
  }

  disableDebug(sessionId) {
    try { fs.unlinkSync(path.join(this.baseDir, 'buffer', `${sessionId}.debug`)); } catch {}
  }

  appendDebug(date, sessionId, entry) {
    const dir = path.join(this.baseDir, 'debug', date);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${sessionId}.jsonl`), JSON.stringify(entry) + '\n');
  }

  cleanOldDebug(retentionDays = 7) {
    const debugBase = path.join(this.baseDir, 'debug');
    try {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      for (const dateDir of fs.readdirSync(debugBase)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue;
        const dirPath = path.join(debugBase, dateDir);
        const stat = fs.statSync(dirPath);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      }
    } catch {}
  }

  #eventPath(date, sessionId) {
    return path.join(this.baseDir, 'events', date, `${sessionId}${this.codec.eventExtension}`);
  }

  #bufferPath(sessionId) {
    return path.join(this.baseDir, 'buffer', `${sessionId}${this.codec.bufferExtension}`);
  }

  #lockPath(sessionId) {
    return path.join(this.baseDir, 'buffer', `${sessionId}.lock`);
  }

  #isLockStale(lockPath) {
    try {
      const stat = fs.statSync(lockPath);
      return Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS;
    } catch {
      return false;
    }
  }
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait
  }
}
