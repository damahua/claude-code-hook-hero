import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadCostRates(overridePath) {
  const defaults = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'defaults.json'), 'utf-8'));
  let overrides = {};
  try {
    if (overridePath) {
      overrides = JSON.parse(readFileSync(overridePath, 'utf-8'));
    }
  } catch { /* no overrides */ }
  return { ...defaults.cost_rates, ...(overrides.cost_rates || {}) };
}

export function calculateCost(model, tokens, rates) {
  // Strip context-window suffixes like [1m], [200k], etc.
  const normalized = model ? model.replace(/\[[\d]+[km]?\]$/i, '') : model;
  const rate = rates[normalized] || rates[model];
  if (!rate) return null;
  const { input = 0, output = 0, cache_read = 0, cache_write = 0 } = tokens;
  return (
    (input / 1000) * rate.input_per_1k +
    (output / 1000) * rate.output_per_1k +
    (cache_read / 1000) * rate.cache_read_per_1k +
    (cache_write / 1000) * rate.cache_write_per_1k
  );
}
