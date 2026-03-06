import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assessMaturity } from '../src/commands/doctor/maturity.ts';
import { formatMaturityText } from '../src/commands/doctor.ts';
import type { ConfigLoadResult } from '../src/commands/doctor/types.ts';
import type { ResolvedConfig } from '../src/core/config.ts';

async function createTempDir(prefix: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Create a minimal config load result for testing */
function configResult(config?: Partial<ResolvedConfig>): ConfigLoadResult {
  if (!config) return { config: undefined };
  return { config: config as unknown as ResolvedConfig };
}

/** Helper to set up a project with various maturity signals */
async function setupMaturityProject(
  dir: string,
  options?: {
    config?: boolean;
    registry?: boolean;
    gitignore?: boolean;
    ciWorkflow?: boolean;
    badgeWorkflow?: boolean;
    snapshotHistory?: boolean;
    scheduledWorkflow?: boolean;
  },
): Promise<ConfigLoadResult> {
  const configDir = join(dir, '.config', 'shiori');
  await mkdir(configDir, { recursive: true });

  let result: ConfigLoadResult;

  if (options?.config !== false) {
    await writeFile(
      join(configDir, 'config.yaml'),
      '# shiori config\n',
      'utf-8',
    );
    result = configResult({
      paths: {
        scanResult: '.config/shiori/scan-result.json',
        registry: '.config/shiori/registry.json',
      },
    });
  } else {
    result = configResult();
  }

  if (options?.registry !== false) {
    await writeFile(
      join(configDir, 'registry.json'),
      JSON.stringify({}, null, 2),
      'utf-8',
    );
  }

  if (options?.gitignore !== false) {
    await writeFile(
      join(dir, '.gitignore'),
      '.config/shiori/scan-result.json\n',
      'utf-8',
    );
  }

  if (options?.ciWorkflow) {
    const workflowDir = join(dir, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, 'ci.yml'),
      'name: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: shiori verify\n',
      'utf-8',
    );
  }

  if (options?.badgeWorkflow) {
    const workflowDir = join(dir, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, 'badge.yml'),
      'name: shiori badge\non: push\njobs:\n  badge:\n    runs-on: ubuntu-latest\n    steps:\n      - run: shiori report --format badge\n',
      'utf-8',
    );
  }

  if (options?.scheduledWorkflow) {
    const workflowDir = join(dir, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, 'scheduled.yml'),
      'name: shiori monitor\non:\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  monitor:\n    runs-on: ubuntu-latest\n    steps:\n      - run: shiori health\n',
      'utf-8',
    );
  }

  if (options?.snapshotHistory) {
    const snapshotsDir = join(configDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });
    await writeFile(
      join(snapshotsDir, '2026-03-01T00-00-00Z.json'),
      JSON.stringify({
        timestamp: '2026-03-01T00:00:00Z',
        health: { level: 'healthy', score: 90 },
      }),
      'utf-8',
    );
  }

  return result;
}

