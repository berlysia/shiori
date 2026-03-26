import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ReportResult,
  VerifyIssueType,
  DeltaResult,
  ShioriAnnotation,
} from '../../src/core/types.ts';
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
    'ref-status-closed': 0,
    'intentional-without-reason': 0,
    'temporary-without-expires': 0,
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

  describe('governance diff overlay', () => {
    function makeDelta(overrides: Partial<DeltaResult> = {}): DeltaResult {
      return {
        deltas: [],
        summary: { added: 0, removed: 0, unchanged: 0, net: 0 },
        ...overrides,
      };
    }

    function makeAnnotation(ref: string, file: string, line: number) {
      return {
        ref,
        tagged: true,
        ignored: false,
        location: { file, line },
      };
    }

    it('omits delta section when no delta option is provided', () => {
      const html = formatReportAsHtml(makeReportResult());

      assert.equal(
        html.match(/<h2>Changes<\/h2>/g),
        null,
        'no changes section without delta',
      );
    });

    it('renders delta summary badges', () => {
      const delta = makeDelta({
        summary: { added: 3, removed: 1, unchanged: 5, net: 2 },
        deltas: [
          {
            kind: 'added',
            ref: 'SUP-100',
            head: makeAnnotation('SUP-100', 'src/a.ts', 10),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      assert.ok(html.includes('Changes'), 'has Changes heading');
      assert.ok(html.includes('+3 added'), 'shows added count');
      assert.ok(html.includes('1 removed'), 'shows removed count');
      assert.ok(html.includes('5 unchanged'), 'shows unchanged count');
      assert.ok(html.includes('net +2'), 'shows net positive');
    });

    it('renders delta summary with negative net', () => {
      const delta = makeDelta({
        summary: { added: 1, removed: 4, unchanged: 2, net: -3 },
        deltas: [
          {
            kind: 'removed',
            ref: 'SUP-200',
            base: makeAnnotation('SUP-200', 'src/b.ts', 20),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      assert.ok(html.includes('net -3'), 'shows net negative');
    });

    it('renders change table with added and removed entries', () => {
      const delta = makeDelta({
        summary: { added: 1, removed: 1, unchanged: 1, net: 0 },
        deltas: [
          {
            kind: 'added',
            ref: 'SUP-NEW',
            head: makeAnnotation('SUP-NEW', 'src/new.ts', 5),
          },
          {
            kind: 'removed',
            ref: 'SUP-OLD',
            base: makeAnnotation('SUP-OLD', 'src/old.ts', 15),
          },
          {
            kind: 'unchanged',
            ref: 'SUP-SAME',
            head: makeAnnotation('SUP-SAME', 'src/same.ts', 25),
            base: makeAnnotation('SUP-SAME', 'src/same.ts', 25),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      // Change table should exist (in body, not just CSS)
      assert.ok(
        html.includes('<table class="delta-table">'),
        'has delta table element',
      );
      // Added and removed entries are shown
      assert.ok(html.includes('SUP-NEW'), 'shows added ref');
      assert.ok(html.includes('src/new.ts:5'), 'shows added location');
      assert.ok(html.includes('SUP-OLD'), 'shows removed ref');
      assert.ok(html.includes('src/old.ts:15'), 'shows removed location');
      // Unchanged entries are NOT shown in the table (filtered out)
      assert.ok(!html.includes('SUP-SAME'), 'unchanged not in table');
    });

    it('shows "no changes" message when all deltas are unchanged', () => {
      const delta = makeDelta({
        summary: { added: 0, removed: 0, unchanged: 3, net: 0 },
        deltas: [
          {
            kind: 'unchanged',
            ref: 'SUP-1',
            head: makeAnnotation('SUP-1', 'a.ts', 1),
            base: makeAnnotation('SUP-1', 'a.ts', 1),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      assert.ok(
        html.includes('No changes since last scan'),
        'shows no changes message',
      );
      // No table element in the changes section (CSS class exists in <style> but no <table>)
      assert.ok(
        !html.includes('<table class="delta-table">'),
        'no delta table element when no changes',
      );
    });

    it('includes delta CSS styles', () => {
      const delta = makeDelta({
        summary: { added: 1, removed: 0, unchanged: 0, net: 1 },
        deltas: [
          {
            kind: 'added',
            ref: 'X-1',
            head: makeAnnotation('X-1', 'x.ts', 1),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      assert.ok(html.includes('.delta-summary'), 'has delta-summary style');
      assert.ok(html.includes('.delta-badge'), 'has delta-badge style');
      assert.ok(html.includes('.delta-kind'), 'has delta-kind style');
    });

    it('escapes HTML in delta ref and location', () => {
      const delta = makeDelta({
        summary: { added: 1, removed: 0, unchanged: 0, net: 1 },
        deltas: [
          {
            kind: 'added',
            ref: '<script>',
            head: makeAnnotation('<script>', 'src/<evil>.ts', 1),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      assert.ok(html.includes('&lt;script&gt;'), 'escapes ref in delta table');
      assert.ok(
        html.includes('&lt;evil&gt;'),
        'escapes file path in delta table',
      );
    });

    it('renders delta between health section and overview', () => {
      const delta = makeDelta({
        summary: { added: 1, removed: 0, unchanged: 0, net: 1 },
        deltas: [
          {
            kind: 'added',
            ref: 'POS-1',
            head: makeAnnotation('POS-1', 'a.ts', 1),
          },
        ],
      });
      const html = formatReportAsHtml(makeReportResult(), { delta });

      const healthIdx = html.indexOf('health-card');
      const changesIdx = html.indexOf('Changes');
      const overviewIdx = html.indexOf('Overview');

      assert.ok(healthIdx < changesIdx, 'delta after health section');
      assert.ok(changesIdx < overviewIdx, 'delta before overview section');
    });
  });

  describe('provenance section', () => {
    function makeAnnotationWithProvenance(
      ref: string,
      file: string,
      line: number,
    ): ShioriAnnotation {
      return {
        ref,
        tagged: true,
        ignored: false,
        location: { file, line },
        provenance: {
          author: 'Jane Doe',
          authorEmail: 'jane@example.com',
          date: '2024-03-08T00:00:00.000Z',
          commitHash: 'abcdef1',
          commitSummary: 'fix: resolve issue',
        },
      };
    }

    it('omits provenance section when annotations option is not provided', () => {
      const html = formatReportAsHtml(makeReportResult());

      assert.equal(
        html.match(/<h2>Provenance<\/h2>/g),
        null,
        'no provenance section without annotations option',
      );
    });

    it('omits provenance section when no annotations have provenance', () => {
      const annotations: ShioriAnnotation[] = [
        {
          ref: 'SUP-1',
          tagged: true,
          ignored: false,
          location: { file: 'a.ts', line: 1 },
        },
      ];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.equal(
        html.match(/<h2>Provenance<\/h2>/g),
        null,
        'no provenance section when no provenance data',
      );
    });

    it('renders provenance table with enriched annotations', () => {
      const annotations = [
        makeAnnotationWithProvenance('SUP-1234', 'src/parser.ts', 10),
        makeAnnotationWithProvenance('ADR:0007', 'src/types.ts', 5),
      ];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.ok(html.includes('Provenance'), 'has Provenance heading');
      assert.ok(
        html.includes('provenance-table'),
        'has provenance table class',
      );
      assert.ok(html.includes('SUP-1234'), 'shows ref');
      assert.ok(html.includes('src/parser.ts:10'), 'shows location');
      assert.ok(html.includes('abcdef1'), 'shows commit hash');
      assert.ok(html.includes('Jane Doe'), 'shows author');
      assert.ok(html.includes('2024-03-08'), 'shows date');
      assert.ok(html.includes('fix: resolve issue'), 'shows summary');
    });

    it('renders draft annotation ref as (draft)', () => {
      const annotations: ShioriAnnotation[] = [
        {
          ref: '',
          tagged: true,
          ignored: false,
          location: { file: 'src/a.ts', line: 1 },
          provenance: {
            author: 'John',
            authorEmail: 'john@example.com',
            date: '2024-01-01T00:00:00.000Z',
            commitHash: '1234567',
            commitSummary: 'add draft',
          },
        },
      ];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.ok(html.includes('(draft)'), 'shows (draft) for empty ref');
    });

    it('escapes HTML in provenance data', () => {
      const annotations: ShioriAnnotation[] = [
        {
          ref: '<script>',
          tagged: true,
          ignored: false,
          location: { file: 'src/<evil>.ts', line: 1 },
          provenance: {
            author: '<b>Evil</b>',
            authorEmail: 'evil@example.com',
            date: '2024-01-01T00:00:00.000Z',
            commitHash: 'abc1234',
            commitSummary: 'fix: <script>alert(1)</script>',
          },
        },
      ];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.ok(html.includes('&lt;script&gt;'), 'escapes ref in provenance');
      assert.ok(
        html.includes('&lt;evil&gt;'),
        'escapes file path in provenance',
      );
      assert.ok(
        html.includes('&lt;b&gt;Evil&lt;/b&gt;'),
        'escapes author in provenance',
      );
    });

    it('includes provenance CSS styles', () => {
      const annotations = [makeAnnotationWithProvenance('SUP-1', 'a.ts', 1)];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.ok(
        html.includes('.provenance-table'),
        'has provenance-table style',
      );
      assert.ok(html.includes('.provenance-hash'), 'has provenance-hash style');
    });

    it('renders provenance after breakdown sections', () => {
      const annotations = [makeAnnotationWithProvenance('SUP-1', 'a.ts', 1)];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      const ownershipIdx = html.indexOf('Ownership');
      const provenanceIdx = html.indexOf('Provenance');

      assert.ok(
        ownershipIdx < provenanceIdx,
        'provenance after ownership section',
      );
    });

    it('only shows annotations that have provenance', () => {
      const annotations: ShioriAnnotation[] = [
        makeAnnotationWithProvenance('HAS-PROV', 'a.ts', 1),
        {
          ref: 'NO-PROV',
          tagged: true,
          ignored: false,
          location: { file: 'b.ts', line: 2 },
        },
      ];
      const html = formatReportAsHtml(makeReportResult(), { annotations });

      assert.ok(html.includes('HAS-PROV'), 'shows annotation with provenance');
      assert.ok(
        !html.includes('NO-PROV'),
        'does not show annotation without provenance',
      );
    });
  });

  describe('heatmap section (EP-0086)', () => {
    it('renders heatmap section when byFile is present', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'src/core/types.ts',
            annotationCount: 5,
            expiredCount: 2,
            expiringCount: 1,
            healthyCount: 2,
          },
          {
            path: 'src/commands/report.ts',
            annotationCount: 3,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 3,
          },
        ],
        byDirectory: [
          {
            directory: 'src/core',
            annotationCount: 5,
            fileCount: 1,
            expiredCount: 2,
            expiringCount: 1,
            healthyCount: 2,
          },
          {
            directory: 'src/commands',
            annotationCount: 3,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 3,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('Annotation Heatmap'), 'has heatmap heading');
      assert.ok(html.includes('heatmap-grid'), 'has heatmap grid');
      assert.ok(html.includes('src/core/types.ts'), 'shows file path');
      assert.ok(
        html.includes('src/commands/report.ts'),
        'shows second file path',
      );
    });

    it('omits heatmap section when byFile is not present', () => {
      const result = makeReportResult();
      // Default makeReportResult does not include byFile/byDirectory
      const html = formatReportAsHtml(result);

      assert.equal(
        html.match(/<h2>Annotation Heatmap<\/h2>/g),
        null,
        'no heatmap section without byFile',
      );
    });

    it('renders correct status class for expired files', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'expired.ts',
            annotationCount: 3,
            expiredCount: 2,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
        byDirectory: [
          {
            directory: '.',
            annotationCount: 3,
            fileCount: 1,
            expiredCount: 2,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('status-expired'), 'has expired status class');
    });

    it('renders correct status class for expiring files', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'expiring.ts',
            annotationCount: 2,
            expiredCount: 0,
            expiringCount: 1,
            healthyCount: 1,
          },
        ],
        byDirectory: [
          {
            directory: '.',
            annotationCount: 2,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 1,
            healthyCount: 1,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('status-expiring'), 'has expiring status class');
    });

    it('renders correct status class for healthy files', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'healthy.ts',
            annotationCount: 4,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 4,
          },
        ],
        byDirectory: [
          {
            directory: '.',
            annotationCount: 4,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 4,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('status-healthy'), 'has healthy status class');
    });

    it('renders directory summary table', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'src/core/a.ts',
            annotationCount: 2,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 2,
          },
        ],
        byDirectory: [
          {
            directory: 'src/core',
            annotationCount: 2,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 2,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('heatmap-dir-table'), 'has directory table');
      assert.ok(html.includes('src/core'), 'shows directory name');
    });

    it('renders heatmap between overview and insights', () => {
      const result = makeReportResult({
        insights: [{ level: 'info', label: 'clean', message: 'All good' }],
        byFile: [
          {
            path: 'a.ts',
            annotationCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
        byDirectory: [
          {
            directory: '.',
            annotationCount: 1,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      const overviewIdx = html.indexOf('Overview');
      const heatmapIdx = html.indexOf('Annotation Heatmap');
      const insightsIdx = html.indexOf('Insights');

      assert.ok(overviewIdx < heatmapIdx, 'heatmap after overview');
      assert.ok(heatmapIdx < insightsIdx, 'heatmap before insights');
    });

    it('includes heatmap CSS styles', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'a.ts',
            annotationCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
        byDirectory: [],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('.heatmap-grid'), 'has heatmap-grid style');
      assert.ok(html.includes('.heatmap-card'), 'has heatmap-card style');
      assert.ok(html.includes('.heatmap-bar'), 'has heatmap-bar style');
    });

    it('escapes HTML in file paths', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'src/<script>.ts',
            annotationCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
        byDirectory: [
          {
            directory: 'src',
            annotationCount: 1,
            fileCount: 1,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 1,
          },
        ],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('&lt;script&gt;'), 'escapes HTML in file paths');
    });

    it('shows status line only for expired or expiring files', () => {
      const result = makeReportResult({
        byFile: [
          {
            path: 'expired.ts',
            annotationCount: 2,
            expiredCount: 1,
            expiringCount: 1,
            healthyCount: 0,
          },
          {
            path: 'healthy.ts',
            annotationCount: 3,
            expiredCount: 0,
            expiringCount: 0,
            healthyCount: 3,
          },
        ],
        byDirectory: [],
      });
      const html = formatReportAsHtml(result);

      assert.ok(html.includes('1 expired'), 'shows expired count');
      assert.ok(html.includes('1 expiring'), 'shows expiring count');
    });
  });
});
