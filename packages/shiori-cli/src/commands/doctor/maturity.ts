import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNodeError } from '../../core/errors.ts';
import {
  MATURITY_LEVEL_LABELS,
  type MaturityLevel,
  type MaturityNextAction,
  type MaturityResult,
  type MaturitySignal,
} from '../../core/types.ts';
import type { ConfigLoadResult } from './types.ts';

/**
 * Check whether a config file exists in the shiori config directory.
 */
async function detectConfig(
  cwd: string,
  configResult: ConfigLoadResult,
): Promise<MaturitySignal> {
  const detected = configResult.config !== undefined;
  return {
    name: 'config',
    label: 'Config file',
    detected,
    message: detected
      ? 'Config file found and loadable'
      : 'No config file found',
  };
}

/**
 * Check whether a registry file exists.
 */
async function detectRegistry(
  cwd: string,
  configResult: ConfigLoadResult,
): Promise<MaturitySignal> {
  const registryPath = configResult.config?.paths.registry
    ? resolve(cwd, configResult.config.paths.registry)
    : join(cwd, '.config', 'shiori', 'registry.json');

  try {
    await access(registryPath);
    return {
      name: 'registry',
      label: 'Registry file',
      detected: true,
      message: 'Registry file found',
    };
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {
        name: 'registry',
        label: 'Registry file',
        detected: false,
        message: 'Registry file not found',
      };
    }
    return {
      name: 'registry',
      label: 'Registry file',
      detected: false,
      message: `Error accessing registry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check whether .gitignore contains scan-result.json entry.
 */
async function detectGitignore(cwd: string): Promise<MaturitySignal> {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.config/shiori/scan-result.json';

  try {
    const content = await readFile(gitignorePath, 'utf-8');
    const detected = content
      .split('\n')
      .some((line) => line.trim() === entry.trim());

    return {
      name: 'gitignore',
      label: '.gitignore entry',
      detected,
      message: detected
        ? 'scan-result.json is in .gitignore'
        : 'scan-result.json not in .gitignore',
    };
  } catch {
    return {
      name: 'gitignore',
      label: '.gitignore entry',
      detected: false,
      message: '.gitignore not found',
    };
  }
}

/**
 * Scan .github/workflows/ for any workflow file that references shiori.
 */
async function detectCiWorkflow(cwd: string): Promise<MaturitySignal> {
  const workflowDir = join(cwd, '.github', 'workflows');

  try {
    const entries = await readdir(workflowDir);
    const ymlFiles = entries.filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    );

    for (const file of ymlFiles) {
      const content = await readFile(join(workflowDir, file), 'utf-8');
      if (content.includes('shiori')) {
        return {
          name: 'ci-workflow',
          label: 'CI workflow',
          detected: true,
          message: `Found shiori usage in ${file}`,
        };
      }
    }

    return {
      name: 'ci-workflow',
      label: 'CI workflow',
      detected: false,
      message: 'No workflow files reference shiori',
    };
  } catch {
    return {
      name: 'ci-workflow',
      label: 'CI workflow',
      detected: false,
      message: 'No .github/workflows/ directory found',
    };
  }
}

/**
 * Scan workflows for badge generation (report --format badge).
 */
async function detectBadgeWorkflow(cwd: string): Promise<MaturitySignal> {
  const workflowDir = join(cwd, '.github', 'workflows');

  try {
    const entries = await readdir(workflowDir);
    const ymlFiles = entries.filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    );

    for (const file of ymlFiles) {
      const content = await readFile(join(workflowDir, file), 'utf-8');
      // Detect badge-related patterns: report --format badge, or badge in workflow name with shiori
      if (
        content.includes('--format badge') ||
        (content.includes('badge') && content.includes('shiori'))
      ) {
        return {
          name: 'badge-workflow',
          label: 'Badge workflow',
          detected: true,
          message: `Found badge generation in ${file}`,
        };
      }
    }

    return {
      name: 'badge-workflow',
      label: 'Badge workflow',
      detected: false,
      message: 'No badge workflow found',
    };
  } catch {
    return {
      name: 'badge-workflow',
      label: 'Badge workflow',
      detected: false,
      message: 'No .github/workflows/ directory found',
    };
  }
}

/**
 * Check whether snapshot history exists (files in a snapshots directory).
 */
async function detectSnapshotHistory(cwd: string): Promise<MaturitySignal> {
  // Check common snapshot locations
  const candidates = [
    join(cwd, '.config', 'shiori', 'snapshots'),
    join(cwd, '.tmp', 'snapshots'),
  ];

  for (const dir of candidates) {
    try {
      const entries = await readdir(dir);
      const jsonFiles = entries.filter((f) => f.endsWith('.json'));
      if (jsonFiles.length > 0) {
        return {
          name: 'snapshot-history',
          label: 'Snapshot history',
          detected: true,
          message: `Found ${jsonFiles.length} snapshot(s) in ${dir}`,
        };
      }
    } catch {
      // Directory doesn't exist or can't be read — try next
    }
  }

  return {
    name: 'snapshot-history',
    label: 'Snapshot history',
    detected: false,
    message: 'No snapshot history found',
  };
}

/**
 * Scan workflows for scheduled triggers (cron).
 */
async function detectScheduledWorkflow(cwd: string): Promise<MaturitySignal> {
  const workflowDir = join(cwd, '.github', 'workflows');

  try {
    const entries = await readdir(workflowDir);
    const ymlFiles = entries.filter(
      (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
    );

    for (const file of ymlFiles) {
      const content = await readFile(join(workflowDir, file), 'utf-8');
      if (content.includes('schedule') && content.includes('shiori')) {
        return {
          name: 'scheduled-workflow',
          label: 'Scheduled workflow',
          detected: true,
          message: `Found scheduled shiori workflow in ${file}`,
        };
      }
    }

    return {
      name: 'scheduled-workflow',
      label: 'Scheduled workflow',
      detected: false,
      message: 'No scheduled shiori workflow found',
    };
  } catch {
    return {
      name: 'scheduled-workflow',
      label: 'Scheduled workflow',
      detected: false,
      message: 'No .github/workflows/ directory found',
    };
  }
}

/**
 * Determine the maturity level from detected signals.
 *
 * Level 0: Not initialized (no config or registry)
 * Level 1: Basic setup (config + registry + gitignore)
 * Level 2: CI integrated (has CI workflow using shiori)
 * Level 3: Visible governance (badge workflow)
 * Level 4: Continuous monitoring (snapshot history + scheduled workflow)
 */
function computeLevel(signals: MaturitySignal[]): MaturityLevel {
  const has = (name: string): boolean =>
    signals.some((s) => s.name === name && s.detected);

  // Level 1: Basic setup
  const hasBasicSetup = has('config') && has('registry') && has('gitignore');
  if (!hasBasicSetup) return 0;

  // Level 2: CI integrated
  if (!has('ci-workflow')) return 1;

  // Level 3: Visible governance (badge)
  if (!has('badge-workflow')) return 2;

  // Level 4: Continuous monitoring
  if (!has('snapshot-history') || !has('scheduled-workflow')) return 3;

  return 4;
}

/**
 * Build next action recommendations based on current level and signals.
 */
function buildNextActions(
  level: MaturityLevel,
  signals: MaturitySignal[],
): MaturityNextAction[] {
  const actions: MaturityNextAction[] = [];
  const has = (name: string): boolean =>
    signals.some((s) => s.name === name && s.detected);

  if (level < 1) {
    if (!has('config')) {
      actions.push({
        targetLevel: 1,
        action: 'shiori init',
        description: 'Initialize shiori configuration and registry',
      });
    }
    if (!has('registry')) {
      actions.push({
        targetLevel: 1,
        action: 'shiori init',
        description: 'Create a registry file to track annotations',
      });
    }
    if (!has('gitignore')) {
      actions.push({
        targetLevel: 1,
        action: 'shiori init',
        description: 'Add scan-result.json to .gitignore',
      });
    }
  }

  if (level < 2 && level >= 1) {
    actions.push({
      targetLevel: 2,
      action: 'Add shiori verify to CI workflow',
      description:
        'Create a GitHub Actions workflow that runs "shiori check" or "shiori verify" on PRs',
    });
  }

  if (level < 3 && level >= 2) {
    actions.push({
      targetLevel: 3,
      action: 'shiori report --format badge',
      description:
        'Add a badge workflow to visualize governance score in your README',
    });
  }

  if (level < 4 && level >= 3) {
    if (!has('snapshot-history')) {
      actions.push({
        targetLevel: 4,
        action: 'shiori health --snapshot <dir>',
        description: 'Save health snapshots for trend analysis over time',
      });
    }
    if (!has('scheduled-workflow')) {
      actions.push({
        targetLevel: 4,
        action: 'Add scheduled workflow with cron trigger',
        description:
          'Create a scheduled GitHub Actions workflow for continuous monitoring',
      });
    }
  }

  return actions;
}

/**
 * Assess the governance maturity level of the project.
 * Detects signals from config, registry, CI workflows, badge, and snapshots,
 * then computes a maturity level (0-4) with next action recommendations.
 */
export async function assessMaturity(
  cwd: string,
  configResult: ConfigLoadResult,
): Promise<MaturityResult> {
  // Detect all signals concurrently
  const signals = await Promise.all([
    detectConfig(cwd, configResult),
    detectRegistry(cwd, configResult),
    detectGitignore(cwd),
    detectCiWorkflow(cwd),
    detectBadgeWorkflow(cwd),
    detectSnapshotHistory(cwd),
    detectScheduledWorkflow(cwd),
  ]);

  const level = computeLevel(signals);
  const nextActions = buildNextActions(level, signals);

  return {
    level,
    levelLabel: MATURITY_LEVEL_LABELS[level],
    signals,
    nextActions,
  };
}
