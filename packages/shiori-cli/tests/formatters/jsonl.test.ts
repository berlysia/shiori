import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VerifyResult } from '../../src/core/types.ts';
import { formatAsJsonl } from '../../src/formatters/jsonl.ts';

function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    timestamp: '2026-02-16T00:00:00.000Z',
    issues: [],
    summary: {
      total: 0,
      errors: 0,
      warnings: 0,
      byType: {
        'missing-in-registry': 0,
        'unused-in-source': 0,
        expired: 0,
        'syntax-error': 0,
        'ref-format': 0,
        'ref-collision': 0,
        'unrouted-ref': 0,
        'registry-routing-mismatch': 0,
        'expiring-soon': 0,
        'ref-status-closed': 0,
      },
    },
    scannedRecords: 0,
    registryEntries: 0,
    ...overrides,
  };
}

describe('formatAsJsonl', () => {
  it('returns empty string for empty issues', () => {
    const result = makeResult();
    assert.equal(formatAsJsonl(result), '');
  });

  it('outputs one line per issue', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'expired',
          file: undefined,
          line: undefined,
        },
        {
          type: 'missing-in-registry',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'missing',
          file: 'test.ts',
          line: 10,
        },
      ],
    });
    const output = formatAsJsonl(result);
    const lines = output.split('\n');
    assert.equal(lines.length, 2);
  });

  it('each line is valid JSON', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'expired on 2025-01-01',
          file: undefined,
          line: undefined,
        },
        {
          type: 'missing-in-registry',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'not in registry',
          file: 'test.ts',
          line: 10,
        },
      ],
    });
    const output = formatAsJsonl(result);
    for (const line of output.split('\n')) {
      const parsed = JSON.parse(line) as { type: string; ref: string };
      assert.ok(parsed.type);
      assert.ok(parsed.ref);
    }
  });

  it('preserves issue fields in each line', () => {
    const result = makeResult({
      issues: [
        {
          type: 'syntax-error',
          severity: 'error',
          ref: 'SUP-003',
          message: 'bad syntax',
          file: 'foo.ts',
          line: 5,
        },
      ],
    });
    const output = formatAsJsonl(result);
    const parsed = JSON.parse(output) as {
      type: string;
      severity: string;
      ref: string;
      file: string;
      line: number;
    };
    assert.equal(parsed.type, 'syntax-error');
    assert.equal(parsed.severity, 'error');
    assert.equal(parsed.ref, 'SUP-003');
    assert.equal(parsed.file, 'foo.ts');
    assert.equal(parsed.line, 5);
  });
});
