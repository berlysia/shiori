import { createInterface } from 'node:readline/promises';
import { define } from 'gunshi';
import {
  groupUseCases,
  findUseCase,
  formatUseCase,
  formatAllUseCases,
  formatUseCasesJson,
  rankUseCasesByContext,
  formatWizardResult,
  formatWizardResultJson,
  type UseCase,
  type GuideContext,
} from './guide.ts';
import { loadConfigOnce } from './doctor/checks.ts';
import { assessMaturity } from './doctor/maturity.ts';
import { scan } from './scan.ts';
import { report } from './report.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
} from '../core/cli-context.ts';

/**
 * Extract project context for wizard-mode ranking.
 * Performs IO (config loading, maturity assessment, scan + report)
 * and returns a GuideContext snapshot.
 *
 * Errors are caught per-stage so partial context is still usable.
 */
async function extractGuideContext(
  cwd: string,
  configDir?: string,
): Promise<GuideContext> {
  const context: GuideContext = {};

  // Stage 1: Load config and assess maturity (lightweight)
  const configLoadResult = await loadConfigOnce(cwd, configDir);

  if (configLoadResult.config) {
    const maturityResult = await assessMaturity(cwd, configLoadResult);
    context.maturity = maturityResult.level;
  } else {
    // No config means maturity level 0
    context.maturity = 0;
  }

  // Stage 2: Load registry and run scan + report for health score
  // Only attempt if config exists (otherwise scan/verify will fail)
  if (configLoadResult.config) {
    try {
      const base = createBaseContext(cwd);
      const regCtx = await withRegistry(base, { configDir });

      const { patterns, ignore } = resolveScanPatterns(
        undefined,
        undefined,
        regCtx.config,
      );

      const provider = new CommentProvider();
      const scanResult = await scan({
        patterns,
        ignore,
        provider,
        cwd,
        providerOptions: {
          candidatePatterns: regCtx.config.candidatePatterns,
        },
      });

      const reportResult = report({
        scanResult,
        registry: regCtx.registry,
        failOn: [],
        warnOn: [],
        duplicates: regCtx.duplicates,
        refPatterns: regCtx.config.refPatterns,
        refOrigins: regCtx.refOrigins,
      });

      context.healthScore = reportResult.health.score;
      context.healthLevel = reportResult.health.level;
      context.annotationCount = reportResult.totals.annotations;
      context.candidateCount = reportResult.totals.candidates;

      // Check for expired/expiring-soon from verify byType
      context.hasExpiredAnnotations =
        reportResult.verifyResult.summary.byType['expired'] > 0;
      context.hasExpiringSoonAnnotations =
        reportResult.verifyResult.summary.byType['expiring-soon'] > 0;
    } catch {
      // Partial context is acceptable — wizard degrades gracefully
    }
  }

  return context;
}

/**
 * Interactive use-case selector using node:readline/promises.
 * Follows doctor-cli.ts confirm() pattern for TTY prompting.
 */
async function interactiveSelect(): Promise<UseCase | undefined> {
  const grouped = groupUseCases();
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    // Build numbered menu
    const allUseCases: UseCase[] = [];
    const lines: string[] = [];
    lines.push('shiori guide — What do you want to do?');
    lines.push('');

    let index = 1;
    for (const group of grouped) {
      lines.push(`${group.categoryLabel}:`);
      for (const uc of group.useCases) {
        lines.push(`  ${index}. ${uc.label}`);
        allUseCases.push(uc);
        index++;
      }
      lines.push('');
    }

    lines.push(`Enter a number (1-${allUseCases.length}), or q to quit:`);

    console.error(lines.join('\n'));

    const answer = await rl.question('> ');
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === 'q' || trimmed === 'quit' || trimmed === '') {
      return undefined;
    }

    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num < 1 || num > allUseCases.length) {
      console.error(`Invalid selection: ${answer.trim()}`);
      return undefined;
    }

    return allUseCases[num - 1];
  } finally {
    rl.close();
  }
}

export const guideCommand = define({
  name: 'guide',
  description:
    'Interactive command navigator — find the right shiori command for your goal',
  examples: `  # Interactive mode (TTY)
  shiori guide

  # Context-aware recommendations (wizard mode)
  shiori guide --wizard

  # Direct lookup by use-case ID
  shiori guide --use-case quick-check

  # Pipe-friendly: list all use cases as JSON
  shiori guide --json

  # List all use cases as text
  shiori guide --list`,
  rendering: { header: null },
  args: {
    'use-case': {
      type: 'string',
      description:
        'Use-case ID for non-interactive lookup (e.g. "quick-check", "pr-delta")',
    },
    json: {
      type: 'boolean',
      description: 'Output all use-case mappings as JSON',
    },
    list: {
      type: 'boolean',
      description: 'List all use cases as human-readable text',
    },
    wizard: {
      type: 'boolean',
      description:
        'Context-aware mode — analyzes project state and recommends top 3 actions',
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to process.cwd())',
    },
    config: {
      type: 'string',
      description: 'Config directory path',
    },
  },
  run: async (ctx) => {
    const useCaseId = ctx.values['use-case'];
    const jsonMode = ctx.values.json ?? false;
    const listMode = ctx.values.list ?? false;
    const wizardMode = ctx.values.wizard ?? false;

    // Mode: --wizard — context-aware recommendations (EP-0100)
    if (wizardMode) {
      const cwd = ctx.values.cwd ?? process.cwd();
      console.error('Analyzing project context...');
      const context = await extractGuideContext(cwd, ctx.values.config);
      const result = rankUseCasesByContext(context);

      if (jsonMode) {
        console.log(formatWizardResultJson(result));
      } else {
        console.error(formatWizardResult(result));
      }
      return;
    }

    // Mode: --json — dump all mappings as JSON (pipe-friendly)
    if (jsonMode) {
      const grouped = groupUseCases();
      console.log(formatUseCasesJson(grouped));
      return;
    }

    // Mode: --list — dump all mappings as text
    if (listMode) {
      const grouped = groupUseCases();
      console.error(formatAllUseCases(grouped));
      return;
    }

    // Mode: --use-case <id> — non-interactive direct lookup
    if (useCaseId) {
      const useCase = findUseCase(useCaseId);
      if (!useCase) {
        console.error(`Unknown use-case: "${useCaseId}"`);
        console.error('');
        console.error('Available use-case IDs:');
        const grouped = groupUseCases();
        for (const group of grouped) {
          for (const uc of group.useCases) {
            console.error(`  ${uc.id}`);
          }
        }
        process.exitCode = 1;
        return;
      }
      console.error(formatUseCase(useCase));
      return;
    }

    // Mode: interactive (TTY) or fallback text dump (pipe)
    if (!process.stdin.isTTY) {
      // Pipe mode: output all mappings as JSON to stdout
      const grouped = groupUseCases();
      console.log(formatUseCasesJson(grouped));
      return;
    }

    // Interactive TTY mode
    const selected = await interactiveSelect();
    if (selected) {
      console.error('');
      console.error(formatUseCase(selected));
    }
  },
});
