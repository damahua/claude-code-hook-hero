#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Run via tsx for development (no build step needed)
const result = spawnSync('npx', ['tsx', join(root, 'src', 'cli.tsx'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 0);
