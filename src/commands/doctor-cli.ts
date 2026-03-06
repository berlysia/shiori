import { createInterface } from 'node:readline/promises';
import { define } from 'gunshi';
import {
  doctor,
  formatDoctor,
  buildUpgradePlan,
  formatUpgradePlan,
  formatUpgradeResult,
  type DoctorFormat,
  type UpgradeActionResult,
  type UpgradeResult,
} from './doctor.ts';
import { assessMaturity } from './doctor/maturity.ts';
import { loadConfigOnce } from './doctor/checks.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import {
  createInitContext,
  stepConfig,
  stepScan,
  stepRegistry,
  stepGitignore,
  stepCi,
  PathBoundaryError,
  type CiTemplateKind,
} from './init-steps.ts';
import type { UpgradeAction } from './doctor/upgrade.ts';

const validateDoctorFormat = createFormatValidator<DoctorFormat>(
  ['text', 'json'] as const,
  'text',
);

/**
 * Execute a single upgrade action.
 * Returns execution result with status message.
 */
async function executeUpgradeAction(
  action: UpgradeAction,
  cwd: string,
  configDir?: string,
): Promise<UpgradeActionResult> {
  switch (action.kind) {
    case 'init': {
      try {
        const initCtx = await createInitContext({ cwd, configFlag: configDir });
        await stepConfig(initCtx);
        await stepScan(initCtx, {});
        await stepRegistry(initCtx);
        await stepGitignore(initCtx);
        return {
          kind: action.kind,
          executed: true,
          message: `Initialized shiori: ${initCtx.steps.join(', ')}`,
        };
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          return {
            kind: action.kind,
            executed: false,
            message: `Skipped init: ${err.message}`,
          };
        }
        throw err;
      }
    }

    case 'ci-workflow': {
      if (action.ciTemplateKind) {
        const steps: string[] = [];
        try {
          await stepCi(cwd, action.ciTemplateKind, steps);
          return {
            kind: action.kind,
            executed: true,
            message: steps[0] ?? 'CI workflow generated',
          };
        } catch (err) {
          if (err instanceof PathBoundaryError) {
            return {
              kind: action.kind,
              executed: false,
              message: `Skipped CI workflow: ${err.message}`,
            };
          }
          throw err;
        }
      }
      return {
        kind: action.kind,
        executed: false,
        message: 'No CI template kind specified',
      };
    }

    case 'badge-workflow': {
      if (action.ciTemplateKind) {
        const steps: string[] = [];
        try {
          await stepCi(cwd, action.ciTemplateKind, steps);
          return {
            kind: action.kind,
            executed: true,
            message:
              (steps[0] ?? 'Badge workflow generated') +
              '\n     💡 For stable badge URL, configure Gist upload: see comments in the generated workflow.',
          };
        } catch (err) {
          if (err instanceof PathBoundaryError) {
            return {
              kind: action.kind,
              executed: false,
              message: `Skipped badge workflow: ${err.message}`,
            };
          }
          throw err;
        }
      }
      return {
        kind: action.kind,
        executed: false,
        message: 'No CI template kind specified',
      };
    }

    case 'snapshot-setup': {
      // Snapshot setup needs manual invocation of health command
      return {
        kind: action.kind,
        executed: false,
        message:
          'Run "shiori health --snapshot .config/shiori/snapshots" to create first snapshot',
      };
    }

    case 'scheduled-workflow': {
      // Scheduled workflow needs manual YAML editing
      return {
        kind: action.kind,
        executed: false,
        message:
          'Add a cron schedule trigger to your shiori GitHub Actions workflow',
      };
    }
  }
}

/**
 * Ask user for confirmation via readline.
 * Returns true if user confirms (y/yes), false otherwise.
 */
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return (
      answer.trim().toLowerCase() === 'y' ||
      answer.trim().toLowerCase() === 'yes'
    );
  } finally {
    rl.close();
  }
}

export const doctorCommand = define({
  name: 'doctor',
  description: 'Diagnose shiori setup and report configuration issues',
  examples: `  # Run diagnostics
  shiori doctor

  # Show fix suggestions for each issue
  shiori doctor --fix

  # Assess governance maturity level (0-4)
  shiori doctor --maturity

  # Interactive upgrade wizard — step up to the next maturity level
  shiori doctor --upgrade

  # Non-interactive upgrade (auto-confirm)
  shiori doctor --upgrade --yes

  # JSON output for tooling
  shiori doctor -f json`,
  rendering: { header: null },
  args: {
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
    fix: {
      type: 'boolean',
      description: 'Show fix suggestions for each issue',
    },
    maturity: {
      type: 'boolean',
      description: 'Assess governance maturity level (0-4)',
    },
    upgrade: {
      type: 'boolean',
      description:
        'Interactive upgrade wizard: step up to the next maturity level',
    },
    yes: {
      type: 'boolean',
      short: 'y',
      description:
        'Skip interactive confirmation (use with --upgrade for CI/scripting)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "text", "json". Default: "text"',
      default: 'text',
    },
  },
  run: async (ctx) => {
    const format = validateDoctorFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();
    const showFix = ctx.values.fix ?? false;
    const maturity = ctx.values.maturity ?? false;
    const upgrade = ctx.values.upgrade ?? false;
    const yes = ctx.values.yes ?? false;

    // --yes without --upgrade is meaningless
    if (yes && !upgrade) {
      console.error('Error: --yes can only be used with --upgrade');
      process.exitCode = 1;
      return;
    }

    const result = await doctor({
      cwd,
      configDir: ctx.values.config,
      fix: showFix,
      maturity,
      upgrade,
    });

    // Upgrade wizard flow
    if (upgrade && result.maturity) {
      const plan = buildUpgradePlan(result.maturity);

      if (plan.actions.length === 0) {
        console.error(formatUpgradePlan(plan));
        return;
      }

      // Show plan
      console.error(formatUpgradePlan(plan));
      console.error('');

      // Confirm execution
      if (!yes) {
        const confirmed = await confirm('Proceed with upgrade?');
        if (!confirmed) {
          console.error('Upgrade cancelled.');
          return;
        }
      }

      // Execute actions
      const actionResults: UpgradeActionResult[] = [];
      for (const action of plan.actions) {
        const actionResult = await executeUpgradeAction(
          action,
          cwd,
          ctx.values.config,
        );
        actionResults.push(actionResult);
      }

      // Re-assess maturity after upgrade
      const configLoadResult = await loadConfigOnce(cwd, ctx.values.config);
      const newMaturity = await assessMaturity(cwd, configLoadResult);

      const upgradeResult: UpgradeResult = {
        plan,
        actionResults,
        newLevel: newMaturity.level,
      };

      if (format === 'json') {
        console.log(
          JSON.stringify({ ...result, upgrade: upgradeResult }, null, 2),
        );
      } else {
        console.error('');
        console.error(formatUpgradeResult(upgradeResult));
      }
      return;
    }

    // Standard doctor output
    const output = formatDoctor(result, format, showFix);
    console.error(output);

    if (result.summary.fail > 0) {
      process.exitCode = 1;
    }
  },
});
