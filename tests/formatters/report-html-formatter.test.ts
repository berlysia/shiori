import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportResult, VerifyIssueType } from '../../src/core/types.ts';
import { formatReportAsHtml } from '../../src/formatters/report-html-formatter.ts';

function makeByType(
  overrides: Partial<Record<VerifyIssueType, number>> = {},
): Record<VerifyIssueType, number> {
  return {
    'missing-in-registry': 0,
    'unused-in-source': 0,
    expired: 0,
    'syntax-error': 0,
    'ref-format': 0,
    'ref-collision': 0,
    'unrouted-ref': 0,
    'registry-routing-mismatch': 0,
    'expiring-soon': 0,
    ...overrides,
  };
}

function makeReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    timestamp: '2026-03-07T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 85,
      summary: 'Governance is in good shape',
    },
    totals: {
      annotations: 10,
      candidates: 3,
      registryEntries: 8,
      issues: 2,
      errors: 1,
      warnings: 1,
    },
    insights: [],
    byType: makeByType({ expired: 1, 'expiring-soon': 1 }),
    byRule: [
      { key: 'no-console', count: 5 },
      { key: 'no-debugger', count: 3 },
    ],
    byKind: [{ key: 'suppression', count: 6 }],
    byOwner: [
      { key: 'team-a', count: 4 },
      { key: 'team-b', count: 2 },
    ],
    verifyResult: {
      timestamp: '2026-03-07T00:00:00.000Z',
      issues: [],
      summary: {
        total: 2,
        errors: 1,
        warnings: 1,
        byType: makeByType({ expired: 1, 'expiring-soon': 1 }),
      },
      scannedRecords: 10,
      registryEntries: 8,
    },
    ...overrides,
  };
}