describe('assessMaturity', () => {
  it('returns level 0 for empty project', async () => {
    const { dir, cleanup } = await createTempDir('maturity-empty-');
    try {
      const result = await assessMaturity(dir, configResult());
      assert.equal(result.level, 0);
      assert.equal(result.levelLabel, 'Not initialized');
      assert.ok(result.signals.length > 0);
      assert.ok(result.nextActions.length > 0);
      // Should recommend shiori init
      assert.ok(
        result.nextActions.some((a) => a.action.includes('shiori init')),
      );
    } finally {
      await cleanup();
    }
  });

  it('returns level 1 for basic setup (config + registry + gitignore)', async () => {
    const { dir, cleanup } = await createTempDir('maturity-basic-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 1);
      assert.equal(result.levelLabel, 'Basic setup');
      // Should recommend CI workflow
      assert.ok(result.nextActions.some((a) => a.targetLevel === 2));
    } finally {
      await cleanup();
    }
  });

  it('returns level 0 when config is missing', async () => {
    const { dir, cleanup } = await createTempDir('maturity-no-config-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: false,
        registry: true,
        gitignore: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 0);
    } finally {
      await cleanup();
    }
  });

  it('returns level 0 when registry is missing', async () => {
    const { dir, cleanup } = await createTempDir('maturity-no-reg-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: false,
        gitignore: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 0);
    } finally {
      await cleanup();
    }
  });

  it('returns level 2 for CI integrated project', async () => {
    const { dir, cleanup } = await createTempDir('maturity-ci-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
        ciWorkflow: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 2);
      assert.equal(result.levelLabel, 'CI integrated');
      // Should recommend badge workflow
      assert.ok(result.nextActions.some((a) => a.targetLevel === 3));
    } finally {
      await cleanup();
    }
  });

  it('returns level 3 for project with badge workflow', async () => {
    const { dir, cleanup } = await createTempDir('maturity-badge-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
        ciWorkflow: true,
        badgeWorkflow: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 3);
      assert.equal(result.levelLabel, 'Visible governance');
      // Should recommend snapshot + scheduled workflow
      assert.ok(result.nextActions.length > 0);
    } finally {
      await cleanup();
    }
  });

  it('returns level 4 for fully mature project', async () => {
    const { dir, cleanup } = await createTempDir('maturity-full-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
        ciWorkflow: true,
        badgeWorkflow: true,
        snapshotHistory: true,
        scheduledWorkflow: true,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 4);
      assert.equal(result.levelLabel, 'Continuous monitoring');
      // No next actions at max level
      assert.equal(result.nextActions.length, 0);
    } finally {
      await cleanup();
    }
  });

  it('detects all signals correctly', async () => {
    const { dir, cleanup } = await createTempDir('maturity-signals-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
        ciWorkflow: true,
        badgeWorkflow: true,
        snapshotHistory: true,
        scheduledWorkflow: true,
      });
      const result = await assessMaturity(dir, cr);

      assert.equal(result.signals.length, 7);

      const signalMap = new Map(result.signals.map((s) => [s.name, s]));
      assert.equal(signalMap.get('config')?.detected, true);
      assert.equal(signalMap.get('registry')?.detected, true);
      assert.equal(signalMap.get('gitignore')?.detected, true);
      assert.equal(signalMap.get('ci-workflow')?.detected, true);
      assert.equal(signalMap.get('badge-workflow')?.detected, true);
      assert.equal(signalMap.get('snapshot-history')?.detected, true);
      assert.equal(signalMap.get('scheduled-workflow')?.detected, true);
    } finally {
      await cleanup();
    }
  });

  it('returns level 3 when snapshots exist but no scheduled workflow', async () => {
    const { dir, cleanup } = await createTempDir('maturity-no-sched-');
    try {
      const cr = await setupMaturityProject(dir, {
        config: true,
        registry: true,
        gitignore: true,
        ciWorkflow: true,
        badgeWorkflow: true,
        snapshotHistory: true,
        scheduledWorkflow: false,
      });
      const result = await assessMaturity(dir, cr);
      assert.equal(result.level, 3);
      // Should recommend scheduled workflow
      assert.ok(result.nextActions.some((a) => a.action.includes('scheduled')));
    } finally {
      await cleanup();
    }
  });
});

describe('formatMaturityText', () => {
  it('formats level 0 result', () => {
    const output = formatMaturityText({
      level: 0,
      levelLabel: 'Not initialized',
      signals: [
        {
          name: 'config',
          label: 'Config file',
          detected: false,
          message: 'No config file found',
        },
        {
          name: 'registry',
          label: 'Registry file',
          detected: false,
          message: 'Registry file not found',
        },
      ],
      nextActions: [
        {
          targetLevel: 1,
          action: 'shiori init',
          description: 'Initialize shiori configuration',
        },
      ],
    });

    assert.ok(output.includes('Level 0/4'));
    assert.ok(output.includes('Not initialized'));
    assert.ok(output.includes('░░░░'));
    assert.ok(output.includes('· Config file'));
    assert.ok(output.includes('shiori init'));
  });

  it('formats level 4 result with full bar', () => {
    const output = formatMaturityText({
      level: 4,
      levelLabel: 'Continuous monitoring',
      signals: [
        {
          name: 'config',
          label: 'Config file',
          detected: true,
          message: 'Found',
        },
      ],
      nextActions: [],
    });

    assert.ok(output.includes('Level 4/4'));
    assert.ok(output.includes('████'));
    assert.ok(output.includes('Continuous monitoring'));
    assert.ok(!output.includes('Next steps'));
  });

  it('formats partial level with progress bar', () => {
    const output = formatMaturityText({
      level: 2,
      levelLabel: 'CI integrated',
      signals: [
        {
          name: 'config',
          label: 'Config file',
          detected: true,
          message: 'Found',
        },
        {
          name: 'ci-workflow',
          label: 'CI workflow',
          detected: true,
          message: 'Found',
        },
        {
          name: 'badge-workflow',
          label: 'Badge workflow',
          detected: false,
          message: 'Not found',
        },
      ],
      nextActions: [
        {
          targetLevel: 3,
          action: 'shiori report --format badge',
          description: 'Add badge',
        },
      ],
    });

    assert.ok(output.includes('██░░'));
    assert.ok(output.includes('✓ Config file'));
    assert.ok(output.includes('✓ CI workflow'));
    assert.ok(output.includes('· Badge workflow'));
    assert.ok(output.includes('Level 3'));
  });
});
