import { encode as msgpackEncode, decode as msgpackDecode, ExtData } from '@msgpack/msgpack';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'defaults.json');
const HOOK_HERO_BASE = path.join(os.homedir(), '.claude', 'hook-hero');
const USER_CONFIG_PATH = path.join(HOOK_HERO_BASE, 'config.json');
const KEY_FILE_PATH = path.join(HOOK_HERO_BASE, '.key');

// ─── Static Dictionary ──────────────────────────────────────────────
// Keys (0-63): field names that repeat on every event
const STATIC_KEY_TO_CODE = {
  v: 0, ts: 1, event: 2, session_id: 3, tool: 4, tool_use_id: 5,
  tool_input_summary: 6, status: 7, file_path: 8, command: 9,
  prompt_length: 10, tokens: 11, input: 12, output: 13,
  cache_read: 14, cache_write: 15, pattern: 16, path: 17,
  error: 18, glob: 19, channel: 20, context: 21,
  project_path: 22, project_name: 23, directory: 24, cwd: 25,
  repo: 26, git_remote_url: 27, git_branch: 28, model: 29,
  subagent_id: 30, subagent_type: 31, url: 32, description: 33,
};

// Values use NEGATIVE numbers to avoid collision with real numeric values
// (e.g. prompt_length: 100 must not be confused with a dict code)
const STATIC_VAL_TO_CODE = {
  tool_start: -1, tool_end: -2, tool_failure: -3,
  user_prompt: -4, session_start: -5, session_end: -6,
  agent_stop: -7, subagent_start: -8, subagent_stop: -9,
  compact_start: -10, compact_end: -11, success: -12,
  worktree_create: -13, worktree_remove: -14, task_completed: -15,
  // Tool names
  Read: -20, Edit: -21, Write: -22, Bash: -23, Grep: -24,
  Glob: -25, Agent: -26, ToolSearch: -27, WebFetch: -28,
  WebSearch: -29, Skill: -30, NotebookEdit: -31,
  // Channels
  'claude-code': -40, 'claude-cli': -41,
};

// Reverse lookups
const STATIC_CODE_TO_KEY = Object.fromEntries(
  Object.entries(STATIC_KEY_TO_CODE).map(([k, v]) => [v, k])
);
const STATIC_CODE_TO_VAL = Object.fromEntries(
  Object.entries(STATIC_VAL_TO_CODE).map(([k, v]) => [v, k])
);

// Dynamic dictionary codes: use -100, -101, ... (negative, below static range)
const DYNAMIC_CODE_START = -100;

// Frame type markers
const FRAME_TYPE_DICT = 0xFF;
const FRAME_TYPE_BATCH = 0xFE;
const ENCRYPTION_VERSION = 0x01;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Batch encryption: group up to N events in one encrypted frame
const BATCH_SIZE = 8;

// ─── Base58 codec (Bitcoin alphabet — no 0, O, I, l) ─────────────────
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Uint8Array(128).fill(255);
for (let i = 0; i < 58; i++) BASE58_MAP[BASE58_ALPHABET.charCodeAt(i)] = i;

function base58Decode(str) {
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const c = BASE58_MAP[str.charCodeAt(i)];
    if (c === 255) throw new Error(`Invalid base58 char: ${str[i]}`);
    num = num * 58n + BigInt(c);
  }
  // 22 base58 chars ≈ 16 bytes
  const bytes = [];
  for (let i = 0; i < 16; i++) {
    bytes.unshift(Number(num & 0xFFn));
    num >>= 8n;
  }
  return Buffer.from(bytes);
}

function base58Encode(buf) {
  let num = 0n;
  for (let i = 0; i < buf.length; i++) {
    num = (num << 8n) | BigInt(buf[i]);
  }
  let str = '';
  while (num > 0n) {
    str = BASE58_ALPHABET[Number(num % 58n)] + str;
    num /= 58n;
  }
  // Pad to 22 chars (leading '1's in base58 = leading zeros)
  while (str.length < 22) str = '1' + str;
  return str;
}

// ─── tool_use_id compact encoding ────────────────────────────────────
const TOOL_ID_PREFIX = 'toolu_01';
const EXT_TYPE_TOOL_ID = 1; // msgpack Ext type code for compact tool_use_id

