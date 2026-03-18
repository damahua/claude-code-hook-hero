import { readStdin } from './stdin-reader.mjs';
import { SessionStore } from './session-store.mjs';

/**
 * Get today's date as YYYY-MM-DD.
 *
 * @returns {string}
 */
function getTodayDate() {
  const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/**
 * Safe keys to keep in tool_input_summary.
 */
const SAFE_KEYS = new Set(['file_path', 'pattern', 'glob', 'path', 'url', 'command']);

/**
 * Build redacted tool_input_summary — only keep safe keys.
 * For 'command', limit to first 100 characters.
 *
 * @param {object} toolInput
 * @returns {object}
 */
function buildRedactedSummary(toolInput) {
  const summary = {};
  for (const key of SAFE_KEYS) {
    if (key in toolInput) {
      let value = toolInput[key];
      if (key === 'command' && typeof value === 'string') {
        value = value.substring(0, 100);
      }
      summary[key] = value;
    }
  }
  return summary;
}

/**
 * Build the tool_start event object.
 *
 * @param {string} sessionId
 * @param {string} toolName
 * @param {string} toolUseId
 * @param {object} toolInputSummary
 * @returns {object}
 */
function buildToolStartEvent(sessionId, toolName, toolUseId, toolInputSummary) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    event: 'tool_start',
    session_id: sessionId,
    tool: toolName,
    tool_use_id: toolUseId,
    tool_input_summary: toolInputSummary,
  };
}

/**
 * Handle a pre_tool_use hook invocation.
 * Appends a tool_start event with redacted input summary.
 *
 * @param {object} input  — parsed JSON from stdin (hook payload)
 * @param {SessionStore} store
 */
export function handlePreToolUse(input, store) {
  const sessionId = input.session_id;
  const toolName = input.tool_name;
  const toolUseId = input.tool_use_id;
  const toolInput = input.tool_input || {};

  const buffer = store.readBuffer(sessionId);
  if (!buffer) {
    throw new Error(`Buffer not found for session ${sessionId}`);
  }

  const date = buffer.date;
  const toolInputSummary = buildRedactedSummary(toolInput);

  const event = buildToolStartEvent(sessionId, toolName, toolUseId, toolInputSummary);
  store.appendEvent(date, sessionId, event);
}

/**
 * Main entrypoint — reads from stdin and calls handlePreToolUse.
 */
async function main() {
  try {
    const input = await readStdin();
    const store = new SessionStore();
    handlePreToolUse(input, store);
  } catch {
    // Silent fail — exit 0 so Claude continues
    process.exit(0);
  }
}

// Only run main when this module is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
