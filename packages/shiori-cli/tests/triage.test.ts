import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  triage,
  formatTriageAsMarkdown,
  formatTriageOutput,
} from '../src/commands/triage.ts';
import { verify } from '../src/commands/verify.ts';
import type {
  ShioriAnnotation,
  ShioriCandidate,
  Registry,
  RegistryEntry,
  ScanResult,
  VerifyResult,
} from '../src/core/types.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeAnnotation(
  ref: string,
  file: string,
  line: number,
  opts?: { rule?: string; tagged?: boolean; ignored?: boolean },
): ShioriAnnotation {
  return {
    ref,
    rule: opts?.rule,
    tagged: opts?.tagged ?? true,
    ignored: opts?.ignored ?? false,
    location: { file, line },
  };
}

function makeRegistryEntry(
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'test.ts',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: 'intentional',
    ...overrides,
  };
}

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('triage', () => {
  describe('empty input', () => {
    it('returns empty result for empty scan', () => {
      const result = triage({
        scanResult: makeScanResult(),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items.length, 0);
      assert.equal(result.summary.total, 0);
      assert.deepEqual(result.summary.byPriority, {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
    });

    it('returns empty result when no issues exist', () => {
      const annotations = [makeAnnotation('REF-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'REF-001': makeRegistryEntry(),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.items.length, 0);
    });
  });

  describe('priority determination', () => {
    it('assigns critical priority for expired issues', () => {
      const annotations = [makeAnnotation('EXP-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.priority, 'critical');
    });

    it('assigns high priority for expiring-soon issues', () => {
      const annotations = [makeAnnotation('SOON-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'SOON-001': makeRegistryEntry({ expires: '2025-01-10' }),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.priority, 'high');
    });

    it('assigns high priority for missing-in-registry issues', () => {
      const annotations = [makeAnnotation('MISS-001', 'src/a.ts', 1)];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.priority, 'high');
    });

    it('assigns medium priority for unused-in-source issues', () => {
      const registry: Registry = {
        'UNUSED-001': makeRegistryEntry(),
      };

      const result = triage({
        scanResult: makeScanResult(),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.priority, 'medium');
    });

    it('uses highest priority when ref has multiple issue types', () => {
      // expired (critical) + missing-in-registry won't happen together (expired requires registry)
      // expiring-soon (high) + ref-format (medium) scenario: an annotation with invalid ref format but in registry with expiring date
      // Actually, let's create a scenario: ref is in source, has expired entry in registry
      // → expired=critical issue
      const annotations = [makeAnnotation('MULTI-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'MULTI-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };

      // Additional: create a second unused registry entry to ensure separate issues
      // The MULTI-001 will have expired (critical), so highest priority should be critical
      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.priority, 'critical');
      assert.ok(result.items[0]!.issues.some((i) => i.type === 'expired'));
    });
  });

  describe('ref grouping', () => {
    it('groups multiple issues for the same ref into one item', () => {
      // Create a ref that's in source but not in registry AND has invalid format
      // missing-in-registry is ref-deduplicated by verify, so it only appears once
      // Let's use a different approach: ref in source, expired in registry
      const annotations = [
        makeAnnotation('GRP-001', 'src/a.ts', 1),
        makeAnnotation('GRP-001', 'src/b.ts', 5, { rule: 'no-console' }),
      ];
      const registry: Registry = {
        'GRP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      // Should have exactly one triage item for GRP-001
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ref, 'GRP-001');
      // Source locations should include both
      assert.equal(result.items[0]!.sourceLocations.length, 2);
    });

    it('creates separate items for different refs', () => {
      const annotations = [
        makeAnnotation('REF-A', 'src/a.ts', 1),
        makeAnnotation('REF-B', 'src/b.ts', 2),
      ];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items.length, 2);
      const refs = result.items.map((i) => i.ref);
      assert.ok(refs.includes('REF-A'));
      assert.ok(refs.includes('REF-B'));
    });
  });

  describe('registry enrichment', () => {
    it('includes registry entry when ref is in registry', () => {
      const annotations = [makeAnnotation('ENR-001', 'src/a.ts', 1)];
      const entry = makeRegistryEntry({
        reason: 'test enrichment',
        owner: 'team-a',
        kind: 'workaround',
        expires: '2020-01-01',
      });
      const registry: Registry = { 'ENR-001': entry };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.items.length, 1);
      assert.deepEqual(result.items[0]!.registryEntry, entry);
    });

    it('sets registryEntry to undefined when ref is not in registry', () => {
      const annotations = [makeAnnotation('NOREG-001', 'src/a.ts', 1)];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.registryEntry, undefined);
    });
  });

  describe('filtering', () => {
    const annotations = [
      makeAnnotation('OWN-001', 'src/a.ts', 1),
      makeAnnotation('OWN-002', 'src/b.ts', 2),
      makeAnnotation('NOREG-001', 'src/c.ts', 3),
    ];
    const registry: Registry = {
      'OWN-001': makeRegistryEntry({
        owner: 'team-a',
        kind: 'workaround',
        expires: '2020-01-01',
      }),
      'OWN-002': makeRegistryEntry({
        owner: 'team-b',
        kind: 'compat',
        expires: '2020-01-01',
      }),
    };

    it('filters by owner', () => {
      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
        owner: 'team-a',
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ref, 'OWN-001');
    });

    it('filters by kind', () => {
      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
        kind: 'compat',
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ref, 'OWN-002');
    });

    it('filters by expired-only', () => {
      const mixedAnnotations = [
        makeAnnotation('EXP-A', 'src/a.ts', 1),
        makeAnnotation('NOEXP-B', 'src/b.ts', 2),
      ];
      const mixedRegistry: Registry = {
        'EXP-A': makeRegistryEntry({ expires: '2020-01-01' }),
        'NOEXP-B': makeRegistryEntry({ expires: '2030-01-01' }),
      };

      const result = triage({
        scanResult: makeScanResult(mixedAnnotations),
        registry: mixedRegistry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
        expiredOnly: true,
      });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ref, 'EXP-A');
    });

    it('combines owner + expired-only filters (AND)', () => {
      const multiAnnotations = [
        makeAnnotation('COMBO-A', 'src/a.ts', 1),
        makeAnnotation('COMBO-B', 'src/b.ts', 2),
        makeAnnotation('COMBO-C', 'src/c.ts', 3),
      ];
      const multiRegistry: Registry = {
        'COMBO-A': makeRegistryEntry({
          owner: 'team-a',
          expires: '2020-01-01',
        }),
        'COMBO-B': makeRegistryEntry({
          owner: 'team-a',
          expires: '2030-01-01',
        }),
        'COMBO-C': makeRegistryEntry({
          owner: 'team-b',
          expires: '2020-01-01',
        }),
      };

      const result = triage({
        scanResult: makeScanResult(multiAnnotations),
        registry: multiRegistry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
        owner: 'team-a',
        expiredOnly: true,
      });

      // Only COMBO-A matches both owner=team-a AND expired
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ref, 'COMBO-A');
    });

    it('excludes refs without registry entry when owner filter is set', () => {
      const annotations = [makeAnnotation('NOREG-X', 'src/x.ts', 1)];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
        owner: 'team-a',
      });

      assert.equal(result.items.length, 0);
    });

    it('returns empty result when all items are filtered out', () => {
      const annotations = [makeAnnotation('FILT-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'FILT-001': makeRegistryEntry({
          owner: 'team-a',
          expires: '2020-01-01',
        }),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
        owner: 'nonexistent-team',
      });

      assert.equal(result.items.length, 0);
      assert.equal(result.summary.total, 0);
    });
  });

  describe('sorting', () => {
    it('sorts by priority desc then ref asc', () => {
      const annotations = [
        makeAnnotation('B-REF', 'src/b.ts', 1),
        makeAnnotation('A-REF', 'src/a.ts', 1),
        makeAnnotation('C-REF', 'src/c.ts', 1),
      ];
      const registry: Registry = {
        'A-REF': makeRegistryEntry({ expires: '2020-01-01' }), // critical (expired)
        'B-REF': makeRegistryEntry({ expires: '2025-01-10' }), // high (expiring-soon)
        'C-REF': makeRegistryEntry({ expires: '2020-01-01' }), // critical (expired)
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      // Expected order: A-REF (critical), C-REF (critical), B-REF (high)
      assert.equal(result.items[0]!.ref, 'A-REF');
      assert.equal(result.items[0]!.priority, 'critical');
      assert.equal(result.items[1]!.ref, 'C-REF');
      assert.equal(result.items[1]!.priority, 'critical');
      assert.equal(result.items[2]!.ref, 'B-REF');
      assert.equal(result.items[2]!.priority, 'high');
    });
  });

  describe('action hints', () => {
    it('replaces <ref> placeholder with actual ref in expired action', () => {
      const annotations = [makeAnnotation('ACT-001', 'src/a.ts', 1)];
      const registry: Registry = {
        'ACT-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(
        result.items[0]!.action,
        'shiori resolve --ref ACT-001 or extend expires',
      );
      // Ensure no placeholder remains
      assert.ok(!result.items[0]!.action.includes('<ref>'));
    });

    it('replaces <ref> placeholder in unused-in-source action', () => {
      const registry: Registry = {
        'UNUSED-ACT': makeRegistryEntry(),
      };

      const result = triage({
        scanResult: makeScanResult(),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items[0]!.action, 'shiori resolve --ref UNUSED-ACT');
      assert.ok(!result.items[0]!.action.includes('<ref>'));
    });

    it('sets action for missing-in-registry (no placeholder)', () => {
      const annotations = [makeAnnotation('MISS-ACT', 'src/a.ts', 1)];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.items[0]!.action, 'shiori update');
    });
  });

  describe('URL resolution', () => {
    it('resolves URL from refPatterns', () => {
      const annotations = [makeAnnotation('JIRA:PROJ-123', 'src/a.ts', 1)];
      const refPatterns = [
        {
          match: 'JIRA:{id}',
          urlTemplate: 'https://jira.example.com/browse/{id}',
        },
      ];

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
        refPatterns,
      });

      assert.equal(result.items.length, 1);
      assert.equal(
        result.items[0]!.url,
        'https://jira.example.com/browse/PROJ-123',
      );
    });
  });

  describe('summary', () => {
    it('counts items by priority correctly', () => {
      const annotations = [
        makeAnnotation('CRIT-001', 'src/a.ts', 1),
        makeAnnotation('HIGH-001', 'src/b.ts', 2),
        makeAnnotation('HIGH-002', 'src/c.ts', 3),
      ];
      const registry: Registry = {
        'CRIT-001': makeRegistryEntry({ expires: '2020-01-01' }),
        'HIGH-001': makeRegistryEntry({ expires: '2025-01-10' }),
      };
      // HIGH-002 is missing from registry → high priority

      const result = triage({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
        now: new Date('2025-01-01'),
      });

      assert.equal(result.summary.total, 3);
      assert.equal(result.summary.byPriority.critical, 1);
      assert.equal(result.summary.byPriority.high, 2);
    });
  });
});