function compactToolUseId(id) {
  if (typeof id !== 'string' || !id.startsWith(TOOL_ID_PREFIX)) return id;
  try {
    const bytes = base58Decode(id.substring(TOOL_ID_PREFIX.length));
    // Wrap in msgpack Ext type to survive round-trip without being misinterpreted
    return new ExtData(EXT_TYPE_TOOL_ID, bytes);
  } catch {
    return id; // Fallback: keep as string if decode fails
  }
}

function expandToolUseId(val) {
  if (val instanceof ExtData && val.type === EXT_TYPE_TOOL_ID) {
    return TOOL_ID_PREFIX + base58Encode(Buffer.from(val.data));
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return TOOL_ID_PREFIX + base58Encode(val);
  }
  return val;
}

// ─── StorageCodec ────────────────────────────────────────────────────

export class StorageCodec {
  /**
   * @param {object} [configOverride] - Override config (for testing)
   */
  constructor(configOverride = null) {
    const config = configOverride || this._loadConfig();
    const storage = config.storage || {};
    this.format = storage.format || 'msgpack';
    this.detailLevel = storage.detail_level || 'full'; // 'full' | 'summary'
    this.encryption = storage.encryption || { enabled: false };
    this._key = null;

    if (this.encryption.enabled) {
      this._key = this._loadKey();
    }

    // NOTE: batching is managed by SessionStore (disk-backed, cross-process).
    // The codec provides encodeBatchFrame() for the store to call.
  }

