import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ShioriAnnotation,
  RegistryEntry,
  ShioriCandidate,
  ScanResult,
  ReportResult,
} from '../src/core/types.ts';
import {
  planFixActions,
  type FixPlan,
  type FixApplyResult,
} from '../src/commands/fix.ts';
import {
  formatFixPlan,
  formatFixPlanJson,
  formatFixPlanMarkdown,
  formatFixApplyResult,
  formatFixApplyResultJson,
} from '../src/formatters/fix-formatter.ts';
import { report } from '../src/commands/report.ts';
import { VERSION } from '../src/core/version.ts';

// ── Helpers ──────────────────────────────────────────────────

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
    target: 'test.ts',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
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

function makeReport(options: {
  annotations?: ShioriAnnotation[];
  candidates?: ShioriCandidate[];
  registry?: Record<string, RegistryEntry>;
  now?: Date;
}): ReportResult {
  return report({
    scanResult: makeScanResult(
      options.annotations ?? [],
      options.candidates ?? [],
    ),
    registry: options.registry ?? {},
    failOn: [],
    warnOn: [],
    now: options.now,
  });
}

// ── planFixActions ───────────────────────────────────────────

describe('planFixActions', () => {
  it('returns empty plan for healthy codebase', () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: 'TEST-001' })],
      registry: { 'TEST-001': makeRegistryEntry() },
    });

    const plan = planFixActions(reportResult);
    assert.equal(plan.actions.length, 0);
    assert.equal(plan.manualSuggestions.length, 0);
    assert.equal(plan.summary.automatable, 0);
    assert.equal(plan.summary.manual, 0);
  });

  it('creates update action for missing-in-registry issues', () => {
    const reportResult = makeReport({
      annotations: [
        makeAnnotation({ ref: 'NEW-001' }),
        makeAnnotation({ ref: 'NEW-002' }),
      ],
      registry: {},
    });

    const plan = planFixActions(reportResult);
    assert.equal(plan.actions.length, 1);
    const action = plan.actions[0]!;
    assert.equal(action.type, 'update');
    assert.ok(action.refs.includes('NEW-001'));
    assert.ok(action.refs.includes('NEW-002'));
    assert.equal(plan.summary.automatable, 1);
  });

  it('deduplicates refs in update action', () => {
    const reportResult = makeReport({
      annotations: [
        makeAnnotation({ ref: 'DUP-001', location: { file: 'a.ts', line: 1 } }),
        makeAnnotation({ ref: 'DUP-001', location: { file: 'b.ts', line: 2 } }),
      ],
      registry: {},
    });

    const plan = planFixActions(reportResult);
    assert.equal(plan.actions.length, 1);
    const action = plan.actions[0]!;
    assert.equal(action.refs.length, 1);
    assert.equal(action.refs[0], 'DUP-001');
  });

  it('creates manual suggestions for expired issues', () => {
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: 'EXP-001' })],
      registry: { 'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }) },
    });

    const plan = planFixActions(reportResult);
    assert.equal(plan.actions.length, 0);
    const expired = plan.manualSuggestions.find(
      (s) => s.issueType === 'expired',
    );
    assert.ok(expired);
    assert.equal(expired.count, 1);
    assert.ok(expired.command.includes('triage'));
  });

  it('creates manual suggestions for unused-in-source issues', () => {
    const reportResult = makeReport({
      annotations: [],
      registry: { 'STALE-001': makeRegistryEntry() },
    });

    const plan = planFixActions(reportResult);
    const unused = plan.manualSuggestions.find(
      (s) => s.issueType === 'unused-in-source',
    );
    assert.ok(unused);
    assert.equal(unused.count, 1);
    assert.ok(unused.command.includes('resolve'));
  });

  it('handles mixed automatable and manual issues', () => {
    const reportResult = makeReport({
      annotations: [
        makeAnnotation({ ref: 'NEW-001' }),
        makeAnnotation({ ref: 'EXP-001' }),
      ],
      registry: {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      },
    });

    const plan = planFixActions(reportResult);
    assert.equal(plan.actions.length, 1, 'should have 1 automatable action');
    assert.equal(plan.actions[0]!.type, 'update');
    assert.ok(
      plan.manualSuggestions.length >= 1,
      'should have at least 1 manual suggestion',
    );
    assert.equal(plan.summary.automatable, 1);
    assert.ok(plan.summary.manual >= 1);
  });

  it('creates suggestion for expiring-soon issues', () => {
    // Use a date that's 7 days from "now" (within default 14-day threshold)
    const now = new Date('2026-01-01');
    const soonDate = '2026-01-08';
    const reportResult = makeReport({
      annotations: [makeAnnotation({ ref: 'SOON-001' })],
      registry: { 'SOON-001': makeRegistryEntry({ expires: soonDate }) },
      now,
    });

    const plan = planFixActions(reportResult);
    const expiring = plan.manualSuggestions.find(
      (s) => s.issueType === 'expiring-soon',
    );
    assert.ok(expiring);
    assert.ok(expiring.command.includes('triage'));
  });
});