describe('formatReportAsHtml', () => {
  it('produces valid HTML document structure', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.startsWith('<!DOCTYPE html>'), 'starts with DOCTYPE');
    assert.ok(html.includes('<html lang="en">'), 'has html tag with lang');
    assert.ok(html.includes('<head>'), 'has head');
    assert.ok(html.includes('</head>'), 'closes head');
    assert.ok(html.includes('<body>'), 'has body');
    assert.ok(html.includes('</body>'), 'closes body');
    assert.ok(html.includes('</html>'), 'closes html');
  });

  it('includes title and meta charset', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(
      html.includes('<title>Shiori Governance Report</title>'),
      'has title',
    );
    assert.ok(html.includes('charset="UTF-8"'), 'has charset');
    assert.ok(html.includes('viewport'), 'has viewport meta');
  });

  it('includes inline styles (self-contained)', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('<style>'), 'has inline style');
    assert.ok(html.includes('</style>'), 'closes style');
    // No external stylesheet links
    assert.ok(
      !html.includes('<link rel="stylesheet"'),
      'no external stylesheet',
    );
  });

  it('renders health section with correct score', () => {
    const html = formatReportAsHtml(
      makeReportResult({
        health: { level: 'healthy', score: 92, summary: 'All good' },
      }),
    );

    assert.ok(html.includes('92/100'), 'shows score');
    assert.ok(html.includes('All good'), 'shows summary');
    assert.ok(html.includes('healthy'), 'shows level');
  });

  it('uses correct health color for warning level', () => {
    const html = formatReportAsHtml(
      makeReportResult({
        health: { level: 'warning', score: 55, summary: 'Some issues' },
      }),
    );

    assert.ok(html.includes('#eab308'), 'uses yellow for warning');
    assert.ok(html.includes('55/100'), 'shows warning score');
  });

  it('uses correct health color for critical level', () => {
    const html = formatReportAsHtml(
      makeReportResult({
        health: { level: 'critical', score: 20, summary: 'Bad state' },
      }),
    );

    assert.ok(html.includes('#ef4444'), 'uses red for critical');
    assert.ok(html.includes('20/100'), 'shows critical score');
  });

  it('renders overview table with all metrics', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('Overview'), 'has overview heading');
    assert.ok(html.includes('Tracked annotations'), 'has annotations row');
    assert.ok(html.includes('Untracked candidates'), 'has candidates row');
    assert.ok(html.includes('Registry entries'), 'has registry row');
    assert.ok(html.includes('Issues (errors)'), 'has errors row');
    assert.ok(html.includes('Issues (warnings)'), 'has warnings row');
  });

  it('renders overview table with correct counts', () => {
    const result = makeReportResult({
      totals: {
        annotations: 42,
        candidates: 7,
        registryEntries: 35,
        issues: 5,
        errors: 3,
        warnings: 2,
      },
    });
    const html = formatReportAsHtml(result);

    // Counts appear in table cells
    assert.ok(html.includes('>42<'), 'annotations count');
    assert.ok(html.includes('>7<'), 'candidates count');
    assert.ok(html.includes('>35<'), 'registry entries count');
    assert.ok(html.includes('>3<'), 'errors count');
    assert.ok(html.includes('>2<'), 'warnings count');
  });

  it('renders insights when present', () => {
    const result = makeReportResult({
      insights: [
        {
          level: 'error',
          label: 'Expired items',
          message: '3 annotations have expired',
        },
        {
          level: 'warning',
          label: 'Missing owners',
          message: '2 entries lack ownership',
        },
        {
          level: 'info',
          label: 'Good coverage',
          message: '90% of annotations tracked',
        },
      ],
    });
    const html = formatReportAsHtml(result);

    assert.ok(html.includes('Insights'), 'has insights heading');
    assert.ok(html.includes('Expired items'), 'has error insight');
    assert.ok(html.includes('3 annotations have expired'), 'has error message');
    assert.ok(html.includes('Missing owners'), 'has warning insight');
    assert.ok(html.includes('Good coverage'), 'has info insight');
  });

  it('omits insights section when empty', () => {
    const result = makeReportResult({ insights: [] });
    const html = formatReportAsHtml(result);

    // The insights heading should not be present
    const insightsMatch = html.match(/<h2>Insights<\/h2>/g);
    assert.equal(insightsMatch, null, 'no insights section when empty');
  });

  it('renders issue breakdown table', () => {
    const result = makeReportResult({
      byType: makeByType({ expired: 3, 'missing-in-registry': 2 }),
    });
    const html = formatReportAsHtml(result);

    assert.ok(html.includes('Issues by Type'), 'has issues heading');
    assert.ok(html.includes('expired'), 'shows expired type');
    assert.ok(html.includes('missing-in-registry'), 'shows missing type');
  });

  it('omits issue breakdown when all counts are zero', () => {
    const result = makeReportResult({ byType: makeByType() });
    const html = formatReportAsHtml(result);

    const match = html.match(/<h2>Issues by Type<\/h2>/g);
    assert.equal(match, null, 'no issue breakdown when all zero');
  });

  it('renders breakdown tables (byRule, byOwner, byKind)', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('Annotations by Rule'), 'has byRule section');
    assert.ok(html.includes('no-console'), 'shows rule name');
    assert.ok(html.includes('Ownership'), 'has byOwner section');
    assert.ok(html.includes('team-a'), 'shows owner name');
    assert.ok(html.includes('Annotation Kinds'), 'has byKind section');
    assert.ok(html.includes('suppression'), 'shows kind name');
  });

  it('omits breakdown sections when entries are empty', () => {
    const result = makeReportResult({
      byRule: [],
      byOwner: [],
      byKind: [],
    });
    const html = formatReportAsHtml(result);

    assert.equal(
      html.match(/<h2>Annotations by Rule<\/h2>/g),
      null,
      'no byRule when empty',
    );
    assert.equal(
      html.match(/<h2>Ownership<\/h2>/g),
      null,
      'no byOwner when empty',
    );
    assert.equal(
      html.match(/<h2>Annotation Kinds<\/h2>/g),
      null,
      'no byKind when empty',
    );
  });

  it('includes interactive script', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('<script>'), 'has script tag');
    assert.ok(html.includes('</script>'), 'closes script tag');
    assert.ok(html.includes('addEventListener'), 'has event listener');
  });

  it('includes footer', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('<footer>'), 'has footer');
    assert.ok(html.includes('shiori'), 'footer mentions shiori');
  });

  it('renders timestamp in the meta section', () => {
    const html = formatReportAsHtml(makeReportResult());

    assert.ok(html.includes('2026-03-07T00:00:00.000Z'), 'shows timestamp');
  });

  describe('auto-refresh (dashboard mode)', () => {
    it('includes meta refresh tag when autoRefreshSeconds is set', () => {
      const html = formatReportAsHtml(makeReportResult(), {
        autoRefreshSeconds: 3,
      });

      assert.ok(
        html.includes('<meta http-equiv="refresh" content="3">'),
        'has meta refresh with interval',
      );
    });

    it('uses Dashboard title when auto-refresh is enabled', () => {
      const html = formatReportAsHtml(makeReportResult(), {
        autoRefreshSeconds: 5,
      });

      assert.ok(
        html.includes('<title>Shiori Governance Dashboard</title>'),
        'title is Dashboard in live mode',
      );
      assert.ok(
        html.includes('<h1>Shiori Governance Dashboard</h1>'),
        'heading is Dashboard in live mode',
      );
    });

    it('uses Report title when auto-refresh is not set', () => {
      const html = formatReportAsHtml(makeReportResult());

      assert.ok(
        html.includes('<title>Shiori Governance Report</title>'),
        'title is Report when no auto-refresh',
      );
    });

    it('shows live indicator when auto-refresh is enabled', () => {
      const html = formatReportAsHtml(makeReportResult(), {
        autoRefreshSeconds: 3,
      });

      assert.ok(html.includes('Live'), 'shows live indicator');
      assert.ok(
        html.includes('auto-refreshing every 3s'),
        'shows refresh interval',
      );
    });

    it('does not include meta refresh when autoRefreshSeconds is 0', () => {
      const html = formatReportAsHtml(makeReportResult(), {
        autoRefreshSeconds: 0,
      });

      assert.ok(
        !html.includes('http-equiv="refresh"'),
        'no meta refresh when 0',
      );
    });

    it('does not include meta refresh when options is undefined', () => {
      const html = formatReportAsHtml(makeReportResult());

      assert.ok(
        !html.includes('http-equiv="refresh"'),
        'no meta refresh without options',
      );
    });
  });

  it('escapes HTML special characters in user data', () => {
    const result = makeReportResult({
      health: {
        level: 'warning',
        score: 50,
        summary: 'Contains <script>alert("xss")</script> & "quotes"',
      },
      insights: [
        {
          level: 'info',
          label: 'Test <b>bold</b>',
          message: 'A & B > C',
        },
      ],
      byRule: [{ key: '<rule>', count: 1 }],
    });
    const html = formatReportAsHtml(result);

    assert.ok(
      html.includes('&lt;script&gt;'),
      'escapes script tags in summary',
    );
    assert.ok(html.includes('&amp;'), 'escapes ampersands');
    assert.ok(html.includes('&quot;'), 'escapes quotes');
    assert.ok(html.includes('&lt;b&gt;'), 'escapes tags in insight labels');
    assert.ok(html.includes('&lt;rule&gt;'), 'escapes tags in rule names');
  });
});