  _loadConfig() {
    try {
      const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));
      let user = {};
      try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
          user = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf-8'));
        }
      } catch { /* no user config */ }
      return {
        ...defaults,
        storage: { ...defaults.storage, ...user.storage },
      };
    } catch {
      return { storage: { format: 'msgpack', encryption: { enabled: false } } };
    }
  }

  _loadKey() {
    // Env var takes priority
    const envKey = process.env.HOOK_HERO_KEY;
    if (envKey) {
      return Buffer.from(envKey, 'hex');
    }

    const keySource = this.encryption.key_source || 'keyfile';
    if (keySource === 'env') {
      throw new Error('HOOK_HERO_KEY environment variable not set');
    }

    // Keyfile: read or auto-generate
    if (fs.existsSync(KEY_FILE_PATH)) {
      return fs.readFileSync(KEY_FILE_PATH);
    }

    // Auto-generate
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(KEY_FILE_PATH), { recursive: true });
    fs.writeFileSync(KEY_FILE_PATH, key, { mode: 0o600 });
    return key;
  }

  // ─── File Extensions ────────────────────────────────────────────

  get eventExtension() {
    return this.format === 'json' ? '.jsonl' : '.events';
  }

  get bufferExtension() {
    return this.format === 'json' ? '.json' : '.buf';
  }

  // ─── Single Object Encode/Decode (for buffers) ──────────────────

  /**
   * Encode a single object to Buffer.
   * @param {object} obj
   * @returns {Buffer}
   */
  encode(obj) {
    let payload;
    if (this.format === 'json') {
      payload = Buffer.from(JSON.stringify(obj));
    } else {
      payload = Buffer.from(msgpackEncode(obj));
    }
    if (this.encryption.enabled) {
      return this._encrypt(payload);
    }
    return payload;
  }

  /**
   * Decode a Buffer to an object. Auto-detects format.
   * @param {Buffer} buf
   * @returns {object}
   */
  decode(buf) {
    if (!buf || buf.length === 0) return null;
    let payload = buf;

    // Check for encryption
    if (buf[0] === ENCRYPTION_VERSION && buf.length > 1 + IV_LENGTH + AUTH_TAG_LENGTH) {
      // Could be encrypted, but also could be valid msgpack starting with 0x01 (positive fixint)
      // Encrypted data always has: version(1) + IV(12) + at least 1 byte ciphertext + tag(16) = 30+ bytes
      // A positive fixint 0x01 in msgpack would be followed by more msgpack data
      // We try decryption if encryption is configured, otherwise treat as msgpack
      if (this.encryption.enabled && this._key) {
        try {
          payload = this._decrypt(buf);
        } catch {
          // Not encrypted, try as raw
          payload = buf;
        }
      }
    }

    // Auto-detect JSON vs msgpack
    const first = payload[0];
    if (first === 0x7B || first === 0x5B) {
      // '{' or '[' — JSON
      return JSON.parse(payload.toString('utf-8'));
    }
    // msgpack
    return msgpackDecode(payload);
  }

  // ─── Frame Encode/Decode (for append-only event logs) ───────────

  /**
   * Encode a single event as a length-prefixed frame.
   * Uses dictionary compression, delta timestamps, and compact tool_use_id.
   * @param {object} obj
   * @param {Map<string, number>} [dynamicDict] - Per-file dynamic dictionary
   * @param {string} [sessionStartTs] - ISO timestamp of session start for delta encoding
   * @returns {Buffer} - Encoded msgpack payload (NOT yet framed or encrypted — caller handles that)
   */
  encodeEventPayload(obj, dynamicDict = null, sessionStartTs = null) {
    // Apply compact transforms before dictionary compression
    const transformed = this._applyCompactTransforms(obj, sessionStartTs);
    const compressed = this._compressObj(transformed, dynamicDict);
    return Buffer.from(msgpackEncode(compressed));
  }

  /**
   * Encode a single event as a length-prefixed frame (legacy single-event path).
   * Uses dictionary compression, delta timestamps, compact tool_use_id,
   * and per-frame encryption for msgpack format.
   * @param {object} obj
   * @param {Map<string, number>} [dynamicDict] - Per-file dynamic dictionary
   * @param {string} [sessionStartTs] - ISO timestamp of session start for delta encoding
   * @returns {Buffer}
   */
  encodeFrame(obj, dynamicDict = null, sessionStartTs = null) {
    if (this.format === 'json') {
      return Buffer.from(JSON.stringify(obj) + '\n');
    }

    let encoded = this.encodeEventPayload(obj, dynamicDict, sessionStartTs);

    if (this.encryption.enabled) {
      encoded = this._encrypt(encoded);
    }

    const frame = Buffer.alloc(4 + encoded.length);
    frame.writeUInt32BE(encoded.length, 0);
    encoded.copy(frame, 4);
    return frame;
  }

  /**
   * Encode multiple event payloads into a single batch-encrypted frame.
   * @param {Buffer[]} payloads - Array of msgpack-encoded event buffers
   * @returns {Buffer}
   */
  encodeBatchFrame(payloads) {
    if (payloads.length === 0) return Buffer.alloc(0);

    if (payloads.length === 1) {
      // Single event: encrypt directly (backwards compatible, no batch marker)
      let encrypted = this._encrypt(payloads[0]);
      const frame = Buffer.alloc(4 + encrypted.length);
      frame.writeUInt32BE(encrypted.length, 0);
      encrypted.copy(frame, 4);
      return frame;
    }

    // Multiple events: [BATCH_MARKER][msgpack array of raw payloads]
    const batchPayload = Buffer.from(msgpackEncode(payloads.map(b => new Uint8Array(b))));
    const toEncrypt = Buffer.alloc(1 + batchPayload.length);
    toEncrypt[0] = FRAME_TYPE_BATCH;
    batchPayload.copy(toEncrypt, 1);

    const encrypted = this._encrypt(toEncrypt);
    const frame = Buffer.alloc(4 + encrypted.length);
    frame.writeUInt32BE(encrypted.length, 0);
    encrypted.copy(frame, 4);
    return frame;
  }

  /**
   * Apply compact transforms: delta timestamps, compact tool_use_id.
   * @param {object} obj
   * @param {string|null} sessionStartTs
   * @returns {object}
   */
  _applyCompactTransforms(obj, sessionStartTs) {
    const result = { ...obj };

    // Delta timestamp: store ms offset from session start
    // Skip for session_start event — it carries the absolute reference timestamp
    if (sessionStartTs && result.ts && result.event !== 'session_start') {
      const startMs = new Date(sessionStartTs).getTime();
      const eventMs = new Date(result.ts).getTime();
      const delta = eventMs - startMs;
      if (delta >= 0 && delta < 0xFFFFFFFF) {
        result.ts = delta; // Store as integer ms delta
      }
    }

    // Compact tool_use_id: base58 suffix → 16-byte binary
    if (result.tool_use_id) {
      result.tool_use_id = compactToolUseId(result.tool_use_id);
    }

    return result;
  }

  /**
   * Encode the per-file dictionary header frame.
   * @param {object} dynamicEntries - { string: code, ... }
   * @returns {Buffer}
   */
  encodeDictFrame(dynamicEntries) {
    if (this.format === 'json') return Buffer.alloc(0);

    const encoded = Buffer.from(msgpackEncode(dynamicEntries));
    // Frame: [4-byte length][0xFF marker][msgpack dict]
    const frame = Buffer.alloc(4 + 1 + encoded.length);
    frame.writeUInt32BE(1 + encoded.length, 0);
    frame[4] = FRAME_TYPE_DICT;
    encoded.copy(frame, 5);
    return frame;
  }

  /**
   * Decode all frames from a file buffer. Auto-detects JSONL vs binary.
   * Handles: legacy JSONL, single encrypted frames, batched encrypted frames,
   * delta timestamps, and compact tool_use_ids.
   * @param {Buffer} buf
   * @returns {Array<object>}
   */
  decodeAllFrames(buf) {
    if (!buf || buf.length === 0) return [];

    // Auto-detect: if starts with '{' or '[', it's legacy JSONL
    if (buf[0] === 0x7B || buf[0] === 0x5B) {
      const content = buf.toString('utf-8').trim();
      if (!content) return [];
      return content.split('\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    }

    // Binary frames: read length-prefixed frames
    const results = [];
    let offset = 0;
    let dynamicDict = null;
    let sessionStartTs = null; // Discovered from first session_start event

    while (offset + 4 <= buf.length) {
      const frameLen = buf.readUInt32BE(offset);
      offset += 4;

      if (offset + frameLen > buf.length) break; // Truncated frame — stop

      const frameData = buf.subarray(offset, offset + frameLen);
      offset += frameLen;

      // Check for dictionary frame (unencrypted)
      if (frameData[0] === FRAME_TYPE_DICT) {
        const dictBuf = frameData.subarray(1);
        dynamicDict = msgpackDecode(dictBuf);
        continue;
      }

      // Decrypt if needed
      let payload = frameData;
      if (payload[0] === ENCRYPTION_VERSION && this._key) {
        try {
          payload = this._decrypt(payload);
        } catch {
          continue; // Skip corrupted frame
        }
      }

      // Check for batch frame (after decryption)
      if (payload[0] === FRAME_TYPE_BATCH) {
        try {
          const batchArray = msgpackDecode(payload.subarray(1));
          for (const eventBuf of batchArray) {
            try {
              const compressed = msgpackDecode(eventBuf);
              const obj = this._decompressObj(compressed, dynamicDict);
              const restored = this._reverseCompactTransforms(obj, sessionStartTs);
              if (!sessionStartTs && restored.event === 'session_start' && typeof restored.ts === 'string') {
                sessionStartTs = restored.ts;
              }
              results.push(restored);
            } catch { /* skip corrupted event in batch */ }
          }
        } catch { /* skip corrupted batch */ }
        continue;
      }

      // Single event frame
      try {
        const compressed = msgpackDecode(payload);
        const obj = this._decompressObj(compressed, dynamicDict);
        const restored = this._reverseCompactTransforms(obj, sessionStartTs);
        // Capture session start timestamp for delta decoding
        if (!sessionStartTs && restored.event === 'session_start' && typeof restored.ts === 'string') {
          sessionStartTs = restored.ts;
        }
        results.push(restored);
      } catch {
        // Skip corrupted frame
      }
    }

    return results;
  }

  /**
   * Reverse compact transforms: restore delta timestamps and tool_use_ids.
   * @param {object} obj
   * @param {string|null} sessionStartTs
   * @returns {object}
   */
  _reverseCompactTransforms(obj, sessionStartTs) {
    const result = { ...obj };

    // Restore delta timestamp → ISO string
    if (typeof result.ts === 'number' && sessionStartTs) {
      const startMs = new Date(sessionStartTs).getTime();
      result.ts = new Date(startMs + result.ts).toISOString();
    }

    // Restore compact tool_use_id → full string
    if (result.tool_use_id !== undefined) {
      result.tool_use_id = expandToolUseId(result.tool_use_id);
    }

    return result;
  }

  // ─── Dictionary Compression ─────────────────────────────────────

  /**
   * Build a per-file dynamic dictionary from a session's first event.
   * Call this once when creating a new event file.
   * @param {object} firstEvent - The session_start event
   * @returns {{ dict: object, reverseDict: object }}
   */
  buildDynamicDict(firstEvent) {
    const dict = {};       // string -> code (negative)
    const reverseDict = {}; // code -> string
    let nextCode = DYNAMIC_CODE_START; // -100, -101, ...

    const addEntry = (val) => {
      if (val && typeof val === 'string' && val.length > 4 && STATIC_VAL_TO_CODE[val] === undefined && !dict[val]) {
        dict[val] = nextCode;
        reverseDict[nextCode] = val;
        nextCode--;
        return nextCode > -256; // stop if too many
      }
      return true;
    };

    // Add session_id (biggest savings)
    addEntry(firstEvent.session_id);

    // Add context paths if present
    const ctx = firstEvent.context;
    if (ctx) {
      for (const key of ['project_path', 'cwd', 'repo', 'git_remote_url', 'git_branch', 'model', 'project_name']) {
        if (!addEntry(ctx[key])) break;
      }
    }

    // Add channel
    addEntry(firstEvent.channel);

    return { dict, reverseDict };
  }

  /**
   * Replace known strings with integer codes.
   * @param {object} obj
   * @param {Map<string, number>|null} dynamicDict
   * @returns {object}
   */
  _compressObj(obj, dynamicDict) {
    if (typeof obj !== 'object' || obj === null) {
      return this._compressValue(obj, dynamicDict);
    }
    // Preserve ExtData (e.g. compact tool_use_id) — don't recurse into it
    if (obj instanceof ExtData) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this._compressObj(item, dynamicDict));
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const newKey = STATIC_KEY_TO_CODE[key] ?? key;
      const newValue = (typeof value === 'object' && value !== null)
        ? this._compressObj(value, dynamicDict)
        : this._compressValue(value, dynamicDict);
      result[newKey] = newValue;
    }
    return result;
  }

  _compressValue(val, dynamicDict) {
    if (typeof val !== 'string') return val;
    if (STATIC_VAL_TO_CODE[val] !== undefined) return STATIC_VAL_TO_CODE[val];
    if (dynamicDict && dynamicDict[val] !== undefined) return dynamicDict[val];
    return val;
  }

  /**
   * Restore integer codes to strings.
   * @param {object} compressed
   * @param {object|null} dynamicReverseDict
   * @returns {object}
   */
  _decompressObj(compressed, dynamicReverseDict) {
    if (typeof compressed !== 'object' || compressed === null) {
      return this._decompressValue(compressed, dynamicReverseDict);
    }
    // Preserve ExtData (e.g. compact tool_use_id) — don't recurse into it
    if (compressed instanceof ExtData) {
      return compressed;
    }
    if (Array.isArray(compressed)) {
      return compressed.map(item => this._decompressObj(item, dynamicReverseDict));
    }

    const result = {};
    for (const [key, value] of Object.entries(compressed)) {
      const numKey = typeof key === 'string' ? parseInt(key, 10) : key;
      const restoredKey = (!isNaN(numKey) && STATIC_CODE_TO_KEY[numKey]) || key;
      const restoredValue = (typeof value === 'object' && value !== null)
        ? this._decompressObj(value, dynamicReverseDict)
        : this._decompressValue(value, dynamicReverseDict);
      result[restoredKey] = restoredValue;
    }
    return result;
  }

  _decompressValue(val, dynamicReverseDict) {
    if (typeof val !== 'number' || val >= 0) return val; // Only negative numbers are dict codes
    if (STATIC_CODE_TO_VAL[val] !== undefined) return STATIC_CODE_TO_VAL[val];
    if (dynamicReverseDict && dynamicReverseDict[val] !== undefined) return dynamicReverseDict[val];
    return val;
  }

  // ─── Encryption ─────────────────────────────────────────────────

  _encrypt(buf) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([ENCRYPTION_VERSION]), iv, encrypted, tag]);
  }

  _decrypt(buf) {
    const version = buf[0];
    if (version !== ENCRYPTION_VERSION) {
      throw new Error(`Unknown encryption version: ${version}`);
    }
    const iv = buf.subarray(1, 1 + IV_LENGTH);
    const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(1 + IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
