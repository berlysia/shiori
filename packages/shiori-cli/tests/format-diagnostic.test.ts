import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatAsDiagnostic } from '../src/formatters/diagnostic.ts';
import type { VerifyResult, VerifyIssue } from '../src/core/types.ts';

function makeIssue(overrides: Partial<VerifyIssue> = {}): VerifyIssue {
  return {
    type: 'missing-in-registry',
    severity: 'error',
    ref: 'SUP-1234',
    message: 'Annotation ref not found in registry',
    file: 'src/app.ts',
    line: 42,
    ...overrides,
  };
}

function makeVerifyResult(issues: VerifyIssue[] = []): VerifyResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    issues,
    summary: {
      total: issues.length,
      errors,
      warnings,
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
    scannedRecords: 1,
    registryEntries: 1,
  };
}

describe('formatAsDiagnostic', () => {
  it('formats a single issue with file and line', () => {
    const issue = makeIssue();
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.equal(
      result,
      'src/app.ts:42:1: error: Annotation ref not found in registry [missing-in-registry]',
    );
  });

  it('returns empty string for empty issues array', () => {
    const result = formatAsDiagnostic(makeVerifyResult([]));
    assert.equal(result, '');
  });

  it('uses <unknown>:0:1 when file is undefined', () => {
    const issue = makeIssue({ file: undefined, line: undefined });
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.ok(result.startsWith('<unknown>:0:1:'));
  });

  it('uses line 0 when only line is undefined', () => {
    const issue = makeIssue({ file: 'src/app.ts', line: undefined });
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.ok(result.startsWith('src/app.ts:0:1:'));
  });

  it('maps warning severity correctly', () => {
    const issue = makeIssue({ severity: 'warning', type: 'expiring-soon' });
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.ok(result.includes(': warning:'));
  });

  it('maps error severity correctly', () => {
    const issue = makeIssue({ severity: 'error' });
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.ok(result.includes(': error:'));
  });

  it('formats multiple issues as newline-separated lines', () => {
    const issues = [
      makeIssue({ ref: 'SUP-001', file: 'a.ts', line: 1 }),
      makeIssue({
        ref: 'SUP-002',
        file: 'b.ts',
        line: 10,
        severity: 'warning',
        type: 'expiring-soon',
        message: 'Annotation expires soon',
      }),
    ];
    const result = formatAsDiagnostic(makeVerifyResult(issues));
    const lines = result.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0]!.startsWith('a.ts:1:1:'));
    assert.ok(lines[1]!.startsWith('b.ts:10:1:'));
  });

  it('includes issue type in square brackets', () => {
    const issue = makeIssue({ type: 'expired' });
    const result = formatAsDiagnostic(makeVerifyResult([issue]));
    assert.ok(result.includes('[expired]'));
  });
});
