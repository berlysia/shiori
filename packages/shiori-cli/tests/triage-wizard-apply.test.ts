import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planWizardActions,
  formatWizardApplyPreview,
  formatWizardCompletionSummary,
  type WizardApplyOptions,
} from '../src/commands/triage-wizard-apply.ts';
import type { WizardItemResult } from '../src/commands/triage-interactive.ts';
import type {
  Registry,
  ScanResult,
  ShioriAnnotation,
} from '../src/core/types.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeAnnotation(
  ref: string,
  file: string,
  line: number,
): ShioriAnnotation {
  return {
    ref,
    location: { file, line },
    tagged: true,
    ignored: false,
    rule: 'no-console',
  };
}

function makeScanResult(annotations: ShioriAnnotation[]): ScanResult {
  return {
    annotations,
    candidates: [],
    filesScanned: 10,
  };
}

function makeRegistry(
  entries: Record<string, { reason: string; expires?: string }>,
): Registry {
  const registry: Registry = {};
  for (const [ref, data] of Object.entries(entries)) {
    registry[ref] = {
      reason: data.reason,
      target: 'test.ts',
      expires: data.expires,
      ticket: undefined,
      owner: undefined,
      notes: undefined,
      kind: 'intentional',
    };
  }
  return registry;
}

function makeFileContents(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}

// ── planWizardActions tests ──────────────────────────────────

describe('planWizardActions', () => {
  it('plans resolve-only actions', () => {
    const annotations = [
      makeAnnotation('REF-001', 'src/a.ts', 5),
      makeAnnotation('REF-001', 'src/b.ts', 10),
    ];
    const registry = makeRegistry({ 'REF-001': { reason: 'test' } });
    const fileContents = makeFileContents({
      'src/a.ts':
        'line1\nline2\nline3\nline4\n// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test")',
      'src/b.ts':
        'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\n// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test2")',
    });

    const processed: WizardItemResult[] = [
      { ref: 'REF-001', choice: 'act', actionType: 'resolve' },
    ];

    const plan = planWizardActions({
      processed,
      scanResult: makeScanResult(annotations),
      registry,
      fileContents,
    });

    assert.equal(plan.summary.resolveCount, 1);
    assert.equal(plan.summary.extendCount, 0);
    assert.equal(plan.summary.manualCount, 0);
    assert.ok(plan.resolves.allRegistryRemovals.includes('REF-001'));
    assert.equal(plan.extends.length, 0);
    // registryAfter should not contain REF-001
    assert.equal(plan.registryAfter['REF-001'], undefined);
  });

  it('plans extend-only actions', () => {
    const registry = makeRegistry({
      'REF-002': { reason: 'test', expires: '2026-01' },
    });

    const processed: WizardItemResult[] = [
      {
        ref: 'REF-002',
        choice: 'act',
        actionType: 'extend',
        newExpires: '2026-04',
      },
    ];

    const plan = planWizardActions({
      processed,
      scanResult: makeScanResult([]),
      registry,
      fileContents: makeFileContents({}),
    });

    assert.equal(plan.summary.resolveCount, 0);
    assert.equal(plan.summary.extendCount, 1);
    assert.equal(plan.summary.manualCount, 0);
    assert.equal(plan.extends.length, 1);
    assert.equal(plan.extends[0]!.ref, 'REF-002');
    assert.equal(plan.extends[0]!.oldExpires, '2026-01');
    assert.equal(plan.extends[0]!.newExpires, '2026-04');
    // registryAfter should have updated expires
    assert.equal(plan.registryAfter['REF-002']!.expires, '2026-04');
  });

  it('plans mixed resolve and extend actions', () => {
    const annotations = [makeAnnotation('REF-001', 'src/a.ts', 5)];
    const registry = makeRegistry({
      'REF-001': { reason: 'resolve me' },
      'REF-002': { reason: 'extend me', expires: '2026-03' },
    });
    const fileContents = makeFileContents({
      'src/a.ts':
        'line1\nline2\nline3\nline4\n// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test")',
    });

    const processed: WizardItemResult[] = [
      { ref: 'REF-001', choice: 'act', actionType: 'resolve' },
      {
        ref: 'REF-002',
        choice: 'act',
        actionType: 'extend',
        newExpires: '2026-06',
      },
    ];

    const plan = planWizardActions({
      processed,
      scanResult: makeScanResult(annotations),
      registry,
      fileContents,
    });

    assert.equal(plan.summary.resolveCount, 1);
    assert.equal(plan.summary.extendCount, 1);
    assert.equal(plan.summary.manualCount, 0);
    assert.equal(plan.registryAfter['REF-001'], undefined);
    assert.equal(plan.registryAfter['REF-002']!.expires, '2026-06');
  });

  it('counts items without actionType as manual', () => {
    const registry = makeRegistry({ 'REF-003': { reason: 'manual' } });

    const processed: WizardItemResult[] = [
      { ref: 'REF-003', choice: 'act' },
      { ref: 'REF-004', choice: 'skip' },
    ];

    const plan = planWizardActions({
      processed,
      scanResult: makeScanResult([]),
      registry,
      fileContents: makeFileContents({}),
    });

    assert.equal(plan.summary.resolveCount, 0);
    assert.equal(plan.summary.extendCount, 0);
    assert.equal(plan.summary.manualCount, 1);
  });

  it('ignores skipped and deferred items', () => {
    const registry = makeRegistry({
      'REF-A': { reason: 'skip' },
      'REF-B': { reason: 'defer' },
    });

    const processed: WizardItemResult[] = [
      { ref: 'REF-A', choice: 'skip' },
      { ref: 'REF-B', choice: 'defer' },
    ];

    const plan = planWizardActions({
      processed,
      scanResult: makeScanResult([]),
      registry,
      fileContents: makeFileContents({}),
    });

    assert.equal(plan.summary.resolveCount, 0);
    assert.equal(plan.summary.extendCount, 0);
    assert.equal(plan.summary.manualCount, 0);
    // Registry unchanged
    assert.ok(plan.registryAfter['REF-A'] !== undefined);
    assert.ok(plan.registryAfter['REF-B'] !== undefined);
  });
});

