#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './app.js';

const program = new Command();

program
  .name('hook-hero')
  .description('⚔️  Hook Hero — Agent telemetry dashboard')
  .version('1.0.0');

program
  .command('live')
  .alias('l')
  .description('Watch telemetry in real-time')
  .option('--dir <path>', 'Hook-hero data directory', undefined)
  .action((opts) => {
    render(<App mode="live" baseDir={opts.dir} />);
  });

program
  .command('history')
  .alias('h')
  .description('View historical session data')
  .option('--date <YYYY-MM-DD>', 'Date to view (default: today)', undefined)
  .option('--dir <path>', 'Hook-hero data directory', undefined)
  .action((opts) => {
    render(<App mode="history" date={opts.date} baseDir={opts.dir} />);
  });

// Default to live mode
program
  .action(() => {
    render(<App mode="live" />);
  });

program.parse();
