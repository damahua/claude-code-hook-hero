import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost, loadCostRates } from '../lib/cost-calculator.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('calculateCost', () => {
  const rates = {
    'claude-opus-4-6': { input_per_1k: 0.015, output_per_1k: 0.075, cache_read_per_1k: 0.00375, cache_write_per_1k: 0.01875 }
  };

  it('calculates cost for known model', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, 0.015 + 0.075);
  });

  it('returns null for unknown model', () => {
    const cost = calculateCost('unknown-model', { input: 1000, output: 1000, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, null);
  });

  it('handles zero tokens', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 0, output: 0, cache_read: 0, cache_write: 0 }, rates);
    assert.equal(cost, 0);
  });

  it('includes cache costs', () => {
    const cost = calculateCost('claude-opus-4-6', { input: 0, output: 0, cache_read: 1000, cache_write: 1000 }, rates);
    assert.equal(cost, 0.00375 + 0.01875);
  });
});

describe('loadCostRates', () => {
  it('merges user overrides with defaults', () => {
    const tmpFile = path.join(os.tmpdir(), 'hook-hero-cost-override-test.json');
    fs.writeFileSync(tmpFile, JSON.stringify({
      cost_rates: { 'custom-model': { input_per_1k: 0.001, output_per_1k: 0.002, cache_read_per_1k: 0, cache_write_per_1k: 0 } }
    }));
    const rates = loadCostRates(tmpFile);
    assert.ok(rates['claude-opus-4-6']);
    assert.equal(rates['custom-model'].input_per_1k, 0.001);
    fs.unlinkSync(tmpFile);
  });

  it('returns defaults when override path is missing', () => {
    const rates = loadCostRates('/nonexistent/path.json');
    assert.ok(rates['claude-opus-4-6']);
  });
});
