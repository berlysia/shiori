import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { verify } from './verify.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  triage,
  buildTriageQueue,
  formatTriageOutput,
  TRIAGE_FORMATS,
  type TriageFormat,
} from './triage.ts';
import { wizardTriageSession } from './triage-interactive.ts';
import {
  planWizardActions,
  formatWizardApplyPreview,
  formatWizardCompletionSummary,
} from './triage-wizard-apply.ts';
import { groupResolveActionsByFile, applyResolveToFile } from './resolve.ts';
import { report } from './report.ts';
import { buildHealthResult } from './health.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { writeOutput } from '../core/cli-output.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import {
  resolveExpiringThreshold,
  warnIfGitDirty,
  saveRegistryRouted,
} from '../core/cli-context.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { recordJournalEvent } from '../core/journal.ts';

const validateTriageFormat = createFormatValidator<TriageFormat>(
  TRIAGE_FORMATS,
  'json',
);

export const triageCommand = define({
  name: 'triage',
  description:
    'Generate a prioritized action list from verify issues, grouped by ref',
  examples: `  # Generate triage report (JSON)
  shiori triage

  # Markdown output
  shiori triage -f markdown

  # Interactive wizard (deadline-driven)
  shiori triage --wizard

  # Filter by owner
  shiori triage --owner team-platform

  # Filter by kind
  shiori triage --kind compat

  # Show only expired items
  shiori triage --expired-only

  # Combine filters (AND)
  shiori triage --owner team-platform --expired-only

  # Save to file
  shiori triage -f markdown -o triage-report.md`,
  rendering: { header: null },
  args: {
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json", "markdown". Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    owner: {
      type: 'string',
      description: 'Filter by registry entry owner',
    },
    kind: {
      type: 'string',
      description: 'Filter by registry entry kind',
    },
    expiredOnly: {
      type: 'boolean',
      toKebab: true,
      description: 'Show only refs with expired issues',
    },
    wizard: {
      type: 'boolean',
      description: 'Launch interactive triage wizard (deadline-driven)',
    },
    failOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "expired,missing-in-registry"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
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
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Overrides config. Default: 14',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const format = validateTriageFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();

    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry, registryPath, duplicates, refOrigins } =
      configAndRegistry;

    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : [...DEFAULT_SCAN_IGNORE, ...(config.scanIgnore ?? [])];

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Verify (pre-compute to reuse in triage and for exit code)
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      config,
    );

    const verifyResult = verify({
      records: scanResult.annotations,
      registry,
      failOn,
      warnOn,
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });

    // Triage (reuse verifyResult to avoid duplicate verify() call)
    const result = triage({
      scanResult,
      registry,
      failOn,
      warnOn,
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
      owner: ctx.values.owner,
      kind: ctx.values.kind,
      expiredOnly: ctx.values.expiredOnly,
      verifyResult,
    });

    // ── Wizard mode ───────────────────────────────────────────
    if (ctx.values.wizard) {
      // TTY check: wizard requires interactive terminal
      if (!process.stdin.isTTY) {
        console.error(
          'Error: --wizard requires an interactive terminal (TTY).',
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      // Step 1: beforeScore — compute current health before wizard session
      const beforeReport = report({
        scanResult,
        registry,
        failOn: [],
        warnOn: [],
        refPatterns: config.refPatterns,
        refOrigins,
        expiringThresholdDays,
      });
      const beforeScore = buildHealthResult(beforeReport).health.score;

      // Step 2: wizard session
      const queue = buildTriageQueue({ triageResult: result });
      const sessionResult = await wizardTriageSession(
        queue,
        { input: process.stdin, output: process.stderr },
        beforeScore,
      );

      // Step 3: filter actionable items
      const actionable = sessionResult.processed.filter((p) => p.actionType);
      if (actionable.length === 0) {
        // No executable actions — output session result as JSON and exit
        const wizardOutput = wrapOutputJson(sessionResult, {
          command: 'triage',
          schemaVersion: 1,
        });
        process.stdout.write(wizardOutput + '\n');
        if (verifyResult.summary.errors > 0) {
          process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
        }
        return;
      }

      // Step 4: load file contents for resolve targets (D2)
      const resolveRefs = new Set(
        actionable.filter((p) => p.actionType === 'resolve').map((p) => p.ref),
      );
      const filePaths = new Set(
        scanResult.annotations
          .filter((a) => resolveRefs.has(a.ref))
          .map((a) => a.location.file),
      );
      const fileContents = new Map<string, string>();
      for (const file of filePaths) {
        try {
          fileContents.set(file, await readFile(resolve(cwd, file), 'utf-8'));
        } catch {
          console.error(
            `Warning: Could not read ${file}, skipping resolve actions for this file.`,
          );
        }
      }

      // Step 5: plan + preview
      const plan = planWizardActions({
        processed: sessionResult.processed,
        scanResult,
        registry,
        fileContents,
      });
      console.error(formatWizardApplyPreview(plan));

      // Step 6: confirm
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      const answer = await rl.question('Apply these changes? [y/N] ');
      rl.close();
      if (answer.trim().toLowerCase() !== 'y') {
        console.error('Aborted. No changes applied.');
        const wizardOutput = wrapOutputJson(sessionResult, {
          command: 'triage',
          schemaVersion: 1,
        });
        process.stdout.write(wizardOutput + '\n');
        if (verifyResult.summary.errors > 0) {
          process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
        }
        return;
      }

      // Step 7: apply
      await warnIfGitDirty(cwd);

      // 7a: Apply resolve actions to source files
      const actionsByFile = groupResolveActionsByFile(plan.resolves.allActions);
      for (const [file, actions] of actionsByFile) {
        const content = fileContents.get(file);
        if (!content) continue;
        const editResult = applyResolveToFile(content, actions);
        await writeFile(resolve(cwd, file), editResult.content, 'utf-8');
        for (const warning of editResult.warnings) {
          console.error(`Warning: ${warning}`);
        }
      }

      // 7b: Save registry with extends applied
      const saved = await saveRegistryRouted({
        registry: plan.registryAfter,
        registryPath,
        cwd,
        refPatterns: config.refPatterns,
        label: 'Wizard applied',
      });
      if (!saved) return;

      // 7c: Record journal events
      const allAffectedRefs = [
        ...actionable
          .filter((p) => p.actionType === 'resolve')
          .map((p) => p.ref),
        ...actionable
          .filter((p) => p.actionType === 'extend')
          .map((p) => p.ref),
      ];
      recordJournalEvent({
        cwd,
        eventType: 'cli.triage-wizard',
        refs: allAffectedRefs,
        success: true,
        entriesRemoved: plan.summary.resolveCount,
      });

      // Step 8: afterScore + summary
      const afterReport = report({
        scanResult,
        registry: plan.registryAfter,
        failOn: [],
        warnOn: [],
        refPatterns: config.refPatterns,
        refOrigins,
        expiringThresholdDays,
      });
      const afterScore = buildHealthResult(afterReport).health.score;
      console.error(
        formatWizardCompletionSummary({
          beforeScore,
          afterScore,
          resolveCount: plan.summary.resolveCount,
          extendCount: plan.summary.extendCount,
          manualCount: plan.summary.manualCount,
        }),
      );

      // Output session result as JSON to stdout
      const wizardOutput = wrapOutputJson(sessionResult, {
        command: 'triage',
        schemaVersion: 1,
      });
      process.stdout.write(wizardOutput + '\n');

      // Exit code: fail when --fail-on issues produce errors
      if (verifyResult.summary.errors > 0) {
        process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
      }
      return;
    }

    // ── Standard (non-wizard) mode ────────────────────────────

    // Empty result message
    if (result.items.length === 0) {
      console.error('No items match the filter criteria.');
    }

    // Output
    const output = formatTriageOutput(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Triage report',
    });
    if (!written) return;

    // Summary on stderr
    console.error(
      `Triage: ${result.summary.total} item(s) — critical: ${result.summary.byPriority.critical}, high: ${result.summary.byPriority.high}, medium: ${result.summary.byPriority.medium}, low: ${result.summary.byPriority.low}`,
    );

    // Exit code: fail when --fail-on issues produce errors
    if (verifyResult.summary.errors > 0) {
      process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
    }
  },
});
