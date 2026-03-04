import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Registry,
  RegistryEntry,
  ShioriAnnotation,
} from '../src/core/types.ts';
import { verify, formatActionHints } from '../src/commands/verify.ts';
import { formatVerifyResultAsMarkdown } from '../src/formatters/markdown.ts';

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'all',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

const referenceDate = new Date('2026-02-11T00:00:00Z');

describe('verify', () => {
  describe('missing-in-registry', () => {
    it('detects refs in source but not in registry', () => {
      const records = [makeAnnotation({ ref: 'SUP-NEW' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'missing-in-registry');
      assert.equal(result.issues[0]!.ref, 'SUP-NEW');
      assert.equal(result.issues[0]!.severity, 'error');
    });

    it('deduplicates missing refs', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-NEW', location: { file: 'a.ts', line: 1 } }),
        makeAnnotation({ ref: 'SUP-NEW', location: { file: 'b.ts', line: 2 } }),
      ];
      const result = verify({
        records,
        registry: {},
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const missing = result.issues.filter(
        (i) => i.type === 'missing-in-registry',
      );
      assert.equal(missing.length, 1);
    });
  });

  describe('unused-in-source', () => {
    it('detects refs in registry but not in source', () => {
      const records: ShioriAnnotation[] = [];
      const registry: Registry = { 'SUP-OLD': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'unused-in-source');
      assert.equal(result.issues[0]!.ref, 'SUP-OLD');
      assert.equal(result.issues[0]!.severity, 'warning');
    });
  });

  describe('expired', () => {
    it('detects expired registry entries', () => {
      const records = [makeAnnotation({ ref: 'SUP-EXP' })];
      const registry: Registry = {
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 1);
      assert.equal(expired[0]!.severity, 'error');
    });

    it('does not flag future expires as expired', () => {
      const records = [makeAnnotation({ ref: 'SUP-FUT' })];
      const registry: Registry = {
        'SUP-FUT': makeRegistryEntry({ expires: '2027-12-31' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 0);
    });

    it('normalizes YYYY-MM expires to end of month', () => {
      const records = [makeAnnotation({ ref: 'SUP-MON' })];
      const registry: Registry = {
        'SUP-MON': makeRegistryEntry({ expires: '2026-02' }),
      };
      // 2026-02-11 should NOT treat 2026-02 as expired (it means end of Feb)
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(expired.length, 0);
    });
  });

  describe('syntax-error', () => {
    it('detects records with syntax errors', () => {
      const records = [
        makeAnnotation({
          ref: '',
          tagged: true,
          syntaxErrors: ["empty value for key 'ref'"],
        }),
      ];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['syntax-error'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0]!.type, 'syntax-error');
      assert.equal(result.issues[0]!.severity, 'error');
      assert.ok(result.issues[0]!.message.includes('empty value'));
    });

    it('does not report draft annotations (tagged with empty ref, no errors)', () => {
      const records = [makeAnnotation({ ref: '', tagged: true })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['syntax-error'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 0);
    });

    it('does not report annotations without syntax errors', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK', tagged: true })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: ['syntax-error'],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 0);
    });
  });

  describe('ref-format', () => {
    it('detects invalid ref format', () => {
      const records = [makeAnnotation({ ref: 'marker)' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['ref-format'],
        now: referenceDate,
      });
      const refFormat = result.issues.filter((i) => i.type === 'ref-format');
      assert.equal(refFormat.length, 1);
      assert.equal(refFormat[0]!.severity, 'warning');
      assert.ok(refFormat[0]!.message.includes('Invalid ref format'));
    });

    it('does not flag valid refs', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-1234' }),
        makeAnnotation({ ref: 'ADR:0007' }),
        makeAnnotation({ ref: 'JIRA:PROJ-123' }),
        makeAnnotation({ ref: 'DEV-001' }),
      ];
      const registry: Registry = {
        'SUP-1234': makeRegistryEntry(),
        'ADR:0007': makeRegistryEntry(),
        'JIRA:PROJ-123': makeRegistryEntry(),
        'DEV-001': makeRegistryEntry(),
      };
      const result = verify({
        records,
        registry,
        failOn: ['ref-format'],
        warnOn: [],
        now: referenceDate,
      });
      const refFormat = result.issues.filter((i) => i.type === 'ref-format');
      assert.equal(refFormat.length, 0);
    });

    it('deduplicates ref-format issues by ref', () => {
      const records = [
        makeAnnotation({ ref: 'bad!ref', location: { file: 'a.ts', line: 1 } }),
        makeAnnotation({ ref: 'bad!ref', location: { file: 'b.ts', line: 2 } }),
      ];
      const result = verify({
        records,
        registry: {},
        failOn: [],
        warnOn: ['ref-format'],
        now: referenceDate,
      });
      const refFormat = result.issues.filter((i) => i.type === 'ref-format');
      assert.equal(refFormat.length, 1);
    });
  });

  describe('ref-collision', () => {
    it('detects duplicate refs from multi-registry loading', () => {
      const records = [makeAnnotation({ ref: 'SUP-DUP' })];
      const registry: Registry = { 'SUP-DUP': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['ref-collision'],
        now: referenceDate,
        duplicates: [
          {
            ref: 'SUP-DUP',
            defaultFile: 'registry.json',
            patternFile: 'team-a-registry.json',
          },
        ],
      });
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0]!.severity, 'warning');
      assert.equal(collisions[0]!.ref, 'SUP-DUP');
      assert.ok(collisions[0]!.message.includes('registry.json'));
      assert.ok(collisions[0]!.message.includes('team-a-registry.json'));
    });

    it('does not produce ref-collision when no duplicates', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        duplicates: [],
      });
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(collisions.length, 0);
    });

    it('does not produce ref-collision when duplicates is omitted', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(collisions.length, 0);
    });

    it('respects failOn for ref-collision severity', () => {
      const records = [makeAnnotation({ ref: 'SUP-DUP' })];
      const registry: Registry = { 'SUP-DUP': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: ['ref-collision'],
        warnOn: [],
        now: referenceDate,
        duplicates: [
          {
            ref: 'SUP-DUP',
            defaultFile: 'registry.json',
            patternFile: 'team-a-registry.json',
          },
        ],
      });
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(collisions[0]!.severity, 'error');
    });

    it('includes ref-collision in summary byType', () => {
      const records = [makeAnnotation({ ref: 'SUP-DUP' })];
      const registry: Registry = { 'SUP-DUP': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        duplicates: [
          {
            ref: 'SUP-DUP',
            defaultFile: 'registry.json',
            patternFile: 'team-a-registry.json',
          },
        ],
      });
      assert.equal(result.summary.byType['ref-collision'], 1);
    });

    it('reports multiple ref-collisions', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-A' }),
        makeAnnotation({ ref: 'SUP-B' }),
      ];
      const registry: Registry = {
        'SUP-A': makeRegistryEntry(),
        'SUP-B': makeRegistryEntry(),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        duplicates: [
          {
            ref: 'SUP-A',
            defaultFile: 'registry.json',
            patternFile: 'team-a.json',
          },
          {
            ref: 'SUP-B',
            defaultFile: 'registry.json',
            patternFile: 'team-b.json',
          },
        ],
      });
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(collisions.length, 2);
    });
  });

  describe('ignored annotations', () => {
    it('skips ignored annotations in verify', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-IGN', tagged: true, ignored: true }),
      ];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      // Should not report missing-in-registry for ignored annotation
      assert.equal(result.issues.length, 0);
    });

    it('does not count ignored annotations in source refs', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-IGN', tagged: true, ignored: true }),
      ];
      const registry: Registry = { 'SUP-IGN': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      // SUP-IGN is ignored, so registry entry appears unused
      const unused = result.issues.filter((i) => i.type === 'unused-in-source');
      assert.equal(unused.length, 1);
    });
  });

  describe('no issues', () => {
    it('returns empty issues when everything matches', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = {
        'SUP-OK': makeRegistryEntry({ expires: '2027-12-31' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry', 'expired'],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      assert.equal(result.issues.length, 0);
      assert.equal(result.summary.total, 0);
    });
  });

  describe('severity control', () => {
    it('applies failOn as error and default as warning', () => {
      const records = [makeAnnotation({ ref: 'SUP-MISS' })];
      const registry: Registry = { 'SUP-UNUSED': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      const missing = result.issues.find(
        (i) => i.type === 'missing-in-registry',
      );
      const unused = result.issues.find((i) => i.type === 'unused-in-source');
      assert.equal(missing?.severity, 'error');
      assert.equal(unused?.severity, 'warning');
    });
  });

  describe('summary', () => {
    it('produces correct summary statistics', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-MISS' }),
        makeAnnotation({
          ref: '',
          tagged: true,
          syntaxErrors: ["empty value for key 'ref'"],
        }),
      ];
      const registry: Registry = {
        'SUP-UNUSED': makeRegistryEntry(),
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry', 'expired'],
        warnOn: ['unused-in-source', 'syntax-error'],
        now: referenceDate,
      });
      // SUP-EXP is both unused-in-source and expired
      assert.equal(result.summary.total, 5);
      assert.equal(result.summary.errors, 2);
      assert.equal(result.summary.warnings, 3);
      assert.equal(result.summary.byType['missing-in-registry'], 1);
      assert.equal(result.summary.byType['unused-in-source'], 2);
      assert.equal(result.summary.byType['expired'], 1);
      assert.equal(result.summary.byType['syntax-error'], 1);
    });
  });

  describe('formatActionHints', () => {
    it('returns all-passed message when no issues', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.equal(hints.length, 1);
      assert.ok(hints[0]!.includes('All checks passed'));
    });

    it('shows hint for missing-in-registry', () => {
      const records = [makeAnnotation({ ref: 'SUP-NEW' })];
      const result = verify({
        records,
        registry: {},
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('missing-in-registry')));
      assert.ok(hints.some((h) => h.includes('shiori update')));
    });

    it('shows hint for unused-in-source', () => {
      const records: ShioriAnnotation[] = [];
      const registry: Registry = { 'SUP-OLD': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: ['unused-in-source'],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('unused-in-source')));
      assert.ok(hints.some((h) => h.includes('shiori resolve')));
    });

    it('shows hint for expired', () => {
      const records = [makeAnnotation({ ref: 'SUP-EXP' })];
      const registry: Registry = {
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['expired'],
        warnOn: [],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('expired')));
      assert.ok(hints.some((h) => h.includes('shiori resolve')));
      assert.ok(hints.some((h) => h.includes('extend expires')));
    });

    it('shows hint for syntax-error', () => {
      const records = [
        makeAnnotation({
          ref: '',
          tagged: true,
          syntaxErrors: ["empty value for key 'ref'"],
        }),
      ];
      const result = verify({
        records,
        registry: {},
        failOn: ['syntax-error'],
        warnOn: [],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('syntax-error')));
      assert.ok(hints.some((h) => h.includes('Fix annotation syntax')));
    });

    it('shows hint for ref-collision', () => {
      const records = [makeAnnotation({ ref: 'SUP-DUP' })];
      const registry: Registry = { 'SUP-DUP': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        duplicates: [
          {
            ref: 'SUP-DUP',
            defaultFile: 'registry.json',
            patternFile: 'team-a.json',
          },
        ],
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('ref-collision')));
      assert.ok(hints.some((h) => h.includes('Duplicate ref')));
    });

    it('shows hint for unrouted-ref', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999' })];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns: [{ match: 'SUP-{id}' }],
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('unrouted-ref')));
      assert.ok(hints.some((h) => h.includes('refPatterns')));
    });

    it('shows multiple hints for combined issues', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-MISS' }),
        makeAnnotation({
          ref: '',
          tagged: true,
          syntaxErrors: ["empty value for key 'ref'"],
        }),
      ];
      const registry: Registry = {
        'SUP-UNUSED': makeRegistryEntry(),
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry', 'expired'],
        warnOn: ['unused-in-source', 'syntax-error'],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('missing-in-registry')));
      assert.ok(hints.some((h) => h.includes('unused-in-source')));
      assert.ok(hints.some((h) => h.includes('expired')));
      assert.ok(hints.some((h) => h.includes('syntax-error')));
    });
  });

  describe('unrouted-ref', () => {
    const refPatterns = [{ match: 'SUP-{id}' }, { match: 'ADR:{id}' }];

    it('does not detect unrouted-ref when refPatterns is undefined', () => {
      const records = [makeAnnotation({ ref: 'UNKNOWN-001' })];
      const registry: Registry = { 'UNKNOWN-001': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 0);
    });

    it('does not detect unrouted-ref when refPatterns is empty', () => {
      const records = [makeAnnotation({ ref: 'UNKNOWN-001' })];
      const registry: Registry = { 'UNKNOWN-001': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns: [],
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 0);
    });

    it('does not detect unrouted-ref for matching refs', () => {
      const records = [
        makeAnnotation({ ref: 'SUP-1234' }),
        makeAnnotation({ ref: 'ADR:0007' }),
      ];
      const registry: Registry = {
        'SUP-1234': makeRegistryEntry(),
        'ADR:0007': makeRegistryEntry(),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 0);
    });

    it('detects unrouted-ref for non-matching refs', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999' })];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 1);
      assert.equal(unrouted[0]!.ref, 'JIRA-999');
      assert.ok(unrouted[0]!.message.includes('does not match'));
    });

    it('skips empty refs', () => {
      const records = [makeAnnotation({ ref: '' })];
      const result = verify({
        records,
        registry: {},
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 0);
    });

    it('skips ignored annotations', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999', ignored: true })];
      const result = verify({
        records,
        registry: {},
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 0);
    });

    it('deduplicates unrouted-ref issues by ref', () => {
      const records = [
        makeAnnotation({
          ref: 'JIRA-999',
          location: { file: 'a.ts', line: 1 },
        }),
        makeAnnotation({
          ref: 'JIRA-999',
          location: { file: 'b.ts', line: 2 },
        }),
      ];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted.length, 1);
    });

    it('defaults to warning severity', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999' })];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted[0]!.severity, 'warning');
    });

    it('respects failOn for error severity', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999' })];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: ['unrouted-ref'],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(unrouted[0]!.severity, 'error');
    });

    it('includes unrouted-ref in summary byType', () => {
      const records = [makeAnnotation({ ref: 'JIRA-999' })];
      const registry: Registry = { 'JIRA-999': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      assert.equal(result.summary.byType['unrouted-ref'], 1);
    });
  });

  describe('registry-routing-mismatch', () => {
    const refPatterns = [
      { match: 'JIRA-{id}', registryFile: 'jira-registry.json' },
      { match: 'ADR:{id}', registryFile: 'adr-registry.yaml' },
    ];

    it('detects ref in wrong registry file', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      // Ref is in default registry (null) but should be in jira-registry.json
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 1);
      assert.equal(mismatches[0]!.ref, 'JIRA-123');
      assert.ok(mismatches[0]!.message.includes('default registry'));
      assert.ok(mismatches[0]!.message.includes('jira-registry.json'));
    });

    it('does not report when ref is in correct registry file', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([
        ['JIRA-123', 'jira-registry.json'],
      ]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 0);
    });

    it('does not report when refPatterns is undefined', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 0);
    });

    it('does not report when refPatterns is empty', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns: [],
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 0);
    });

    it('does not report when refOrigins is undefined', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 0);
    });

    it('skips refs that do not match any pattern (handled by unrouted-ref)', () => {
      const records = [makeAnnotation({ ref: 'UNKNOWN-001' })];
      const registry: Registry = { 'UNKNOWN-001': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([
        ['UNKNOWN-001', null],
      ]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 0);
    });

    it('detects pattern routing to default registry (registryFile undefined)', () => {
      // Pattern has no registryFile, so expected location is default (null)
      const patternsNoFile = [{ match: 'SUP-{id}' }];
      const records = [makeAnnotation({ ref: 'SUP-123' })];
      const registry: Registry = { 'SUP-123': makeRegistryEntry() };
      // Ref is actually in a pattern file (wrong place)
      const refOrigins = new Map<string, string | null>([
        ['SUP-123', 'some-other.json'],
      ]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns: patternsNoFile,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches.length, 1);
      assert.ok(mismatches[0]!.message.includes('default registry'));
    });

    it('defaults to warning severity', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches[0]!.severity, 'warning');
    });

    it('respects failOn for error severity', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: ['registry-routing-mismatch'],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      const mismatches = result.issues.filter(
        (i) => i.type === 'registry-routing-mismatch',
      );
      assert.equal(mismatches[0]!.severity, 'error');
    });

    it('includes registry-routing-mismatch in summary byType', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns,
        refOrigins,
      });
      assert.equal(result.summary.byType['registry-routing-mismatch'], 1);
    });
  });

  describe('formatActionHints for registry-routing-mismatch', () => {
    it('shows hint for registry-routing-mismatch', () => {
      const records = [makeAnnotation({ ref: 'JIRA-123' })];
      const registry: Registry = { 'JIRA-123': makeRegistryEntry() };
      const refOrigins = new Map<string, string | null>([['JIRA-123', null]]);
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        refPatterns: [
          { match: 'JIRA-{id}', registryFile: 'jira-registry.json' },
        ],
        refOrigins,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('registry-routing-mismatch')));
      assert.ok(hints.some((h) => h.includes('wrong registry file')));
    });
  });

  describe('expiring-soon', () => {
    it('detects entry expiring within default 14-day threshold', () => {
      // referenceDate = 2026-02-11, entry expires 2026-02-20 (9 days away, < 14)
      const records = [makeAnnotation({ ref: 'SUP-SOON' })];
      const registry: Registry = {
        'SUP-SOON': makeRegistryEntry({ expires: '2026-02-20' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expiringSoon.length, 1);
      assert.equal(expiringSoon[0]!.ref, 'SUP-SOON');
      assert.equal(expiringSoon[0]!.severity, 'warning');
    });

    it('detects entry expiring within custom threshold', () => {
      // referenceDate = 2026-02-11, entry expires 2026-02-14 (3 days away)
      // With threshold=7, should be detected
      const records = [makeAnnotation({ ref: 'SUP-SOON2' })];
      const registry: Registry = {
        'SUP-SOON2': makeRegistryEntry({ expires: '2026-02-14' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        expiringThresholdDays: 7,
      });
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expiringSoon.length, 1);
    });

    it('does not double-report expired entries as expiring-soon', () => {
      // referenceDate = 2026-02-11, entry expired 2025-01-01 (already expired)
      const records = [makeAnnotation({ ref: 'SUP-EXP' })];
      const registry: Registry = {
        'SUP-EXP': makeRegistryEntry({ expires: '2025-01-01' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expired.length, 1);
      assert.equal(expiringSoon.length, 0);
    });

    it('boundary: threshold=0 with today expiry → expiring-soon (not expired)', () => {
      // referenceDate = 2026-02-11, entry expires 2026-02-11 (today)
      // expired: norm < todayStr → false. expiring-soon: norm <= thresholdDateStr → true
      const records = [makeAnnotation({ ref: 'SUP-TODAY' })];
      const registry: Registry = {
        'SUP-TODAY': makeRegistryEntry({ expires: '2026-02-11' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        expiringThresholdDays: 0,
      });
      const expired = result.issues.filter((i) => i.type === 'expired');
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expired.length, 0);
      assert.equal(expiringSoon.length, 1);
    });

    it('handles YYYY-MM format for expiring-soon', () => {
      // referenceDate = 2026-02-11, entry expires 2026-02 (normalized to 2026-02-99)
      // With threshold=90 days → threshold date = 2026-05-12
      // norm = 2026-02-99 < 2026-05-12 → expiring-soon
      const records = [makeAnnotation({ ref: 'SUP-MON' })];
      const registry: Registry = {
        'SUP-MON': makeRegistryEntry({ expires: '2026-02' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
        expiringThresholdDays: 90,
      });
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expiringSoon.length, 1);
    });

    it('skips entries without expires', () => {
      const records = [makeAnnotation({ ref: 'SUP-NOEXP' })];
      const registry: Registry = {
        'SUP-NOEXP': makeRegistryEntry({ expires: undefined }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expiringSoon.length, 0);
    });

    it('does not detect entry far from threshold', () => {
      // referenceDate = 2026-02-11, entry expires 2027-12-31
      const records = [makeAnnotation({ ref: 'SUP-FAR' })];
      const registry: Registry = {
        'SUP-FAR': makeRegistryEntry({ expires: '2027-12-31' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const expiringSoon = result.issues.filter(
        (i) => i.type === 'expiring-soon',
      );
      assert.equal(expiringSoon.length, 0);
    });

    it('includes expiring-soon in summary byType', () => {
      const records = [makeAnnotation({ ref: 'SUP-SOON' })];
      const registry: Registry = {
        'SUP-SOON': makeRegistryEntry({ expires: '2026-02-20' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      assert.equal(result.summary.byType['expiring-soon'], 1);
    });
  });

  describe('formatActionHints for expiring-soon', () => {
    it('shows hint for expiring-soon', () => {
      const records = [makeAnnotation({ ref: 'SUP-SOON' })];
      const registry: Registry = {
        'SUP-SOON': makeRegistryEntry({ expires: '2026-02-20' }),
      };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const hints = formatActionHints(result);
      assert.ok(hints.some((h) => h.includes('expiring-soon')));
      assert.ok(
        hints.some(
          (h) => h.includes('Extend expires') || h.includes('resolve'),
        ),
      );
    });
  });

  describe('VERIFY_ISSUE_TYPES sync', () => {
    it('VERIFY_ISSUE_TYPES includes expiring-soon', async () => {
      const { VERIFY_ISSUE_TYPES } = await import('../src/core/types.ts');
      assert.ok(
        VERIFY_ISSUE_TYPES.includes('expiring-soon'),
        'expiring-soon must be in VERIFY_ISSUE_TYPES',
      );
    });
  });

  describe('formatVerifyResultAsMarkdown', () => {
    it('generates markdown with errors and warnings sections', () => {
      const records = [makeAnnotation({ ref: 'SUP-MISS' })];
      const registry: Registry = {};
      const result = verify({
        records,
        registry,
        failOn: ['missing-in-registry'],
        warnOn: [],
        now: referenceDate,
      });
      const md = formatVerifyResultAsMarkdown(result);
      assert.ok(md.includes('# Annotation Registry Verification Report'));
      assert.ok(md.includes('## Errors'));
      assert.ok(md.includes('SUP-MISS'));
      assert.ok(md.includes('missing-in-registry'));
    });

    it('shows "No issues found" when clean', () => {
      const records = [makeAnnotation({ ref: 'SUP-OK' })];
      const registry: Registry = { 'SUP-OK': makeRegistryEntry() };
      const result = verify({
        records,
        registry,
        failOn: [],
        warnOn: [],
        now: referenceDate,
      });
      const md = formatVerifyResultAsMarkdown(result);
      assert.ok(md.includes('No issues found'));
    });
  });
});
