/**
 * Scenario tests for verify command.
 *
 * Each scenario uses self-contained fixture directories under
 * tests/fixtures/scenarios/{s1..s7}/ with src/ and .config/shiori/.
 *
 * Tests call scan() + verify() pure functions directly — no CLI wrapper.
 * This validates the core logic pipeline without spawn overhead.
 *
 * Architecture constraint: import only from src/commands/scan.ts and
 * src/commands/verify.ts (pure functions), never from *-cli.ts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { scan } from '../src/commands/scan.ts';
import { verify } from '../src/commands/verify.ts';
import { loadRegistry, loadMultiRegistry } from '../src/core/registry.ts';
import { CommentProvider } from '../src/core/providers/CommentProvider.ts';
import type { RefPatternConfig } from '../src/core/ref-pattern.ts';
import type { VerifyResult, VerifyIssueType } from '../src/core/types.ts';

const SCENARIOS_DIR = new URL('./fixtures/scenarios', import.meta.url).pathname;

const provider = new CommentProvider();

/** Reference date for deterministic expiry checks */
const NOW = new Date('2026-02-15T00:00:00Z');

/**
 * Helper: run scan + verify pipeline for a scenario.
 * Follows Architect's Input/Expected/Actual/Reproduce format on failure.
 */
async function runScenario(
  scenarioName: string,
  options?: {
    failOn?: VerifyIssueType[];
    warnOn?: VerifyIssueType[];
    refPatterns?: RefPatternConfig[];
    useMultiRegistry?: boolean;
  },
): Promise<VerifyResult> {
  const scenarioDir = join(SCENARIOS_DIR, scenarioName);
  const registryPath = join(scenarioDir, '.config', 'shiori', 'registry.json');

  // Step 1: scan source files
  const scanResult = await scan({
    patterns: ['src/**/*.ts'],
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    provider,
    cwd: scenarioDir,
  });

  // Step 2: load registry
  let registry;
  let duplicates;
  let refOrigins;

  if (options?.useMultiRegistry && options.refPatterns) {
    const multiResult = await loadMultiRegistry(
      registryPath,
      options.refPatterns,
      join(scenarioDir, '.config', 'shiori'),
    );
    registry = multiResult.registry;
    duplicates = multiResult.duplicates;
    refOrigins = multiResult.refOrigins;
  } else {
    const loadResult = await loadRegistry(registryPath);
    registry = loadResult.registry;
  }

  // Step 3: verify
  return verify({
    records: scanResult.annotations,
    registry,
    failOn: options?.failOn ?? ['missing-in-registry', 'expired'],
    warnOn: options?.warnOn ?? ['unused-in-source', 'syntax-error'],
    now: NOW,
    duplicates,
    refPatterns: options?.refPatterns,
    refOrigins,
  });
}

/** Count issues of a given type */
function countIssueType(result: VerifyResult, type: VerifyIssueType): number {
  return result.issues.filter((i) => i.type === type).length;
}