// ── formatWizardApplyPreview tests ───────────────────────────

describe('formatWizardApplyPreview', () => {
  it('shows "No executable actions" when plan is empty', () => {
    const plan = planWizardActions({
      processed: [],
      scanResult: makeScanResult([]),
      registry: makeRegistry({}),
      fileContents: makeFileContents({}),
    });

    const preview = formatWizardApplyPreview(plan);
    assert.ok(preview.includes('No executable actions'));
  });

  it('shows manual follow-up count when no executable actions', () => {
    const plan = planWizardActions({
      processed: [{ ref: 'REF-001', choice: 'act' }],
      scanResult: makeScanResult([]),
      registry: makeRegistry({}),
      fileContents: makeFileContents({}),
    });

    const preview = formatWizardApplyPreview(plan);
    assert.ok(preview.includes('1 item(s) require manual follow-up'));
  });

  it('includes resolve and extend sections', () => {
    const annotations = [makeAnnotation('REF-001', 'src/a.ts', 5)];
    const registry = makeRegistry({
      'REF-001': { reason: 'resolve me' },
      'REF-002': { reason: 'extend me', expires: '2026-01' },
    });
    const fileContents = makeFileContents({
      'src/a.ts':
        'line1\nline2\nline3\nline4\n// eslint-disable-next-line no-console -- shiori: REF-001\nconsole.log("test")',
    });

    const plan = planWizardActions({
      processed: [
        { ref: 'REF-001', choice: 'act', actionType: 'resolve' },
        {
          ref: 'REF-002',
          choice: 'act',
          actionType: 'extend',
          newExpires: '2026-04',
        },
      ],
      scanResult: makeScanResult(annotations),
      registry,
      fileContents,
    });

    const preview = formatWizardApplyPreview(plan);
    assert.ok(preview.includes('Resolve (1 ref(s))'));
    assert.ok(preview.includes('Extend expires (1 ref(s))'));
    assert.ok(preview.includes('REF-002: 2026-01 → 2026-04'));
  });
});

// ── formatWizardCompletionSummary tests ──────────────────────

describe('formatWizardCompletionSummary', () => {
  it('shows score delta and counts', () => {
    const summary = formatWizardCompletionSummary({
      beforeScore: 60,
      afterScore: 75,
      resolveCount: 2,
      extendCount: 1,
      manualCount: 0,
    });

    assert.ok(summary.includes('75/100'));
    assert.ok(summary.includes('+15'));
    assert.ok(summary.includes('Resolved: 2'));
    assert.ok(summary.includes('Extended: 1'));
  });

  it('shows negative delta', () => {
    const summary = formatWizardCompletionSummary({
      beforeScore: 80,
      afterScore: 70,
      resolveCount: 0,
      extendCount: 0,
      manualCount: 1,
    });

    assert.ok(summary.includes('70/100'));
    assert.ok(summary.includes('-10'));
    assert.ok(summary.includes('Manual follow-up: 1'));
  });

  it('shows zero delta with +0', () => {
    const summary = formatWizardCompletionSummary({
      beforeScore: 80,
      afterScore: 80,
      resolveCount: 0,
      extendCount: 1,
      manualCount: 0,
    });

    assert.ok(summary.includes('+0'));
  });

  it('includes health emoji', () => {
    const summary = formatWizardCompletionSummary({
      beforeScore: 50,
      afterScore: 90,
      resolveCount: 3,
      extendCount: 0,
      manualCount: 0,
    });

    // Should contain emoji (non-ASCII characters from healthEmoji)
    assert.ok(summary.includes('Governance'));
    assert.ok(summary.includes('90/100'));
  });
});
