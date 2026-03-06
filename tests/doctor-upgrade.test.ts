import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpgradePlan,
  formatUpgradePlan,
  formatUpgradeResult,
} from '../src/commands/doctor/upgrade.ts';
import type {
  MaturityResult,
  MaturitySignal,
  MaturityLevel,
} from '../src/core/types.ts';
import { MATURITY_LEVEL_LABELS } from '../src/core/types.ts';

/** Helper to create a MaturityResult with specified level and signals */
function maturityResult(
  level: MaturityLevel,
  signalOverrides?: Partial<Record<string, boolean>>,
): MaturityResult {
  const defaultSignals: MaturitySignal[] = [
    { name: 'config', label: 'Config file', detected: false, message: '' },
    { name: 'registry', label: 'Registry file', detected: false, message: '' },
    {
      name: 'gitignore',
      label: '.gitignore entry',
      detected: false,
      message: '',
    },
    { name: 'ci-workflow', label: 'CI workflow', detected: false, message: '' },
    {
      name: 'badge-workflow',
      label: 'Badge workflow',
      detected: false,
      message: '',
    },
    {
      name: 'snapshot-history',
      label: 'Snapshot history',
      detected: false,
      message: '',
    },
    {
      name: 'scheduled-workflow',
      label: 'Scheduled workflow',
      detected: false,
      message: '',
    },
  ];

  // Set signals according to level
  if (level >= 1) {
    for (const s of defaultSignals) {
      if (['config', 'registry', 'gitignore'].includes(s.name)) {
        s.detected = true;
      }
    }
  }
  if (level >= 2) {
    defaultSignals.find((s) => s.name === 'ci-workflow')!.detected = true;
  }
  if (level >= 3) {
    defaultSignals.find((s) => s.name === 'badge-workflow')!.detected = true;
  }
  if (level >= 4) {
    defaultSignals.find((s) => s.name === 'snapshot-history')!.detected = true;
    defaultSignals.find((s) => s.name === 'scheduled-workflow')!.detected =
      true;
  }

  // Apply overrides
  if (signalOverrides) {
    for (const [name, detected] of Object.entries(signalOverrides)) {
      const signal = defaultSignals.find((s) => s.name === name);
      if (signal && detected !== undefined) signal.detected = detected;
    }
  }

  return {
    level,
    levelLabel: MATURITY_LEVEL_LABELS[level],
    signals: defaultSignals,
    nextActions: [],
  };
}

describe('buildUpgradePlan', () => {
  it('returns init action for level 0', () => {
    const plan = buildUpgradePlan(maturityResult(0));
    assert.equal(plan.currentLevel, 0);
    assert.equal(plan.targetLevel, 1);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]!.kind, 'init');
    assert.ok(plan.actions[0]!.command.includes('shiori init'));
  });

  it('returns ci-workflow action for level 1', () => {
    const plan = buildUpgradePlan(maturityResult(1));
    assert.equal(plan.currentLevel, 1);
    assert.equal(plan.targetLevel, 2);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]!.kind, 'ci-workflow');
    assert.equal(plan.actions[0]!.ciTemplateKind, 'basic');
  });

  it('returns badge-workflow action for level 2', () => {
    const plan = buildUpgradePlan(maturityResult(2));
    assert.equal(plan.currentLevel, 2);
    assert.equal(plan.targetLevel, 3);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]!.kind, 'badge-workflow');
    assert.equal(plan.actions[0]!.ciTemplateKind, 'badge');
    assert.equal(plan.actions[0]!.command, 'shiori init --ci badge');
  });

  it('returns snapshot and scheduled actions for level 3', () => {
    const plan = buildUpgradePlan(maturityResult(3));
    assert.equal(plan.currentLevel, 3);
    assert.equal(plan.targetLevel, 4);
    assert.equal(plan.actions.length, 2);
    const kinds = plan.actions.map((a) => a.kind);
    assert.ok(kinds.includes('snapshot-setup'));
    assert.ok(kinds.includes('scheduled-workflow'));
  });

  it('returns only missing actions for level 3 with partial signals', () => {
    // snapshot exists but no scheduled workflow
    const plan = buildUpgradePlan(
      maturityResult(3, { 'snapshot-history': true }),
    );
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]!.kind, 'scheduled-workflow');
  });

  it('returns empty plan for level 4 (max)', () => {
    const plan = buildUpgradePlan(maturityResult(4));
    assert.equal(plan.currentLevel, 4);
    assert.equal(plan.targetLevel, 4);
    assert.equal(plan.actions.length, 0);
  });
});

describe('formatUpgradePlan', () => {
  it('formats plan with actions', () => {
    const plan = buildUpgradePlan(maturityResult(0));
    const text = formatUpgradePlan(plan);
    assert.ok(text.includes('Level 0/4'));
    assert.ok(text.includes('Level 1/4'));
    assert.ok(text.includes('Upgrade actions:'));
    assert.ok(text.includes('Initialize shiori'));
  });

  it('formats max-level plan', () => {
    const plan = buildUpgradePlan(maturityResult(4));
    const text = formatUpgradePlan(plan);
    assert.ok(text.includes('already at maximum'));
    assert.ok(text.includes('No upgrade actions needed'));
  });
});

describe('formatUpgradeResult', () => {
  it('formats successful upgrade result', () => {
    const plan = buildUpgradePlan(maturityResult(0));
    const text = formatUpgradeResult({
      plan,
      actionResults: [
        { kind: 'init', executed: true, message: 'Initialized shiori' },
      ],
      newLevel: 1,
    });
    assert.ok(text.includes('Upgrade complete'));
    assert.ok(text.includes('✓ Initialized shiori'));
    assert.ok(text.includes('Level 0/4 → Level 1/4'));
    assert.ok(text.includes('shiori doctor --upgrade'));
  });

  it('formats result with skipped actions', () => {
    const plan = buildUpgradePlan(maturityResult(3));
    const text = formatUpgradeResult({
      plan,
      actionResults: [
        {
          kind: 'snapshot-setup',
          executed: false,
          message: 'Run shiori health --snapshot',
        },
        {
          kind: 'scheduled-workflow',
          executed: false,
          message: 'Add cron trigger',
        },
      ],
      newLevel: 3,
    });
    assert.ok(text.includes('· Run shiori health'));
    assert.ok(text.includes('· Add cron trigger'));
  });

  it('does not show "run again" hint at level 4', () => {
    const plan = buildUpgradePlan(maturityResult(3));
    const text = formatUpgradeResult({
      plan,
      actionResults: [
        { kind: 'snapshot-setup', executed: true, message: 'Done' },
        { kind: 'scheduled-workflow', executed: true, message: 'Done' },
      ],
      newLevel: 4,
    });
    assert.ok(!text.includes('Run "shiori doctor --upgrade" again'));
  });
});