describe('scenario tests: scan + verify pipeline', () => {
  describe('s1: happy path — all annotations match registry', () => {
    it('produces zero issues when source and registry are in sync', async () => {
      const result = await runScenario('s1');

      assert.equal(
        result.issues.length,
        0,
        formatFailure({
          scenario: 's1',
          expected: '0 issues (all refs in registry, none expired)',
          actual: `${result.issues.length} issues: ${JSON.stringify(result.issues)}`,
        }),
      );
      assert.equal(result.summary.errors, 0);
      assert.equal(result.summary.warnings, 0);
      assert.ok(result.scannedRecords > 0, 'should have scanned records');
      assert.ok(result.registryEntries > 0, 'should have registry entries');
    });
  });

  describe('s2: missing-in-registry detection', () => {
    it('detects annotation ref not present in registry', async () => {
      const result = await runScenario('s2');

      const missing = result.issues.filter(
        (i) => i.type === 'missing-in-registry',
      );
      assert.equal(
        missing.length,
        1,
        formatFailure({
          scenario: 's2',
          expected: '1 missing-in-registry for SUP-MISSING',
          actual: `${missing.length} missing issues: ${JSON.stringify(missing)}`,
        }),
      );
      assert.equal(missing[0]!.ref, 'SUP-MISSING');
      assert.equal(missing[0]!.severity, 'error');
    });
  });

  describe('s3: unused-in-source detection', () => {
    it('detects registry entry with no corresponding source annotation', async () => {
      const result = await runScenario('s3');

      const unused = result.issues.filter((i) => i.type === 'unused-in-source');
      assert.equal(
        unused.length,
        1,
        formatFailure({
          scenario: 's3',
          expected: '1 unused-in-source for SUP-STALE',
          actual: `${unused.length} unused issues: ${JSON.stringify(unused)}`,
        }),
      );
      assert.equal(unused[0]!.ref, 'SUP-STALE');
      assert.equal(unused[0]!.severity, 'warning');
    });
  });

  describe('s4: expired detection', () => {
    it('detects registry entry past expiration date', async () => {
      const result = await runScenario('s4');

      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(
        expired.length,
        1,
        formatFailure({
          scenario: 's4',
          expected: '1 expired for SUP-300 (expires 2025-06-01)',
          actual: `${expired.length} expired issues: ${JSON.stringify(expired)}`,
        }),
      );
      assert.equal(expired[0]!.ref, 'SUP-300');
      assert.equal(expired[0]!.severity, 'error');
    });
  });

  describe('s5: multi-registry with ref-collision', () => {
    it('detects duplicate ref across default and pattern registries', async () => {
      const refPatterns: RefPatternConfig[] = [
        {
          match: 'JIRA-{id}',
          registryFile: 'jira-registry.json',
        },
      ];

      const result = await runScenario('s5', {
        refPatterns,
        useMultiRegistry: true,
        failOn: ['missing-in-registry'],
        warnOn: ['ref-collision', 'unused-in-source'],
      });

      // JIRA-DUP exists in both registry.json and jira-registry.json
      const collisions = result.issues.filter(
        (i) => i.type === 'ref-collision',
      );
      assert.equal(
        collisions.length,
        1,
        formatFailure({
          scenario: 's5',
          expected: '1 ref-collision for JIRA-DUP',
          actual: `${collisions.length} collision issues: ${JSON.stringify(collisions)}`,
        }),
      );
      assert.equal(collisions[0]!.ref, 'JIRA-DUP');

      // All refs should be in registry (no missing)
      assert.equal(countIssueType(result, 'missing-in-registry'), 0);
    });
  });

  describe('s6: namespace resolution with unrouted-ref', () => {
    it('detects ref that does not match any configured pattern', async () => {
      const refPatterns: RefPatternConfig[] = [
        { match: 'ADR:{id}' },
        { match: 'SUP-{id}' },
      ];

      const result = await runScenario('s6', {
        refPatterns,
        failOn: ['missing-in-registry'],
        warnOn: ['unrouted-ref'],
      });

      // UNKNOWN-999 does not match ADR:{id} or SUP-{id}
      const unrouted = result.issues.filter((i) => i.type === 'unrouted-ref');
      assert.equal(
        unrouted.length,
        1,
        formatFailure({
          scenario: 's6',
          expected: '1 unrouted-ref for UNKNOWN-999',
          actual: `${unrouted.length} unrouted issues: ${JSON.stringify(unrouted)}`,
        }),
      );
      assert.equal(unrouted[0]!.ref, 'UNKNOWN-999');

      // ADR:0007 and SUP-500 should match patterns — no issues
      assert.equal(countIssueType(result, 'missing-in-registry'), 0);
    });
  });

  describe('s7: compound issues — expired + missing + syntax-error', () => {
    it('detects multiple issue types in a single scenario', async () => {
      const result = await runScenario('s7');

      // SUP-600 is expired (2025-01-15)
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.equal(
        expired.length,
        1,
        formatFailure({
          scenario: 's7',
          expected: '1 expired for SUP-600',
          actual: `${expired.length} expired: ${JSON.stringify(expired)}`,
        }),
      );
      assert.equal(expired[0]!.ref, 'SUP-600');

      // SUP-NEW-MISSING is not in registry
      const missing = result.issues.filter(
        (i) => i.type === 'missing-in-registry',
      );
      assert.equal(
        missing.length,
        1,
        formatFailure({
          scenario: 's7',
          expected: '1 missing-in-registry for SUP-NEW-MISSING',
          actual: `${missing.length} missing: ${JSON.stringify(missing)}`,
        }),
      );
      assert.equal(missing[0]!.ref, 'SUP-NEW-MISSING');

      // "ref=BAD" produces a syntax error (ref= is not valid)
      const syntaxErrors = result.issues.filter(
        (i) => i.type === 'syntax-error',
      );
      assert.ok(
        syntaxErrors.length >= 1,
        formatFailure({
          scenario: 's7',
          expected: '>=1 syntax-error for ref=BAD',
          actual: `${syntaxErrors.length} syntax-errors: ${JSON.stringify(syntaxErrors)}`,
        }),
      );

      // Total: at least 3 issues
      assert.ok(
        result.summary.total >= 3,
        `Expected at least 3 issues, got ${result.summary.total}`,
      );
    });
  });
});

/**
 * Format a failure message following Architect's
 * Input/Expected/Actual/Reproduce pattern.
 */
function formatFailure(opts: {
  scenario: string;
  expected: string;
  actual: string;
}): string {
  return [
    `Scenario: ${opts.scenario}`,
    `Expected: ${opts.expected}`,
    `Actual: ${opts.actual}`,
    `Reproduce: node --experimental-strip-types --test tests/scenarios.test.ts`,
  ].join('\n');
}
