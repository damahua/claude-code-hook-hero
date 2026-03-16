// lib/stdin-reader.mjs
import { stdin } from 'node:process';

export function parseHookInput(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

export async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return parseHookInput(Buffer.concat(chunks).toString('utf-8'));
}
