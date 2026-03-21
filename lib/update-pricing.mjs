import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'defaults.json');
const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing';

function getTodayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Check if pricing needs updating (once per day).
 * @returns {boolean}
 */
export function needsPricingUpdate() {
  try {
    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));
    return defaults.pricing_updated !== getTodayDate();
  } catch {
    return true;
  }
}

/**
 * Fetch a URL and return the body as a string.
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<string>}
 */
function fetch(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Extract text content from an HTML table cell.
 * @param {string} td — raw <td>...</td> HTML
 * @returns {string}
 */
function tdText(td) {
  return td.replace(/<[^>]*>/g, '').trim();
}

/**
 * Parse pricing from the Anthropic pricing page HTML.
 * The page renders as HTML <td> elements, not markdown.
 *
 * Expected row format (6 cells per <tr>):
 *   <td>Claude Opus 4.6</td>
 *   <td>$5 / MTok</td>        — Base Input
 *   <td>$6.25 / MTok</td>     — 5m Cache Write
 *   <td>$10 / MTok</td>       — 1h Cache Write
 *   <td>$0.50 / MTok</td>     — Cache Hits (reads)
 *   <td>$25 / MTok</td>       — Output
 *
 * @param {string} html
 * @returns {Record<string, object>|null}
 */
function parsePricing(html) {
  // Match table rows containing "Claude" model names with 6 <td> cells
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;

  const rates = {};
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const row = trMatch[1];
    if (!row.includes('Claude ')) continue;

    // Extract all <td> contents
    const cells = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      cells.push(tdText(tdMatch[1]));
    }

    // Need exactly 6 cells: Model, Input, 5m Write, 1h Write, Cache Read, Output
    if (cells.length < 6) continue;

    const name = cells[0].replace(/^Claude\s+/, '').trim();
    if (!name) continue;

    const parsePrice = (s) => { const m = s.match(/\$([\d.]+)/); return m ? parseFloat(m[1]) : NaN; };
    const inputPerM = parsePrice(cells[1]);
    const cacheWritePerM = parsePrice(cells[2]); // 5-minute cache write
    const cacheReadPerM = parsePrice(cells[4]);
    const outputPerM = parsePrice(cells[5]);

    if ([inputPerM, cacheWritePerM, cacheReadPerM, outputPerM].some(isNaN)) continue;

    // Convert model name to ID: "Opus 4.6" -> "claude-opus-4-6"
    const modelId = 'claude-' + name.toLowerCase().replace(/\s+/g, '-').replace(/\./g, '-');

    rates[modelId] = {
      input_per_1k: inputPerM / 1000,
      output_per_1k: outputPerM / 1000,
      cache_read_per_1k: cacheReadPerM / 1000,
      cache_write_per_1k: cacheWritePerM / 1000,
    };
  }

  return Object.keys(rates).length > 0 ? rates : null;
}

/**
 * Fetch latest pricing and update defaults.json.
 * Runs async, fire-and-forget — errors are silently ignored.
 */
export async function updatePricingIfNeeded() {
  if (!needsPricingUpdate()) return;

  try {
    const html = await fetch(PRICING_URL);
    const rates = parsePricing(html);
    if (!rates) return;

    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf-8'));
    defaults.cost_rates = rates;
    defaults.pricing_source = PRICING_URL;
    defaults.pricing_updated = getTodayDate();

    fs.writeFileSync(DEFAULTS_PATH, JSON.stringify(defaults, null, 2) + '\n');
  } catch {
    // Silent fail — keep existing rates
  }
}
