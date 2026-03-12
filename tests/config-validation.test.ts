import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConfig,
  formatConfigWarnings,
  isPositiveInteger,
} from '../src/core/config-validation.ts';

describe('validateConfig', () => {
  it('returns empty array for valid config with all known keys', () => {
    const errors = validateConfig({
      candidates: { eslint: 'eslint-disable-next-line' },
      refPatterns: [{ match: 'DEV-{id}' }],
      scan: { patterns: ['src/**'], ignore: ['dist/**'] },
      paths: { scanResult: 'scan.json', registry: 'reg.json' },
      verify: { expiringThresholdDays: 7 },
    });
    assert.equal(errors.length, 0);
  });

  it('returns empty array for empty config', () => {
    assert.equal(validateConfig({}).length, 0);
  });

  it('returns empty array for null/undefined', () => {
    assert.equal(validateConfig(null).length, 0);
    assert.equal(validateConfig(undefined).length, 0);
  });

  it('returns empty array for non-object values', () => {
    assert.equal(validateConfig('string').length, 0);
    assert.equal(validateConfig(42).length, 0);
    assert.equal(validateConfig([]).length, 0);
  });

  it('detects unknown top-level keys', () => {
    const errors = validateConfig({
      candidates: {},
      unknownKey: 'value',
      anotherBad: 123,
    });
    assert.equal(errors.length, 2);
    assert.equal(errors[0]!.path, 'unknownKey');
    assert.ok(errors[0]!.message.includes("unknown key 'unknownKey'"));
    assert.equal(errors[1]!.path, 'anotherBad');
  });

  it('detects unknown keys in scan section', () => {
    const errors = validateConfig({
      scan: { patterns: ['src/**'], paterns: ['typo'] },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'scan.paterns');
    assert.ok(errors[0]!.message.includes("unknown key 'paterns' in 'scan'"));
  });

  it('detects unknown keys in paths section', () => {
    const errors = validateConfig({
      paths: { scanResult: 'ok', registy: 'typo' },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'paths.registy');
  });

  it('detects unknown keys in verify section', () => {
    const errors = validateConfig({
      verify: { expiringThresholdDays: 7, treshold: 14 },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify.treshold');
  });

  it('does not validate candidates section keys (dynamically defined)', () => {
    const errors = validateConfig({
      candidates: { eslint: 'whatever', customTool: 'custom-pattern' },
    });
    assert.equal(errors.length, 0);
  });

  it('detects type errors when section value is not an object', () => {
    const errors = validateConfig({
      scan: 'not-an-object',
      paths: 42,
      verify: null,
    });
    // Phase 2: all non-object sections produce type errors (including null)
    assert.equal(errors.length, 3);
    const paths = errors.map((e) => e.path);
    assert.ok(paths.includes('scan'));
    assert.ok(paths.includes('paths'));
    assert.ok(paths.includes('verify'));
  });

  it('detects multiple errors across sections', () => {
    const errors = validateConfig({
      typoTop: true,
      scan: { patterns: [], badKey: 'x' },
      paths: { oops: 'y' },
    });
    assert.equal(errors.length, 3);
    const paths = errors.map((e) => e.path);
    assert.ok(paths.includes('typoTop'));
    assert.ok(paths.includes('scan.badKey'));
    assert.ok(paths.includes('paths.oops'));
  });

  // ── Phase 2: Value type validation ──────────────────────

  it('detects non-string-array in scan.patterns', () => {
    const errors = validateConfig({
      scan: { patterns: 'not-an-array' },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'scan.patterns');
    assert.ok(errors[0]!.message.includes('expected string[]'));
  });

  it('detects non-string-array in scan.ignore', () => {
    const errors = validateConfig({
      scan: { ignore: [42, true] },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'scan.ignore');
    assert.ok(errors[0]!.message.includes('expected string[]'));
  });

  it('detects non-string paths.scanResult', () => {
    const errors = validateConfig({
      paths: { scanResult: 123 },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'paths.scanResult');
    assert.ok(errors[0]!.message.includes('expected string'));
  });

  it('detects non-string paths.registry', () => {
    const errors = validateConfig({
      paths: { registry: true },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'paths.registry');
    assert.ok(errors[0]!.message.includes('expected string'));
  });

  it('detects non-positive-integer verify.expiringThresholdDays', () => {
    const errors = validateConfig({
      verify: { expiringThresholdDays: 'seven' },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify.expiringThresholdDays');
    assert.ok(errors[0]!.message.includes('expected positive integer'));
  });

  it('detects zero verify.expiringThresholdDays', () => {
    const errors = validateConfig({
      verify: { expiringThresholdDays: 0 },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify.expiringThresholdDays');
  });

  it('detects negative verify.expiringThresholdDays', () => {
    const errors = validateConfig({
      verify: { expiringThresholdDays: -5 },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify.expiringThresholdDays');
  });

  it('detects float verify.expiringThresholdDays', () => {
    const errors = validateConfig({
      verify: { expiringThresholdDays: 3.5 },
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify.expiringThresholdDays');
  });

  it('detects non-array refPatterns', () => {
    const errors = validateConfig({
      refPatterns: 'not-an-array',
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'refPatterns');
    assert.ok(errors[0]!.message.includes('expected array'));
  });

  it('detects non-object entry in refPatterns', () => {
    const errors = validateConfig({
      refPatterns: ['not-an-object'],
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'refPatterns[0]');
    assert.ok(errors[0]!.message.includes('expected object'));
  });

  it('detects missing match field in refPatterns entry', () => {
    const errors = validateConfig({
      refPatterns: [{ urlTemplate: 'https://example.com/{id}' }],
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'refPatterns[0].match');
    assert.ok(errors[0]!.message.includes("'match' must be a string"));
  });

  it('accepts valid refPatterns entries', () => {
    const errors = validateConfig({
      refPatterns: [
        { match: 'DEV-{id}' },
        { match: 'JIRA-{id}', urlTemplate: 'https://jira.example.com/{id}' },
      ],
    });
    assert.equal(errors.length, 0);
  });

  it('accepts valid config with all value types correct', () => {
    const errors = validateConfig({
      candidates: { eslint: true },
      refPatterns: [{ match: 'SUP-{id}' }],
      scan: { patterns: ['src/**'], ignore: ['dist/**'] },
      paths: { scanResult: 'scan.json', registry: 'reg.json' },
      verify: { expiringThresholdDays: 7 },
    });
    assert.equal(errors.length, 0);
  });

  it('detects null verify section as type error', () => {
    // Phase 1 skips null sections for key checking,
    // but Phase 2 detects null as non-object type error
    const errors = validateConfig({ verify: null });
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.path, 'verify');
    assert.ok(errors[0]!.message.includes('expected object'));
  });

  it('skips undefined verify section without errors', () => {
    const errors = validateConfig({});
    const verifyErrors = errors.filter((e) => e.path.startsWith('verify'));
    assert.equal(verifyErrors.length, 0);
  });
});

describe('isPositiveInteger', () => {
  it('returns true for positive integers', () => {
    assert.equal(isPositiveInteger(1), true);
    assert.equal(isPositiveInteger(14), true);
    assert.equal(isPositiveInteger(100), true);
  });

  it('returns false for zero', () => {
    assert.equal(isPositiveInteger(0), false);
  });

  it('returns false for negative numbers', () => {
    assert.equal(isPositiveInteger(-1), false);
    assert.equal(isPositiveInteger(-14), false);
  });

  it('returns false for non-integer numbers', () => {
    assert.equal(isPositiveInteger(3.5), false);
    assert.equal(isPositiveInteger(0.1), false);
  });

  it('returns false for non-number values', () => {
    assert.equal(isPositiveInteger('7'), false);
    assert.equal(isPositiveInteger(null), false);
    assert.equal(isPositiveInteger(undefined), false);
    assert.equal(isPositiveInteger(NaN), false);
    assert.equal(isPositiveInteger(Infinity), false);
  });
});

describe('formatConfigWarnings', () => {
  it('formats errors as warning lines', () => {
    const lines = formatConfigWarnings([
      { path: 'scan.paterns', message: "unknown key 'paterns' in 'scan'" },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(
      lines[0],
      "config warning: scan.paterns: unknown key 'paterns' in 'scan'",
    );
  });

  it('returns empty array for no errors', () => {
    assert.equal(formatConfigWarnings([]).length, 0);
  });
});
