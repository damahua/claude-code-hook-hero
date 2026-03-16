import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.claude', 'hook-hero');
const LOCK_RETRIES = 10;
const LOCK_RETRY_DELAY_MS = 50;
const STALE_LOCK_AGE_MS = 30_000;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export class SessionStore {
  constructor(baseDir = DEFAULT_BASE_DIR) {
    this.baseDir = baseDir;
  }

  ensureDirs(date) {
    fs.mkdirSync(path.join(this.baseDir, 'events', date), { recursive: true });
    fs.mkdirSync(path.join(this.baseDir, 'sessions', date), { recursive: true });
    fs.mkdirSync(path.join(this.baseDir, 'buffer'), { recursive: true });
  }

  appendEvent(date, sessionId, eventObj) {
    const filePath = path.join(this.baseDir, 'events', date, `${sessionId}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(eventObj) + '\n');
  }

  createBuffer(sessionId, data) {
    const filePath = this.#bufferPath(sessionId);
    fs.writeFileSync(filePath, JSON.stringify(data));
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
      fs.writeFileSync(this.#bufferPath(sessionId), JSON.stringify(updated));
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
    const filePath = this.#bufferPath(sessionId);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  writeSession(date, sessionId, summary) {
    const filePath = path.join(this.baseDir, 'sessions', date, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
  }

  deleteBuffer(sessionId) {
    try {
      fs.unlinkSync(this.#bufferPath(sessionId));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
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

    const now = Date.now();
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(bufferDir, entry);
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

  #bufferPath(sessionId) {
    return path.join(this.baseDir, 'buffer', `${sessionId}.json`);
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
