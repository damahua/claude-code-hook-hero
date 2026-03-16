#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Run via tsx for development (no build step needed)
execSync(`npx tsx ${join(root, 'src', 'cli.tsx')} ${process.argv.slice(2).join(' ')}`, {
  cwd: root,
  stdio: 'inherit',
});
