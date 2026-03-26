import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  VerifyResult,
  ReportResult,
  HealthResult,
} from '../../src/core/types.ts';
import {
  formatVerifyAsGitHubSummary,
  formatReportAsGitHubSummary,
  formatHealthAsGitHubSummary,
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
        'intentional-without-reason': 0,
        'temporary-without-expires': 0,
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
    health: {
      level: 'healthy',
      score: 100,
      coverage: 100,
      hygiene: 100,
      summary: 'All clear',
    },
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
      'intentional-without-reason': 0,
      'temporary-without-expires': 0,
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
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
      health: {
        level: 'warning',
        score: 55,
        coverage: 100,
        hygiene: 55,
        summary: 'Needs attention',
      },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.match(output, /### 🟡/);
  });

  it('shows critical health emoji', () => {
    const result = makeReportResult({
      health: {
        level: 'critical',
        score: 20,
        coverage: 100,
        hygiene: 20,
        summary: 'Critical issues',
      },
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
        'intentional-without-reason': 0,
        'temporary-without-expires': 0,
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
      health: {
        level: 'healthy',
        score: 95,
        coverage: 100,
        hygiene: 95,
        summary: 'Looking good',
      },
    });
    const output = formatReportAsGitHubSummary(result);
    assert.ok(output.includes('> Looking good'));
  });
});

function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-03-23T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 100,
      coverage: 100,
      hygiene: 100,
      summary: 'All clear',
    },
    issues: { total: 0, errors: 0, warnings: 0 },
    expiring: { expired: 0, expiringSoon: 0 },
    insights: [],
    ...overrides,
  };
}

describe('formatHealthAsGitHubSummary', () => {
  it('shows health score header with emoji', () => {
    const result = makeHealthResult();
    const output = formatHealthAsGitHubSummary(result);
    assert.match(output, /### 🟢 Shiori Health: 100\/100 \(healthy\)/);
  });

  it('shows warning emoji for warning level', () => {
    const result = makeHealthResult({
      health: {
        level: 'warning',
        score: 55,
        coverage: 100,
        hygiene: 55,
        summary: 'Needs attention',
      },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.match(output, /### 🟡/);
  });

  it('shows critical emoji for critical level', () => {
    const result = makeHealthResult({
      health: {
        level: 'critical',
        score: 20,
        coverage: 100,
        hygiene: 20,
        summary: 'Critical issues',
      },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.match(output, /### 🔴/);
  });

  it('renders health summary as blockquote', () => {
    const result = makeHealthResult({
      health: {
        level: 'healthy',
        score: 90,
        coverage: 100,
        hygiene: 90,
        summary: 'Looking good',
      },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('> Looking good'));
  });

  it('renders issue counts table', () => {
    const result = makeHealthResult({
      issues: { total: 5, errors: 3, warnings: 2 },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('| Issues | 5 |'));
    assert.ok(output.includes('| Errors | 3 |'));
    assert.ok(output.includes('| Warnings | 2 |'));
  });

  it('shows expiration rows when expired or expiring-soon exist', () => {
    const result = makeHealthResult({
      expiring: { expired: 2, expiringSoon: 3 },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('| Expired | 2 |'));
    assert.ok(output.includes('| Expiring soon | 3 |'));
  });

  it('omits expiration rows when all zero', () => {
    const result = makeHealthResult({
      expiring: { expired: 0, expiringSoon: 0 },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(!output.includes('Expired'));
    assert.ok(!output.includes('Expiring soon'));
  });

  it('renders trend when present', () => {
    const result = makeHealthResult({
      trend: {
        count: 5,
        oldest: '2026-03-01T00:00:00.000Z',
        newest: '2026-03-23T00:00:00.000Z',
        direction: 'improving',
        scoreChange: 10,
        latestScore: 85,
        minScore: 70,
        maxScore: 85,
      },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('**Trend:**'));
    assert.ok(output.includes('improving'));
    assert.ok(output.includes('+10'));
    assert.ok(output.includes('5 snapshot(s)'));
  });

  it('omits trend when not present', () => {
    const result = makeHealthResult();
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(!output.includes('**Trend:**'));
  });

  it('renders insights when present', () => {
    const result = makeHealthResult({
      insights: [
        {
          level: 'warning',
          label: 'Expired',
          message: '2 annotations expired',
        },
        { level: 'info', label: 'Coverage', message: '80% tracked' },
      ],
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('#### Insights'));
    assert.ok(output.includes('⚠️ **Expired**: 2 annotations expired'));
    assert.ok(output.includes('ℹ️ **Coverage**: 80% tracked'));
  });

  it('omits insights section when empty', () => {
    const result = makeHealthResult();
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(!output.includes('#### Insights'));
  });

  it('renders collapsible prescriptions when present', () => {
    const result = makeHealthResult({
      prescriptions: [
        {
          urgency: 'critical',
          message: 'Run update to register missing refs',
          command: 'shiori update',
          scoreImpact: 15,
          actionType: 'update',
          axis: 'hygiene' as const,
        },
        {
          urgency: 'recommended',
          message: 'Run triage for prioritized actions',
          command: 'shiori triage',
          scoreImpact: 5,
          actionType: 'triage',
          axis: 'hygiene' as const,
        },
      ],
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(
      output.includes('<details><summary>💊 Prescriptions (2)</summary>'),
    );
    assert.ok(output.includes('🔴 critical'));
    assert.ok(output.includes('+15pt'));
    assert.ok(output.includes('`shiori update`'));
    assert.ok(output.includes('🟡 recommended'));
    assert.ok(output.includes('</details>'));
  });

  it('omits prescriptions section when empty', () => {
    const result = makeHealthResult();
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(!output.includes('Prescriptions'));
  });

  it('shows declining trend with negative score change', () => {
    const result = makeHealthResult({
      trend: {
        count: 3,
        oldest: '2026-03-10T00:00:00.000Z',
        newest: '2026-03-23T00:00:00.000Z',
        direction: 'declining',
        scoreChange: -8,
        latestScore: 72,
        minScore: 72,
        maxScore: 80,
      },
    });
    const output = formatHealthAsGitHubSummary(result);
    assert.ok(output.includes('declining'));
    assert.ok(output.includes('-8'));
  });
});
