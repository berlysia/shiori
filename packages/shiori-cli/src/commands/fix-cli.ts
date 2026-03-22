import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { buildHealthResult } from './health.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import {
  createBaseContext,
  withRegistry,
  saveRegistryRouted,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { initRegistry } from './registry-generator.ts';
import { recordJournalEvent } from '../core/journal.ts';
import { ExitCode } from '../core/exit-codes.ts';
import { writeOutput } from '../core/cli-output.ts';
import { planFixActions, type FixAction, type FixApplyResult } from './fix.ts';
import { formatOnboardingGuidance } from '../core/onboarding-guidance.ts';
import {
  formatFixPlan,
  formatFixPlanJson,
  formatFixPlanMarkdown,
  formatFixApplyResult,
  formatFixApplyResultJson,
} from '../formatters/fix-formatter.ts';
import { promptFixAction, createFixReadline } from './fix-interactive.ts';
import { FIX_FORMATS, type FixFormat } from '../core/types.ts';

const validateFixFormat = createFormatValidator<FixFormat>(FIX_FORMATS, 'text');

export const fixCommand = define({
  name: 'fix',
  description: 'Auto-fix governance issues (unified remediation command)',
  examples: `  # Dry-run: show what would be fixed
  shiori fix

  # Execute fixes
  shiori fix --apply

  # JSON output for CI integration
  shiori fix --format json

  # Markdown output for PR comments (EP-0121)
  shiori fix --format markdown --output fix-preview.md

  # Interactive mode: approve/skip each action
  shiori fix --interactive

  # Execute with JSON output
  shiori fix --apply --format json

  # Write applied refs to file for CI automation (EP-0124)
  shiori fix --apply --output-refs .tmp/applied-refs.txt`,
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
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "text", "json", "markdown". Default: "text"',
      default: 'text',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    apply: {
      type: 'boolean',
      short: 'a',
      description: 'Execute fixes (default: dry-run preview)',
    },
    interactive: {
      type: 'boolean',
      short: 'I',
      description: 'Interactively approve/skip each fix action (requires TTY)',
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
    outputRefs: {
      type: 'string',
      toKebab: true,
      description:
        'Write applied refs (newline-delimited) to file. Requires --apply. For CI automation (EP-0124)',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const format = validateFixFormat(ctx.values.format);
    if (format === null) return;

    // Mutual exclusivity: --apply and --interactive cannot be used together
    if (ctx.values.apply && ctx.values.interactive) {
      console.error('Error: --apply and --interactive are mutually exclusive.');
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Interactive mode requires a TTY
    if (ctx.values.interactive && !process.stdin.isTTY) {
      console.error(
        'Error: --interactive requires a TTY (not available in this environment).',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // --output-refs requires --apply (CI automation, not meaningful in dry-run or interactive)
    if (ctx.values.outputRefs) {
      if (!ctx.values.apply) {
        console.error('Error: --output-refs requires --apply.');
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
      if (ctx.values.interactive) {
        console.error(
          'Error: --output-refs and --interactive are mutually exclusive.',
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }

    // Load context
    const base = createBaseContext(ctx.values.cwd);
    const regCtx = await withRegistry(base, {
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    const { patterns, ignore } = resolveScanPatterns(
      ctx.values.patterns,
      ctx.values.ignore,
      regCtx.config,
    );

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd: base.cwd,
      providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Generate report (verify + health score)
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const reportResult = report({
      scanResult,
      registry: regCtx.registry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    // Plan fix actions
    const plan = planFixActions(reportResult);

    // Interactive mode (EP-0122): approve/skip each action individually
    if (ctx.values.interactive) {
      if (plan.actions.length === 0) {
        console.error('No automatable fix actions available.');
      } else {
        console.error('🔧 Interactive Fix:');

        const approvedActions: FixAction[] = [];
        let quit = false;
        const rl = createFixReadline({
          input: process.stdin,
          output: process.stderr,
        });

        try {
          for (const action of plan.actions) {
            const choice = await promptFixAction(action, rl, process.stderr);

            if (choice === 'quit') {
              console.error('\n  Quit. No further actions will be processed.');
              quit = true;
              break;
            }

            if (choice === 'approve') {
              approvedActions.push(action);
            } else {
              console.error('  Skipped.');
            }
          }

          // Execute approved actions
          if (approvedActions.length > 0 && !quit) {
            const beforeResult = buildHealthResult(reportResult);
            const beforeScore = beforeResult.health.score;

            const updatedRegistry = initRegistry({
              records: scanResult.annotations,
              existingRegistry: regCtx.registry,
            });

            const newRefs = Object.keys(updatedRegistry).filter(
              (ref) => !(ref in regCtx.registry),
            );

            if (newRefs.length > 0) {
              const saved = await saveRegistryRouted({
                registry: updatedRegistry,
                registryPath: regCtx.registryPath,
                cwd: base.cwd,
                refPatterns: regCtx.config.refPatterns,
                label: 'Fixed (interactive)',
              });

              if (!saved) {
                console.error(
                  'Error: Registry save failed (path boundary error).',
                );
                process.exitCode = ExitCode.ENVIRONMENT_ERROR;
                return;
              }

              recordJournalEvent({
                cwd: base.cwd,
                eventType: 'cli.fix',
                refs: newRefs,
                success: true,
                entriesAdded: newRefs.length,
              });

              // Re-run report to get after score
              const afterReportResult = report({
                scanResult,
                registry: updatedRegistry,
                failOn,
                warnOn,
                duplicates: regCtx.duplicates,
                refPatterns: regCtx.config.refPatterns,
                refOrigins: regCtx.refOrigins,
                expiringThresholdDays,
              });
              const afterResult = buildHealthResult(afterReportResult);
              const afterScore = afterResult.health.score;

              console.error(
                formatFixApplyResult({
                  applied: approvedActions,
                  registryChanges: { added: newRefs },
                  scoreBefore: beforeScore,
                  scoreAfter: afterScore,
                }),
              );
            } else {
              console.error(
                'Registry is already up to date (no new refs to add).',
              );
            }
          } else if (!quit) {
            console.error('\n  No actions were approved.');
          }
        } finally {
          rl.close();
        }
      }

      // Show manual suggestions after interactive processing
      if (plan.manualSuggestions.length > 0) {
        console.error('');
        console.error('📋 Manual actions (not automatable):');
        for (const suggestion of plan.manualSuggestions) {
          console.error(`  - ${suggestion.command}: ${suggestion.message}`);
        }
      }

      return;
    }

    // Dry-run mode (default)
    if (!ctx.values.apply) {
      if (format === 'json') {
        const written = await writeOutput(formatFixPlanJson(plan), {
          outputPath: ctx.values.output,
          cwd: base.cwd,
          label: 'Fix preview',
        });
        if (!written) return;
      } else if (format === 'markdown') {
        const md = formatFixPlanMarkdown(plan);
        const written = await writeOutput(md, {
          outputPath: ctx.values.output,
          cwd: base.cwd,
          label: 'Fix preview',
        });
        if (!written) return;
      } else {
        console.error(formatFixPlan(plan));
      }

      // Onboarding guidance for initial setup state (EP-0127)
      const uniqueRefs = new Set(scanResult.annotations.map((a) => a.ref));
      for (const line of formatOnboardingGuidance({
        context: {
          totalUniqueRefs: uniqueRefs.size,
          missingInRegistryCount: reportResult.byType['missing-in-registry'],
        },
        format,
        isTTY: process.stderr.isTTY ?? false,
      })) {
        console.error(line);
      }

      return;
    }

    // Apply mode
    if (plan.actions.length === 0) {
      // Write empty refs file even when no actions (downstream existence check)
      if (ctx.values.outputRefs) {
        const refsWritten = await writeOutput('', {
          outputPath: ctx.values.outputRefs,
          cwd: base.cwd,
          label: 'Applied refs',
        });
        if (!refsWritten) {
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
      }

      if (format === 'json') {
        const written = await writeOutput(formatFixPlanJson(plan), {
          outputPath: ctx.values.output,
          cwd: base.cwd,
          label: 'Fix result',
        });
        if (!written) return;
      } else if (format === 'markdown') {
        const md = formatFixPlanMarkdown(plan);
        const written = await writeOutput(md, {
          outputPath: ctx.values.output,
          cwd: base.cwd,
          label: 'Fix result',
        });
        if (!written) return;
      } else {
        console.error('No automatable fix actions to apply.');
        if (plan.manualSuggestions.length > 0) {
          console.error('');
          console.error('📋 Manual actions (not automatable):');
          for (const suggestion of plan.manualSuggestions) {
            console.error(`  - ${suggestion.command}: ${suggestion.message}`);
          }
        }
      }
      return;
    }

    // Execute update action
    const beforeResult = buildHealthResult(reportResult);
    const beforeScore = beforeResult.health.score;

    const updatedRegistry = initRegistry({
      records: scanResult.annotations,
      existingRegistry: regCtx.registry,
    });

    // Count new entries
    const newRefs = Object.keys(updatedRegistry).filter(
      (ref) => !(ref in regCtx.registry),
    );

    if (newRefs.length === 0) {
      // Write empty refs file even when no new refs (downstream existence check)
      if (ctx.values.outputRefs) {
        const refsWritten = await writeOutput('', {
          outputPath: ctx.values.outputRefs,
          cwd: base.cwd,
          label: 'Applied refs',
        });
        if (!refsWritten) {
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
      }

      if (format === 'json' || format === 'markdown') {
        const result: FixApplyResult = {
          applied: [],
          registryChanges: { added: [] },
          scoreBefore: beforeScore,
          scoreAfter: beforeScore,
        };
        const content =
          format === 'json'
            ? formatFixApplyResultJson(result)
            : formatFixApplyResult(result);
        const written = await writeOutput(content, {
          outputPath: ctx.values.output,
          cwd: base.cwd,
          label: 'Fix result',
        });
        if (!written) return;
      } else {
        console.error('Registry is already up to date (no new refs to add).');
      }
      return;
    }

    // Save registry
    const saved = await saveRegistryRouted({
      registry: updatedRegistry,
      registryPath: regCtx.registryPath,
      cwd: base.cwd,
      refPatterns: regCtx.config.refPatterns,
      label: 'Fixed',
    });

    if (!saved) {
      console.error('Error: Registry save failed (path boundary error).');
      process.exitCode = ExitCode.ENVIRONMENT_ERROR;
      return;
    }

    // Journal event
    recordJournalEvent({
      cwd: base.cwd,
      eventType: 'cli.fix',
      refs: newRefs,
      success: true,
      entriesAdded: newRefs.length,
    });

    // Re-run report to get after score
    const afterReportResult = report({
      scanResult,
      registry: updatedRegistry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });
    const afterResult = buildHealthResult(afterReportResult);
    const afterScore = afterResult.health.score;

    // Write applied refs to file for CI automation (EP-0124)
    if (ctx.values.outputRefs) {
      const refsWritten = await writeOutput(newRefs.join('\n'), {
        outputPath: ctx.values.outputRefs,
        cwd: base.cwd,
        label: 'Applied refs',
      });
      if (!refsWritten) {
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
    }

    // Build applied actions from actual newRefs (not plan.actions.refs)
    // because initRegistry filters via isValidRef — some plan refs may be skipped.
    const appliedAction = {
      type: 'update' as const,
      description: `Added ${newRefs.length} ref(s) to registry`,
      refs: newRefs,
    };

    const fixResult: FixApplyResult = {
      applied: [appliedAction],
      registryChanges: { added: newRefs },
      scoreBefore: beforeScore,
      scoreAfter: afterScore,
    };

    if (format === 'json') {
      const written = await writeOutput(formatFixApplyResultJson(fixResult), {
        outputPath: ctx.values.output,
        cwd: base.cwd,
        label: 'Fix result',
      });
      if (!written) return;
    } else {
      console.error(formatFixApplyResult(fixResult));
    }
  },
});