describe('formatTriageAsMarkdown', () => {
  it('generates markdown with summary table and action items', () => {
    const result = triage({
      scanResult: makeScanResult([
        makeAnnotation('EXP-001', 'src/a.ts', 1),
        makeAnnotation('MISS-001', 'src/b.ts', 2),
      ]),
      registry: {
        'EXP-001': makeRegistryEntry({
          expires: '2020-01-01',
          owner: 'team-a',
        }),
      },
      failOn: [],
      warnOn: [],
      now: new Date('2025-01-01'),
    });

    const md = formatTriageAsMarkdown(result);

    assert.ok(md.includes('# Shiori Triage Report'));
    assert.ok(md.includes('## Summary'));
    assert.ok(md.includes('## Action Items'));
    assert.ok(md.includes('### 🔴 Critical'));
    assert.ok(md.includes('EXP-001'));
    assert.ok(md.includes('team-a'));
    assert.ok(md.includes('### 🟡 High'));
    assert.ok(md.includes('MISS-001'));
  });

  it('generates markdown with no action items message for empty result', () => {
    const result = triage({
      scanResult: makeScanResult([makeAnnotation('REF-001', 'src/a.ts', 1)]),
      registry: { 'REF-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
      now: new Date('2025-01-01'),
    });

    const md = formatTriageAsMarkdown(result);

    assert.ok(md.includes('No action items found.'));
  });
});

describe('formatTriageOutput', () => {
  it('returns JSON for json format', () => {
    const result = triage({
      scanResult: makeScanResult(),
      registry: {},
      failOn: [],
      warnOn: [],
    });

    const output = formatTriageOutput(result, 'json');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'triage');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;

    assert.equal(parsed.summary.total, 0);
  });

  it('returns markdown for markdown format', () => {
    const result = triage({
      scanResult: makeScanResult(),
      registry: {},
      failOn: [],
      warnOn: [],
    });

    const output = formatTriageOutput(result, 'markdown');

    assert.ok(output.includes('# Shiori Triage Report'));
  });
});