// ── formatFixPlan ───────────────────────────────────────────

describe('formatFixPlan', () => {
  it('formats plan with automatable actions', () => {
    const plan: FixPlan = {
      actions: [
        {
          type: 'update',
          description: 'Add 2 missing ref(s) to registry',
          refs: ['A', 'B'],
        },
      ],
      manualSuggestions: [],
      summary: { automatable: 1, manual: 0 },
    };

    const output = formatFixPlan(plan);
    assert.ok(output.includes('Fix Plan'));
    assert.ok(output.includes('update'));
    assert.ok(output.includes('--apply'));
  });

  it('formats plan with no automatable actions', () => {
    const plan: FixPlan = {
      actions: [],
      manualSuggestions: [
        {
          issueType: 'expired',
          count: 2,
          command: 'shiori triage',
          message: '2 expired',
        },
      ],
      summary: { automatable: 0, manual: 1 },
    };

    const output = formatFixPlan(plan);
    assert.ok(output.includes('No automatable fix'));
    assert.ok(output.includes('Manual actions'));
  });

  it('formats plan with both actions and suggestions', () => {
    const plan: FixPlan = {
      actions: [{ type: 'update', description: 'Add 1 ref', refs: ['A'] }],
      manualSuggestions: [
        {
          issueType: 'expired',
          count: 1,
          command: 'shiori triage',
          message: '1 expired',
        },
      ],
      summary: { automatable: 1, manual: 1 },
    };

    const output = formatFixPlan(plan);
    assert.ok(output.includes('Fix Plan'));
    assert.ok(output.includes('Manual actions'));
  });
});

// ── formatFixPlanJson ───────────────────────────────────────

describe('formatFixPlanJson', () => {
  it('returns valid JSON with ADR 028 envelope', () => {
    const plan: FixPlan = {
      actions: [{ type: 'update', description: 'test', refs: ['A'] }],
      manualSuggestions: [],
      summary: { automatable: 1, manual: 0 },
    };

    const json = formatFixPlanJson(plan);
    const parsed = JSON.parse(json);

    // Envelope meta (ADR 028)
    assert.equal(parsed.meta.command, 'fix');
    assert.equal(parsed.meta.schemaVersion, 1);
    assert.equal(parsed.meta.version, VERSION);

    // Data payload
    assert.equal(parsed.data.actions.length, 1);
    assert.equal(parsed.data.summary.automatable, 1);
  });
});

// ── formatFixPlanMarkdown ────────────────────────────────────

