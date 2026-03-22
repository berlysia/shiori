import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VerifyResult, ReportResult } from '../../src/core/types.ts';
import {
  formatVerifyAsGitHubSummary,
  formatReportAsGitHubSummary,
} from '../../src/formatters/github-summary-formatter.ts';

function makeVerifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    timestamp: '2026-03-23T00:00:00.000Z',
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

function makeReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    timestamp: '2026-03-23T00:00:00.000Z',
    health: { level: 'healthy', score: 100, summary: 'All clear' },
    totals: {
      annotations: 5,
      candidates: 2,
      registryEntries: 5,
      issues: 0,
      errors: 0,
      warnings: 0,
    },
    insights: [],
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
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: makeVerifyResult(),
    ...overrides,
  };
}

describe('formatVerifyAsGitHubSummary', () => {
  it('shows success emoji for zero errors', () => {
    const result = makeVerifyResult();
    const output = formatVerifyAsGitHubSummary(result);
    assert.match(output, /^### ✅/);
    assert.match(output, /0 error\(s\)/);
  });

  it('shows failure emoji when errors exist', () => {
    const result = makeVerifyResult({
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
      summary: {
        total: 1,
        errors: 1,
        warnings: 0,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 1,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 0,
          'ref-status-closed': 0,
        },
      },
    });
    const output = formatVerifyAsGitHubSummary(result);
    assert.match(output, /^### ❌/);
    assert.match(output, /1 error\(s\)/);
  });

  it('renders collapsible error details', () => {
    const result = makeVerifyResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'Annotation expired',
          file: 'src/foo.ts',
          line: 42,
        },
      ],
      summary: {
        total: 1,
        errors: 1,
        warnings: 0,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 1,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 0,
          'ref-status-closed': 0,
        },
      },
    });
    const output = formatVerifyAsGitHubSummary(result);
    assert.ok(output.includes('<details><summary>❌ Errors (1)</summary>'));
    assert.ok(output.includes('</details>'));
    assert.ok(output.includes('SUP-001'));
    assert.ok(output.includes('`src/foo.ts:42`'));
  });

  it('renders collapsible warning details', () => {
    const result = makeVerifyResult({
      issues: [
        {
          type: 'expiring-soon',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'Expiring soon',
          file: 'src/bar.ts',
          line: 10,
        },
      ],
      summary: {
        total: 1,
        errors: 0,
        warnings: 1,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 0,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 1,
          'ref-status-closed': 0,
        },
      },
    });
    const output = formatVerifyAsGitHubSummary(result);
    assert.ok(output.includes('<details><summary>⚠️ Warnings (1)</summary>'));
  });

  it('shows celebration message when no issues', () => {
    const result = makeVerifyResult();
    const output = formatVerifyAsGitHubSummary(result);
    assert.ok(output.includes('No issues found. 🎉'));
  });

  it('handles issues without file location', () => {
    const result = makeVerifyResult({
      issues: [
        {
          type: 'unused-in-source',
          severity: 'warning',
          ref: 'SUP-003',
          message: 'Registry entry not found in source',
          file: undefined,
          line: undefined,
        },
      ],
      summary: {
        total: 1,
        errors: 0,
        warnings: 1,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 1,
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
    });
    const output = formatVerifyAsGitHubSummary(result);
    // Location column should show '-' for issues without file
    assert.ok(output.includes('| SUP-003 | `unused-in-source` | - |'));
  });

  it('renders non-zero issue type breakdown table', () => {
    const result = makeVerifyResult({
      summary: {
        total: 2,
        errors: 1,
        warnings: 1,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 1,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 1,
          'ref-status-closed': 0,
        },
      },
    });
    const output = formatVerifyAsGitHubSummary(result);
    assert.ok(output.includes('| `expired` | 1 |'));
    assert.ok(output.includes('| `expiring-soon` | 1 |'));
    // Zero-count types should NOT appear
    assert.ok(!output.includes('`missing-in-registry`'));
  });
});

describe('formatReportAsGitHubSummary', () => {
  it('shows health score and level', () => {
    const result = makeReportResult();
    const output = formatReportAsGitHubSummary(result);
    assert.match(output, /### 🟢 Shiori Governance: 100\/100 \(healthy\)/);
  });

  it('shows warning health emoji', () => {
    const result = makeReportResult({
      health: { level: 'warning', score: 55, summary: 'Needs attention' },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.match(output, /### 🟡/);
  });

  it('shows critical health emoji', () => {
    const result = makeReportResult({
      health: { level: 'critical', score: 20, summary: 'Critical issues' },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.match(output, /### 🔴/);
  });

  it('renders overview metrics table', () => {
    const result = makeReportResult();
    const output = formatReportAsGitHubSummary(result);
    assert.ok(output.includes('| Tracked annotations | 5 |'));
    assert.ok(output.includes('| Untracked candidates | 2 |'));
    assert.ok(output.includes('| Registry entries | 5 |'));
  });

  it('renders insights when present', () => {
    const result = makeReportResult({
      insights: [
        {
          level: 'warning',
          label: 'Expired',
          message: '2 annotations expired',
        },
        { level: 'info', label: 'Coverage', message: '80% tracked' },
      ],
    });
    const output = formatReportAsGitHubSummary(result);
    assert.ok(output.includes('#### Insights'));
    assert.ok(output.includes('⚠️ **Expired**: 2 annotations expired'));
    assert.ok(output.includes('ℹ️ **Coverage**: 80% tracked'));
  });

  it('does not render insights section when empty', () => {
    const result = makeReportResult();
    const output = formatReportAsGitHubSummary(result);
    assert.ok(!output.includes('#### Insights'));
  });

  it('renders collapsible issue breakdown', () => {
    const result = makeReportResult({
      byType: {
        'missing-in-registry': 3,
        'unused-in-source': 0,
        expired: 1,
        'syntax-error': 0,
        'ref-format': 0,
        'ref-collision': 0,
        'unrouted-ref': 0,
        'registry-routing-mismatch': 0,
        'expiring-soon': 0,
        'ref-status-closed': 0,
      },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.ok(output.includes('<details><summary>Issues by Type</summary>'));
    assert.ok(output.includes('| `missing-in-registry` | 3 |'));
    assert.ok(output.includes('| `expired` | 1 |'));
  });

  it('renders collapsible rule breakdown', () => {
    const result = makeReportResult({
      byRule: [
        { key: 'no-console', count: 5 },
        { key: '@typescript-eslint/no-explicit-any', count: 3 },
      ],
    });
    const output = formatReportAsGitHubSummary(result);
    assert.ok(
      output.includes('<details><summary>Annotations by Rule</summary>'),
    );
    assert.ok(output.includes('| `no-console` | 5 |'));
  });

  it('health summary appears as blockquote', () => {
    const result = makeReportResult({
      health: { level: 'healthy', score: 95, summary: 'Looking good' },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.ok(output.includes('> Looking good'));
  });
});
