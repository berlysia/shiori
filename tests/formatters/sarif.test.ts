import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_ISSUE_TYPES } from '../../src/core/types.ts';
import type { VerifyResult } from '../../src/core/types.ts';
import { formatAsSarif } from '../../src/formatters/sarif.ts';

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
      },
    },
    scannedRecords: 0,
    registryEntries: 0,
    ...overrides,
  };
}

describe('formatAsSarif', () => {
  it('produces valid SARIF structure', () => {
    const result = makeResult();
    const sarif = JSON.parse(formatAsSarif(result)) as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version: string } };
        results: unknown[];
      }>;
    };
    assert.equal(sarif.version, '2.1.0');
    assert.ok(sarif.$schema.includes('sarif-schema-2.1.0'));
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0]!.tool.driver.name, 'shiori');
    assert.equal(sarif.runs[0]!.tool.driver.version, '0.1.0');
  });

  it('returns empty results for empty issues', () => {
    const result = makeResult();
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{ results: unknown[] }>;
    };
    assert.equal(sarif.runs[0]!.results.length, 0);
  });

  it('includes locations for issues with file and line', () => {
    const result = makeResult({
      issues: [
        {
          type: 'missing-in-registry',
          severity: 'error',
          ref: 'SUP-001',
          message: 'not in registry',
          file: 'src/foo.ts',
          line: 42,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        results: Array<{
          locations: Array<{
            physicalLocation: {
              artifactLocation: { uri: string };
              region: { startLine: number };
            };
          }>;
        }>;
      }>;
    };
    const loc = sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation;
    assert.equal(loc.artifactLocation.uri, 'src/foo.ts');
    assert.equal(loc.region.startLine, 42);
  });

  it('omits locations for issues without file/line', () => {
    const result = makeResult({
      issues: [
        {
          type: 'unused-in-source',
          severity: 'warning',
          ref: 'SUP-002',
          message: 'not in source',
          file: undefined,
          line: undefined,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        results: Array<{ locations?: unknown[] }>;
      }>;
    };
    assert.equal(sarif.runs[0]!.results[0]!.locations, undefined);
  });

  it('maps severity correctly', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-ERR',
          message: 'expired',
          file: undefined,
          line: undefined,
        },
        {
          type: 'unused-in-source',
          severity: 'warning',
          ref: 'SUP-WARN',
          message: 'unused',
          file: undefined,
          line: undefined,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        results: Array<{ level: string }>;
      }>;
    };
    assert.equal(sarif.runs[0]!.results[0]!.level, 'error');
    assert.equal(sarif.runs[0]!.results[1]!.level, 'warning');
  });

  it('deduplicates rules', () => {
    const result = makeResult({
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-001',
          message: 'expired 1',
          file: undefined,
          line: undefined,
        },
        {
          type: 'expired',
          severity: 'error',
          ref: 'SUP-002',
          message: 'expired 2',
          file: undefined,
          line: undefined,
        },
        {
          type: 'missing-in-registry',
          severity: 'warning',
          ref: 'SUP-003',
          message: 'missing',
          file: 'a.ts',
          line: 1,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
      }>;
    };
    const rules = sarif.runs[0]!.tool.driver.rules;
    assert.equal(rules.length, 2);
    assert.deepEqual(rules.map((r) => r.id).sort(), [
      'expired',
      'missing-in-registry',
    ]);
  });

  it('includes shortDescription for registry-routing-mismatch', () => {
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
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        tool: {
          driver: {
            rules: Array<{ id: string; shortDescription: { text: string } }>;
          };
        };
      }>;
    };
    const rule = sarif.runs[0]!.tool.driver.rules.find(
      (r) => r.id === 'registry-routing-mismatch',
    );
    assert.ok(rule, 'rule should exist');
    assert.equal(
      rule.shortDescription.text,
      'Registry entry exists in a file that does not match its routing pattern',
    );
  });

  it('includes shortDescription for unrouted-ref', () => {
    const result = makeResult({
      issues: [
        {
          type: 'unrouted-ref',
          severity: 'warning',
          ref: 'UNKNOWN-001',
          message:
            'Ref "UNKNOWN-001" does not match any configured routing pattern',
          file: 'src/foo.ts',
          line: 10,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        tool: {
          driver: {
            rules: Array<{ id: string; shortDescription: { text: string } }>;
          };
        };
      }>;
    };
    const rule = sarif.runs[0]!.tool.driver.rules.find(
      (r) => r.id === 'unrouted-ref',
    );
    assert.ok(rule, 'rule should exist');
    assert.equal(
      rule.shortDescription.text,
      'Annotation ref does not match any configured routing pattern',
    );
  });

  it('omits locations for registry-routing-mismatch (file=undefined)', () => {
    const result = makeResult({
      issues: [
        {
          type: 'registry-routing-mismatch',
          severity: 'warning',
          ref: 'JIRA-456',
          message:
            'Ref "JIRA-456" is in default but pattern "JIRA-*" routes to jira-registry.json',
          file: undefined,
          line: undefined,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        results: Array<{ locations?: unknown[] }>;
      }>;
    };
    assert.equal(sarif.runs[0]!.results[0]!.locations, undefined);
  });

  it('includes shortDescription for every VerifyIssueType', () => {
    // Build a result containing one issue per type to force all rules into SARIF output
    const issues = VERIFY_ISSUE_TYPES.map((type) => ({
      type,
      severity: 'warning' as const,
      ref: `TEST-${type}`,
      message: `test issue for ${type}`,
      file:
        type.startsWith('registry') ||
        type === 'unused-in-source' ||
        type === 'expired' ||
        type === 'ref-collision'
          ? undefined
          : 'src/test.ts',
      line:
        type.startsWith('registry') ||
        type === 'unused-in-source' ||
        type === 'expired' ||
        type === 'ref-collision'
          ? undefined
          : 1,
    }));
    const result = makeResult({ issues });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{
        tool: {
          driver: {
            rules: Array<{ id: string; shortDescription: { text: string } }>;
          };
        };
      }>;
    };
    const rules = sarif.runs[0]!.tool.driver.rules;

    // Every VerifyIssueType must appear as a rule
    const ruleIds = new Set(rules.map((r) => r.id));
    for (const type of VERIFY_ISSUE_TYPES) {
      assert.ok(
        ruleIds.has(type),
        `SARIF rules missing VerifyIssueType: ${type}`,
      );
    }

    // Every rule must have a non-empty shortDescription that is not just the raw id
    for (const rule of rules) {
      assert.ok(
        rule.shortDescription?.text,
        `Rule ${rule.id} has empty shortDescription`,
      );
      assert.notEqual(
        rule.shortDescription.text,
        rule.id,
        `Rule ${rule.id} shortDescription should not be the raw id (missing RULE_DESCRIPTIONS entry)`,
      );
    }
  });

  it('uses issue type as ruleId', () => {
    const result = makeResult({
      issues: [
        {
          type: 'syntax-error',
          severity: 'error',
          ref: 'SUP-001',
          message: 'bad syntax',
          file: 'a.ts',
          line: 1,
        },
      ],
    });
    const sarif = JSON.parse(formatAsSarif(result)) as {
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    assert.equal(sarif.runs[0]!.results[0]!.ruleId, 'syntax-error');
  });
});
