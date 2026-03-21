import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfigAndRegistry } from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import {
  assertAllWithinCwd,
  PathBoundaryError,
} from '../core/path-boundary.ts';
import { warnIfGitDirty, saveRegistryRouted } from '../core/cli-context.ts';
import { recordJournalEvent } from '../core/journal.ts';
import {
  selectRefStatusProvider,
  resolveRefStatusMap,
} from '../core/ref-status-providers/index.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { performScanFreshnessCheck } from '../core/scan-freshness.ts';
import {
  formatResolveOutput,
  type ResolveOutputFormat,
} from '../formatters/resolve-formatter.ts';
import {
  planResolve,
  planBulkResolve,
  applyResolveToFile,
  groupResolveActionsByFile,
  formatResolvePreview,
  formatBulkResolvePreview,
} from './resolve.ts';

const validateResolveFormat = createFormatValidator<ResolveOutputFormat>(
  ['text', 'json'] as const,
  'text',
);

export const resolveCommand = define({
  name: 'resolve',
  description:
    'Remove resolved or expired annotations from source and registry',
  examples: `  # Preview resolve plan (dry-run, default)
  shiori scan && shiori resolve --ref SUP-1234

  # Apply resolve (write to files + registry)
  shiori scan && shiori resolve --ref SUP-1234 --apply

  # Also remove lint disable directive
  shiori scan && shiori resolve --ref SUP-1234 --apply --remove-directive

  # Auto-detect closed refs and preview resolve plan
  shiori scan && shiori resolve --closed

  # Apply closed ref resolve (with confirmation skip for CI)
  shiori scan && shiori resolve --closed --apply --yes

  # JSON output for automation (e.g. Webhook Daemon)
  shiori scan && shiori resolve --closed --format json`,
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      description: 'The ref to resolve (e.g. "SUP-1234", "ADR:0007")',
    },
    closed: {
      type: 'boolean',
      description:
        'Auto-detect closed refs via ref-status provider and resolve them',
    },
    yes: {
      type: 'boolean',
      short: 'y',
      description:
        'Skip confirmation prompt when used with --closed --apply (for CI/scripting)',
    },
    scan: {
      type: 'string',
      short: 's',
      description:
        'Path to scan result JSON (default: .config/shiori/scan-result.json or stdin)',
    },
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    apply: {
      type: 'boolean',
      short: 'a',
      description:
        'Actually write changes to source files and registry (default: dry-run preview)',
    },
    'remove-directive': {
      type: 'boolean',
      description:
        'Also remove the lint disable comment/directive itself (not just the shiori annotation)',
    },
    force: {
      type: 'boolean',
      short: 'f',
      description:
        'Skip scan-result freshness check (use when you know the scan result is valid)',
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
    format: {
      type: 'string',
      short: 'F',
      description:
        'Output format for --closed dry-run: "text" (human-readable, default), "json" (structured for automation)',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    refStatusCommand: {
      type: 'string',
      toKebab: true,
      description:
        'External command to check ref statuses. Receives refs on stdin (newline-delimited), returns JSONL with {ref, status} on stdout. Note: command path must not contain spaces',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const apply = ctx.values.apply ?? false;
    const removeDirective = ctx.values['remove-directive'] ?? false;
    const force = ctx.values.force ?? false;
    const ref = ctx.values.ref;
    const closed = ctx.values.closed ?? false;
    const yes = ctx.values.yes ?? false;

    // ── Argument validation ──────────────────────────────────

    if (ref && closed) {
      console.error('Error: --ref and --closed are mutually exclusive.');
      console.error(
        'Use --ref to resolve a single ref, or --closed to auto-detect closed refs.',
      );
      process.exitCode = 1;
      return;
    }

    if (!ref && !closed) {
      console.error('Error: either --ref <ref> or --closed is required.');
      process.exitCode = 1;
      return;
    }

    if (yes && !(apply && closed)) {
      console.error('Error: --yes is only valid with --closed --apply.');
      process.exitCode = 1;
      return;
    }

    // Validate --format (only meaningful for --closed dry-run)
    const format = validateResolveFormat(ctx.values.format);
    if (format === null) return;

    if (format !== 'text' && !closed) {
      console.error('Error: --format is only supported with --closed.');
      process.exitCode = 1;
      return;
    }

    // ── Common setup ─────────────────────────────────────────

    const { config, registry, registryPath } = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    const scanResultOptions = {
      explicitPath: ctx.values.scan,
      config,
      cwd,
    };
    const scanResult = await loadScanResult(scanResultOptions);

    // ── --closed mode ────────────────────────────────────────

    if (closed) {
      // Reviewer 🔴: pre-check provider existence before resolveRefStatusMap()
      // resolveRefStatusMap returns undefined for both "no provider" and "no refs",
      // so --closed needs to distinguish provider-missing from other cases.
      const provider = await selectRefStatusProvider({
        refStatusCommand: ctx.values.refStatusCommand,
        githubToken: process.env.GITHUB_TOKEN,
        githubRepository: process.env.GITHUB_REPOSITORY,
      });
      if (!provider) {
        console.error('Error: --closed requires a ref-status provider.');
        console.error(
          'Set GITHUB_TOKEN environment variable, install gh CLI, or use --ref-status-command.',
        );
        process.exitCode = 1;
        return;
      }

      // Resolve ref statuses (pass pre-selected provider to avoid double-instantiation)
      const { refStatuses } = await resolveRefStatusMap(
        {
          provider,
          refStatusCommand: ctx.values.refStatusCommand,
          githubToken: process.env.GITHUB_TOKEN,
          githubRepository: process.env.GITHUB_REPOSITORY,
        },
        scanResult.annotations,
      );

      if (!refStatuses) {
        // Provider exists but resolution failed (error already logged by resolveRefStatusMap)
        console.error('Could not resolve ref statuses. Aborting.');
        process.exitCode = 1;
        return;
      }

      // Extract closed refs
      const closedRefs = [...refStatuses.entries()]
        .filter(([, status]) => status === 'closed')
        .map(([refKey]) => refKey);

      if (closedRefs.length === 0) {
        console.error('No closed refs found. Nothing to resolve.');
        return;
      }

      console.error(
        `Found ${closedRefs.length} closed ref(s): ${closedRefs.join(', ')}`,
      );

      // Pre-load file contents for all annotations matching closed refs
      const closedRefSet = new Set(closedRefs);
      const matchingAnnotations = scanResult.annotations.filter((a) =>
        closedRefSet.has(a.ref),
      );
      const fileContents = new Map<string, string>();
      const uniqueFiles = [
        ...new Set(matchingAnnotations.map((a) => a.location.file)),
      ];
      for (const file of uniqueFiles) {
        const filePath = resolve(cwd, file);
        try {
          const content = await readFile(filePath, 'utf-8');
          fileContents.set(file, content);
        } catch {
          console.error(`Warning: Could not read file ${filePath}, skipping.`);
        }
      }

      // Scan-result freshness check (shared with single-ref mode)
      if (!force) {
        const { checked, freshness } = await performScanFreshnessCheck(
          scanResultOptions,
          uniqueFiles,
          cwd,
        );
        if (checked && !freshness.fresh) {
          console.error(
            'Error: Source files have been modified since the last scan:',
          );
          for (const f of freshness.staleFiles) {
            console.error(`  ${f}`);
          }
          console.error('');
          console.error(
            'Run "shiori scan" to refresh, or use --force to skip this check.',
          );
          process.exitCode = 1;
          return;
        }
      }

      // Plan bulk resolve
      const bulkResult = planBulkResolve(closedRefs, {
        annotations: scanResult.annotations,
        registry,
        fileContents,
        removeDirective,
      });

      if (!apply) {
        // Dry-run: show preview in requested format
        const textPreview = formatBulkResolvePreview(bulkResult);
        const output = formatResolveOutput({
          format,
          bulkResult,
          applied: false,
          textOutput: textPreview,
        });
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Resolve preview',
        });
        if (!written) return;
        return;
      }

      // Apply mode
      if (
        bulkResult.allActions.length === 0 &&
        bulkResult.allRegistryRemovals.length === 0
      ) {
        console.error('No actions to apply for closed refs.');
        return;
      }

      // Confirmation: --apply --closed without --yes shows summary and exits
      if (!yes) {
        const textPreview = formatBulkResolvePreview(bulkResult);
        const output = formatResolveOutput({
          format,
          bulkResult,
          applied: false,
          textOutput: textPreview,
        });
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Resolve preview',
        });
        if (!written) return;
        if (format === 'text') {
          console.error('');
          console.error('Add --yes to confirm and apply changes.');
        }
        return;
      }

      // Check git status
      await warnIfGitDirty(cwd);

      // Validate path boundaries
      const byFile = groupResolveActionsByFile(bulkResult.allActions);
      const sourceFiles = [...byFile.keys()].map((file) => resolve(cwd, file));
      try {
        await assertAllWithinCwd(sourceFiles, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }

      // Apply file modifications (using merged allActions to avoid line offset issues)
      let totalModified = 0;
      const allWarnings: string[] = [];

      for (const [file, actions] of byFile) {
        const filePath = resolve(cwd, file);
        const content =
          fileContents.get(file) ?? (await readFile(filePath, 'utf-8'));
        const editResult = applyResolveToFile(content, actions);
        await writeFile(filePath, editResult.content, 'utf-8');
        totalModified += editResult.modifiedLines;
        allWarnings.push(...editResult.warnings);
      }

      // Update registry
      const updatedRegistry = { ...registry };
      for (const removal of bulkResult.allRegistryRemovals) {
        delete updatedRegistry[removal];
      }

      const saved = await saveRegistryRouted({
        registry: updatedRegistry,
        registryPath,
        cwd,
        refPatterns: config.refPatterns,
        label: 'Resolved (--closed)',
      });
      if (!saved) return;

      // Journal: record bulk resolve operation
      recordJournalEvent({
        cwd,
        eventType: 'cli.resolve.bulk',
        refs: closedRefs,
        success: true,
        entriesRemoved: bulkResult.allRegistryRemovals.length,
      });

      // Report summary to stderr (always, regardless of format)
      console.error(
        `Resolved ${closedRefs.length} closed ref(s): ${closedRefs.join(', ')}`,
      );
      if (totalModified > 0) {
        console.error(
          `Modified ${totalModified} line(s) across ${bulkResult.totalFilesAffected} file(s)`,
        );
      }
      if (bulkResult.allRegistryRemovals.length > 0) {
        console.error(
          `Removed ${bulkResult.allRegistryRemovals.length} registry entry/entries`,
        );
      }

      if (bulkResult.allSkipped.length > 0) {
        console.error('');
        console.error(
          `Skipped ${bulkResult.allSkipped.length} annotation(s) (stale scan result):`,
        );
        for (const s of bulkResult.allSkipped) {
          console.error(`  ${s.file}:${s.line}: ${s.reason}`);
        }
        console.error(
          'Run "shiori scan" to refresh scan results before resolving.',
        );
      }

      if (allWarnings.length > 0) {
        console.error('');
        console.error('Warnings:');
        for (const w of allWarnings) {
          console.error(`  ${w}`);
        }
      }

      console.error('');
      console.error(
        'Run "shiori check" to verify remaining annotations are valid.',
      );

      // JSON output after apply (for automation/webhook consumption)
      if (format === 'json') {
        const output = formatResolveOutput({
          format,
          bulkResult,
          applied: true,
          textOutput: '',
        });
        const written = await writeOutput(output, {
          outputPath: ctx.values.output,
          cwd,
          label: 'Resolve result',
        });
        if (!written) return;
      }
      return;
    }

    // ── Single ref mode (original --ref behavior) ────────────

    if (!ref) {
      console.error('Error: --ref is required in single-ref mode.');
      process.exitCode = 1;
      return;
    }

    // Pre-load file contents for matching annotations
    const matchingAnnotations = scanResult.annotations.filter(
      (a) => a.ref === ref,
    );
    const fileContents = new Map<string, string>();
    const uniqueFiles = [
      ...new Set(matchingAnnotations.map((a) => a.location.file)),
    ];

    for (const file of uniqueFiles) {
      const filePath = resolve(cwd, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        fileContents.set(file, content);
      } catch {
        console.error(`Warning: Could not read file ${filePath}, skipping.`);
      }
    }

    // Scan-result freshness check: compare mtime of scan-result vs source files
    if (!force) {
      const { checked, freshness } = await performScanFreshnessCheck(
        scanResultOptions,
        uniqueFiles,
        cwd,
      );
      if (checked && !freshness.fresh) {
        console.error(
          'Error: Source files have been modified since the last scan:',
        );
        for (const f of freshness.staleFiles) {
          console.error(`  ${f}`);
        }
        console.error('');
        console.error(
          'Run "shiori scan" to refresh, or use --force to skip this check.',
        );
        process.exitCode = 1;
        return;
      }
    }

    // Plan resolve
    const result = planResolve({
      ref,
      annotations: scanResult.annotations,
      registry,
      fileContents,
      removeDirective,
    });

    if (!apply) {
      // Dry-run: show preview
      console.log(formatResolvePreview(result, ref));
      return;
    }

    // Apply mode
    if (result.actions.length === 0 && result.registryRemovals.length === 0) {
      console.error(`No annotations or registry entries found for "${ref}".`);
      return;
    }

    // Check git status
    await warnIfGitDirty(cwd);

    // Validate source file write targets are within cwd
    // (Registry path validation is handled by saveRegistryRouted)
    const byFile = groupResolveActionsByFile(result.actions);
    const sourceFiles = [...byFile.keys()].map((file) => resolve(cwd, file));

    try {
      await assertAllWithinCwd(sourceFiles, cwd);
    } catch (err) {
      if (err instanceof PathBoundaryError) {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // Apply file modifications
    let totalModified = 0;
    const allWarnings: string[] = [];

    for (const [file, actions] of byFile) {
      const filePath = resolve(cwd, file);
      const content =
        fileContents.get(file) ?? (await readFile(filePath, 'utf-8'));
      const editResult = applyResolveToFile(content, actions);
      await writeFile(filePath, editResult.content, 'utf-8');
      totalModified += editResult.modifiedLines;
      allWarnings.push(...editResult.warnings);
    }

    // Update registry: remove resolved ref
    const updatedRegistry = { ...registry };
    for (const removal of result.registryRemovals) {
      delete updatedRegistry[removal];
    }

    const saved = await saveRegistryRouted({
      registry: updatedRegistry,
      registryPath,
      cwd,
      refPatterns: config.refPatterns,
      label: 'Resolved',
    });
    if (!saved) return;

    // Journal: record single-ref resolve operation
    recordJournalEvent({
      cwd,
      eventType: 'cli.resolve',
      refs: [ref],
      success: true,
      entriesRemoved: result.registryRemovals.length,
    });

    // Report
    console.error(`Resolved ref "${ref}"`);
    if (totalModified > 0) {
      console.error(
        `Modified ${totalModified} line(s) across ${result.filesAffected} file(s)`,
      );
    }
    if (result.registryRemovals.length > 0) {
      console.error(
        `Removed ${result.registryRemovals.length} registry entry/entries`,
      );
    }

    if (result.skipped.length > 0) {
      console.error('');
      console.error(
        `Skipped ${result.skipped.length} annotation(s) (stale scan result):`,
      );
      for (const s of result.skipped) {
        console.error(`  ${s.file}:${s.line}: ${s.reason}`);
      }
      console.error(
        'Run "shiori scan" to refresh scan results before resolving.',
      );
    }

    if (allWarnings.length > 0) {
      console.error('');
      console.error('Warnings:');
      for (const w of allWarnings) {
        console.error(`  ${w}`);
      }
    }

    console.error('');
    console.error(
      'Run "shiori check" to verify remaining annotations are valid.',
    );
  },
});