describe('formatFixPlanMarkdown', () => {
  it('returns empty string when no actions and no suggestions', () => {
    const plan: FixPlan = {
      actions: [],
      manualSuggestions: [],
      summary: { automatable: 0, manual: 0 },
    };

    const output = formatFixPlanMarkdown(plan);
    assert.equal(output, '');
  });

  it('renders collapsed details with automatable actions table', () => {
    const plan: FixPlan = {
      actions: [
        {
          type: 'update',
          description: 'Add 2 missing ref(s) to registry',
          refs: ['A', 'B'],
        },
      ],
      manualSuggestions: [],
      summary: { automatable: 1, manual: 0 },
    };

    const output = formatFixPlanMarkdown(plan);
    assert.ok(output.includes('<details>'));
    assert.ok(output.includes('</details>'));
    assert.ok(output.includes('<summary>'));
    assert.ok(output.includes('Fix Preview'));
    assert.ok(output.includes('Automatable Fixes'));
    assert.ok(output.includes('| update |'));
    assert.ok(output.includes('| 2 |'));
    assert.ok(output.includes('shiori fix --apply'));
  });

  it('renders manual suggestions when no automatable actions', () => {
    const plan: FixPlan = {
      actions: [],
      manualSuggestions: [
        {
          issueType: 'expired',
          count: 3,
          command: 'shiori triage --expired-only',
          message: '3 expired issue(s)',
        },
      ],
      summary: { automatable: 0, manual: 1 },
    };

    const output = formatFixPlanMarkdown(plan);
    assert.ok(output.includes('<details>'));
    assert.ok(output.includes('</details>'));
    assert.ok(output.includes('Manual Actions Required'));
    assert.ok(output.includes('`shiori triage --expired-only`'));
    assert.ok(!output.includes('Automatable Fixes'));
  });

  it('renders both actions and suggestions', () => {
    const plan: FixPlan = {
      actions: [{ type: 'update', description: 'Add 1 ref', refs: ['A'] }],
      manualSuggestions: [
        {
          issueType: 'expired',
          count: 1,
          command: 'shiori triage',
          message: '1 expired',
        },
      ],
      summary: { automatable: 1, manual: 1 },
    };

    const output = formatFixPlanMarkdown(plan);
    assert.ok(output.includes('Automatable Fixes'));
    assert.ok(output.includes('Manual Actions Required'));
    assert.ok(output.includes('shiori fix --apply'));
    assert.ok(output.includes('`shiori triage`'));
  });

  it('renders multiple actions in table', () => {
    const plan: FixPlan = {
      actions: [
        { type: 'update', description: 'Add 2 ref(s)', refs: ['A', 'B'] },
        { type: 'update', description: 'Add 1 ref(s)', refs: ['C'] },
      ],
      manualSuggestions: [],
      summary: { automatable: 2, manual: 0 },
    };

    const output = formatFixPlanMarkdown(plan);
    const tableRows = output
      .split('\n')
      .filter((line) => line.startsWith('| update'));
    assert.equal(tableRows.length, 2);
  });
});

// ── formatFixApplyResult ────────────────────────────────────

describe('formatFixApplyResult', () => {
  it('formats successful apply with score delta', () => {
    const result: FixApplyResult = {
      applied: [
        {
          type: 'update',
          description: 'Added 3 ref(s)',
          refs: ['A', 'B', 'C'],
        },
      ],
      registryChanges: { added: ['A', 'B', 'C'] },
      scoreBefore: 60,
      scoreAfter: 75,
    };

    const output = formatFixApplyResult(result);
    assert.ok(output.includes('Fix applied'));
    assert.ok(output.includes('60'));
    assert.ok(output.includes('75'));
    assert.ok(output.includes('+15'));
    assert.ok(output.includes('A, B, C'));
  });

  it('formats zero delta correctly', () => {
    const result: FixApplyResult = {
      applied: [{ type: 'update', description: 'No change', refs: [] }],
      registryChanges: { added: [] },
      scoreBefore: 80,
      scoreAfter: 80,
    };

    const output = formatFixApplyResult(result);
    assert.ok(output.includes('80'));
    assert.ok(output.includes('+0'));
  });
});

// ── formatFixApplyResultJson ────────────────────────────────

describe('formatFixApplyResultJson', () => {
  it('returns valid JSON with ADR 028 envelope', () => {
    const result: FixApplyResult = {
      applied: [{ type: 'update', description: 'test', refs: ['A'] }],
      registryChanges: { added: ['A'] },
      scoreBefore: 50,
      scoreAfter: 70,
    };

    const json = formatFixApplyResultJson(result);
    const parsed = JSON.parse(json);

    // Envelope meta (ADR 028)
    assert.equal(parsed.meta.command, 'fix');
    assert.equal(parsed.meta.schemaVersion, 1);
    assert.equal(parsed.meta.version, VERSION);

    // Data payload
    assert.equal(parsed.data.scoreBefore, 50);
    assert.equal(parsed.data.scoreAfter, 70);
    assert.deepEqual(parsed.data.registryChanges.added, ['A']);
  });
});
