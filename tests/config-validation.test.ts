import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConfig,
  formatConfigWarnings,
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

  it('skips section validation when section value is not an object', () => {
    const errors = validateConfig({
      scan: 'not-an-object',
      paths: 42,
      verify: null,
    });
    // Only the top-level keys are valid, section contents aren't objects
    assert.equal(errors.length, 0);
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
