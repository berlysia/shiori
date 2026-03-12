import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VerifyResult } from '../../src/core/types.ts';
import { formatAsDiagnostic } from '../../src/formatters/diagnostic.ts';

function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    timestamp: '2026-03-13T00:00:00.000Z',
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

describe('formatAsDiagnostic', () => {
  it('returns empty string for empty issues', () => {
    const result = makeResult();
    assert.equal(formatAsDiagnostic(result), '');
  });

  it('outputs one line per issue', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'Annotation expired on 2025-01-15',
          file: 'src/foo.ts',
          line: 42,
        },
        {
          type: 'missing-in-registry',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'Not found in registry',
          file: 'src/bar.ts',
          line: 10,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    const lines = output.split('\n');
    assert.equal(lines.length, 2);
  });

  it('formats issue with file and line in GCC-compatible format', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'Annotation expired on 2025-01-15',
          file: 'src/foo.ts',
          line: 42,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    assert.equal(
      output,
      'src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]',
    );
  });

  it('uses <unknown>:0 for issues without file/line', () => {
    const result = makeResult({
      issues: [
        {
          type: 'unused-in-source',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'Registry entry not found in source',
          file: undefined,
          line: undefined,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    assert.equal(
      output,
      '<unknown>:0:1: warning: Registry entry not found in source [unused-in-source]',
    );
  });

  it('maps severity correctly for error and warning', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-ERR',
          message: 'expired',
          file: 'a.ts',
          line: 1,
        },
        {
          type: 'expiring-soon',
          severity: 'warning',
          ref: 'SUP-WARN',
          message: 'expiring soon',
          file: 'b.ts',
          line: 2,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    const lines = output.split('\n');
    assert.match(lines[0]!, /: error: /);
    assert.match(lines[1]!, /: warning: /);
  });

  it('includes issue type in brackets at end of line', () => {
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
    const output = formatAsDiagnostic(result);
    assert.ok(output.endsWith('[syntax-error]'));
  });

  it('always uses column 1', () => {
    const result = makeResult({
      issues: [
        {
          type: 'ref-format',
          severity: 'warning',
          ref: 'BAD-REF',
          message: 'invalid ref format',
          file: 'src/test.ts',
          line: 100,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    // Format: file:line:column: ...  — column should be 1
    assert.match(output, /^src\/test\.ts:100:1: /);
  });

  it('handles messages with special characters', () => {
    const result = makeResult({
      issues: [
        {
          type: 'registry-routing-mismatch',
          severity: 'warning',
          ref: 'JIRA-123',
          message:
            'Ref "JIRA-123" is in default but pattern "JIRA-*" routes to jira-registry.json',
          file: undefined,
          line: undefined,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    assert.ok(output.includes('Ref "JIRA-123"'));
    assert.ok(output.endsWith('[registry-routing-mismatch]'));
  });

  it('matches GCC diagnostic pattern: file:line:col: severity: message [rule]', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'Annotation expired',
          file: 'src/app.ts',
          line: 7,
        },
      ],
    });
    const output = formatAsDiagnostic(result);
    // GCC pattern: file:line:col: severity: message
    const gccPattern = /^[^:]+:\d+:\d+: (?:error|warning): .+ \[[a-z-]+\]$/;
    assert.match(output, gccPattern);
  });
});
