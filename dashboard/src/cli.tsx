#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { App } from './app.js';
import { StorageCodec } from '../../lib/storage-codec.mjs';

const DEFAULT_BASE = path.join(os.homedir(), '.claude', 'hook-hero');

function today(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const program = new Command();

program
  .name('hook-hero')
  .description('⚔️  Hook Hero — Agent telemetry dashboard')
  .version('1.0.0');

function enterFullScreen() {
  // Patch stdout to strip \x1b[3J (erase scrollback) — Ink's renderer
  // emits this on full-screen redraws, triggering iTerm's
  // "A control sequence attempted to clear scrollback history" warning.
  const origWrite = process.stdout.write;
  process.stdout.write = function (chunk: any, enc?: any, cb?: any) {
    if (typeof chunk === 'string') {
      chunk = chunk.replaceAll('\x1b[3J', '');
    } else if (Buffer.isBuffer(chunk)) {
      const str = chunk.toString();
      if (str.includes('\x1b[3J')) {
        chunk = Buffer.from(str.replaceAll('\x1b[3J', ''));
      }
    }
    return origWrite.call(process.stdout, chunk, enc, cb);
  } as any;

  process.stdout.write('\x1b[?1049h'); // alternate screen buffer
  process.stdout.write('\x1b[H');      // cursor home

  // Disable mouse reporting — terminal mouse clicks send escape sequences
  // that Ink misinterprets as keyboard input, causing unwanted scrolling.
  process.stdout.write('\x1b[?1000l'); // disable basic mouse reporting
  process.stdout.write('\x1b[?1002l'); // disable cell-motion mouse tracking
  process.stdout.write('\x1b[?1003l'); // disable all-motion mouse tracking

  process.on('exit', () => {
    process.stdout.write = origWrite;  // restore original write
    process.stdout.write('\x1b[?1049l'); // restore main screen (also restores mouse state)
  });
}

program
  .command('live')
  .alias('l')
  .description('Watch telemetry in real-time')
  .option('--dir <path>', 'Hook-hero data directory', undefined)
  .action((opts) => {
    enterFullScreen();
    render(<App mode="live" baseDir={opts.dir} />);
  });

program
  .command('history')
  .alias('h')
  .description('View historical session data')
  .option('--date <YYYY-MM-DD>', 'Date to view (default: today)', undefined)
  .option('--dir <path>', 'Hook-hero data directory', undefined)
  .action((opts) => {
    enterFullScreen();
    render(<App mode="history" date={opts.date} baseDir={opts.dir} />);
  });

program
  .command('export')
  .alias('x')
  .description('Export session data as readable JSON')
  .option('--session <id>', 'Session ID (prefix match supported)')
  .option('--date <YYYY-MM-DD>', 'Date to export (default: today)')
  .option('--events', 'Include raw event timeline', false)
  .option('--all', 'Export all sessions for the date', false)
  .option('--dir <path>', 'Hook-hero data directory', undefined)
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .action((opts) => {
    const baseDir = opts.dir || DEFAULT_BASE;
    const date = opts.date || today();
    const codec = new StorageCodec();

    // Find sessions to export
    const sessionsDir = path.join(baseDir, 'sessions', date);
    const eventsDir = path.join(baseDir, 'events', date);

    let sessionFiles: string[] = [];
    try {
      sessionFiles = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
    } catch {
      // No sessions dir — check events dir for active sessions
    }

    // Also check buffer for active sessions
    const bufferDir = path.join(baseDir, 'buffer');
    let bufferFiles: string[] = [];
    try {
      bufferFiles = fs.readdirSync(bufferDir).filter((f: string) => f.endsWith('.json') || f.endsWith('.buf'));
    } catch {}

    if (opts.session) {
      // Filter by session ID prefix
      const prefix = opts.session;
      sessionFiles = sessionFiles.filter((f: string) => f.startsWith(prefix));
      bufferFiles = bufferFiles.filter((f: string) => f.replace(/\.(json|buf)$/, '').startsWith(prefix));
    } else if (!opts.all) {
      console.error('Specify --session <id> or --all. Use hook-hero export --all --date 2026-03-20');
      console.error('');
      // List available sessions
      console.error('Available sessions for ' + date + ':');
      for (const f of sessionFiles) {
        const id = f.replace('.json', '');
        try {
          const summary = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
          const project = summary.context?.project_name || '?';
          const dur = summary.timing?.duration_seconds || 0;
          const cost = summary.tokens?.estimated_cost_usd;
          console.error(`  ${id.slice(0, 12)}  ${project}  ${Math.round(dur / 60)}m  ${cost != null ? '$' + cost.toFixed(2) : ''}`);
        } catch {
          console.error(`  ${id}`);
        }
      }
      for (const f of bufferFiles) {
        const id = f.replace(/\.(json|buf)$/, '');
        if (sessionFiles.some((sf: string) => sf.startsWith(id))) continue;
        console.error(`  ${id.slice(0, 12)}  (active)`);
      }
      process.exit(1);
    }

    const results: any[] = [];

    // Export finalized sessions
    for (const f of sessionFiles) {
      const sessionId = f.replace('.json', '');
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
        const entry: any = { ...summary };

        if (opts.events) {
          // Decrypt and decode events
          let eventsFile = path.join(eventsDir, `${sessionId}.events`);
          if (!fs.existsSync(eventsFile)) {
            eventsFile = path.join(eventsDir, `${sessionId}.jsonl`);
          }
          try {
            const buf = fs.readFileSync(eventsFile);
            entry.events = codec.decodeAllFrames(buf);
          } catch {
            entry.events = [];
          }
        }

        results.push(entry);
      } catch {}
    }

    // Export active sessions from buffer
    for (const f of bufferFiles) {
      const sessionId = f.replace(/\.(json|buf)$/, '');
      if (sessionFiles.some((sf: string) => sf.startsWith(sessionId))) continue;

      try {
        const bufPath = path.join(bufferDir, f);
        const bufData = codec.decode(fs.readFileSync(bufPath));
        const entry: any = { ...bufData, _active: true };

        if (opts.events) {
          let eventsFile = path.join(eventsDir, `${sessionId}.events`);
          if (!fs.existsSync(eventsFile)) {
            // Check other dates
            try {
              const allDates = fs.readdirSync(path.join(baseDir, 'events'));
              for (const d of allDates) {
                const candidate = path.join(baseDir, 'events', d, `${sessionId}.events`);
                if (fs.existsSync(candidate)) { eventsFile = candidate; break; }
                const candidateJsonl = path.join(baseDir, 'events', d, `${sessionId}.jsonl`);
                if (fs.existsSync(candidateJsonl)) { eventsFile = candidateJsonl; break; }
              }
            } catch {}
          }
          try {
            const buf = fs.readFileSync(eventsFile);
            entry.events = codec.decodeAllFrames(buf);
          } catch {
            entry.events = [];
          }
        }

        results.push(entry);
      } catch {}
    }

    if (results.length === 0) {
      console.error('No sessions found.');
      process.exit(1);
    }

    const output = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);

    if (opts.output) {
      fs.writeFileSync(opts.output, output);
      console.error(`Exported ${results.length} session(s) to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// Default to live mode
program
  .action(() => {
    enterFullScreen();
    render(<App mode="live" />);
  });

program.parse();