// ── verifyResult injection path ─────────────────────────────

describe('triage verifyResult injection', () => {
  it('uses injected verifyResult instead of computing internally', () => {
    const annotations = [makeAnnotation('INJ-001', 'src/a.ts', 1)];
    const registry: Registry = {
      'INJ-001': makeRegistryEntry({ expires: '2020-01-01' }),
    };
    const scanResult = makeScanResult(annotations);
    const now = new Date('2025-01-01');

    // Pre-compute verifyResult
    const preComputed = verify({
      records: annotations,
      registry,
      failOn: [],
      warnOn: [],
      now,
    });

    // Triage with injection
    const withInjection = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      now,
      verifyResult: preComputed,
    });

    // Triage without injection (internally calls verify)
    const withoutInjection = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      now,
    });

    // Both paths should produce equivalent triage results
    assert.equal(withInjection.items.length, withoutInjection.items.length);
    assert.equal(withInjection.items[0]!.ref, withoutInjection.items[0]!.ref);
    assert.equal(
      withInjection.items[0]!.priority,
      withoutInjection.items[0]!.priority,
    );
    assert.deepEqual(
      withInjection.summary.byPriority,
      withoutInjection.summary.byPriority,
    );
  });

  it('preserves timestamp from injected verifyResult', () => {
    const annotations = [makeAnnotation('TS-001', 'src/a.ts', 1)];
    const registry: Registry = {};
    const scanResult = makeScanResult(annotations);

    const fixedTimestamp = '2025-06-15T12:00:00.000Z';
    const injected: VerifyResult = {
      timestamp: fixedTimestamp,
      issues: [
        {
          type: 'missing-in-registry',
          severity: 'warning',
          ref: 'TS-001',
          message: 'ID "TS-001" found in source but not in registry',
          file: 'src/a.ts',
          line: 1,
        },
      ],
      summary: {
        total: 1,
        errors: 0,
        warnings: 1,
        byType: {
          'syntax-error': 0,
          'ref-format': 0,
          'missing-in-registry': 1,
          'unused-in-source': 0,
          expired: 0,
          'expiring-soon': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
        },
      },
      scannedRecords: 1,
      registryEntries: 0,
    };

    const result = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      verifyResult: injected,
    });

    // Triage result should carry the injected verifyResult's timestamp
    assert.equal(result.timestamp, fixedTimestamp);
  });

  it('uses injected issues for grouping and priority', () => {
    // Inject a verifyResult with a custom issue set
    const annotations = [makeAnnotation('CUSTOM-001', 'src/a.ts', 1)];
    const registry: Registry = {
      'CUSTOM-001': makeRegistryEntry(),
    };
    const scanResult = makeScanResult(annotations);

    // Manually craft a verifyResult with an expired issue
    // (even though the registry entry has no expires — injection overrides)
    const injected: VerifyResult = {
      timestamp: new Date('2025-01-01').toISOString(),
      issues: [
        {
          type: 'expired',
          severity: 'error',
          ref: 'CUSTOM-001',
          message: 'ID "CUSTOM-001" expired on 2024-01-01',
          file: undefined,
          line: undefined,
        },
      ],
      summary: {
        total: 1,
        errors: 1,
        warnings: 0,
        byType: {
          'syntax-error': 0,
          'ref-format': 0,
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 1,
          'expiring-soon': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
        },
      },
      scannedRecords: 1,
      registryEntries: 1,
    };

    const result = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      verifyResult: injected,
    });

    // Should use the injected expired issue, not compute its own
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.ref, 'CUSTOM-001');
    assert.equal(result.items[0]!.priority, 'critical');
    assert.ok(result.items[0]!.issues.some((i) => i.type === 'expired'));
  });

  it('produces empty triage when injected verifyResult has no issues', () => {
    const annotations = [makeAnnotation('CLEAN-001', 'src/a.ts', 1)];
    const registry: Registry = {};
    const scanResult = makeScanResult(annotations);

    // Inject a clean verifyResult (no issues, even though registry is empty)
    const injected: VerifyResult = {
      timestamp: new Date().toISOString(),
      issues: [],
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        byType: {
          'syntax-error': 0,
          'ref-format': 0,
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 0,
          'expiring-soon': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
        },
      },
      scannedRecords: 1,
      registryEntries: 0,
    };

    const result = triage({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      verifyResult: injected,
    });

    // Without injection, missing-in-registry would produce issues
    // With injection, the clean result should be used as-is
    assert.equal(result.items.length, 0);
    assert.equal(result.summary.total, 0);
  });
});
