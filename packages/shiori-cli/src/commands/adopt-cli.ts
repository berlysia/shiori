import { createInterface } from 'node:readline/promises';
import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  loadConfigAndRegistry,
  type ConfigAndRegistryResult,
} from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import type { ResolvedConfig } from '../core/config.ts';
import {
  assertAllWithinCwd,
  PathBoundaryError,
} from '../core/path-boundary.ts';
import { RegistryNotFoundError } from '../core/errors.ts';
import { autoInitProject } from '../core/auto-init.ts';
import { warnIfGitDirty, saveRegistryRouted } from '../core/cli-context.ts';
import { recordJournalEvent } from '../core/journal.ts';
import { isValidRef } from '../core/ref-validation.ts';
import {
  suggestPrefixes,
  suggestNextRef,
  type PrefixSuggestion,
} from '../core/ref-suggestion.ts';
import { applyMigrateToFile, groupActionsByFile } from './migrate.ts';
import {
  planAdoption,
  formatAdoptPreview,
  buildGroupKey,
  buildGroupSummaries,
  filterCandidatesByGroups,
  type AdoptGroupSummary,
} from './adopt.ts';
import { formatGroupLabel } from '../core/format-utils.ts';
import { ExitCode } from '../core/exit-codes.ts';
import type { ShioriCandidate, Registry } from '../core/types.ts';

/**
 * Wizard Step 1: Interactive group selection.
 * Shows numbered menu of candidate groups, allows multi-select.
 * Follows guide-cli.ts interactiveSelect() pattern.
 */
async function wizardSelectGroups(
  groups: AdoptGroupSummary[],
): Promise<AdoptGroupSummary[] | undefined> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const lines: string[] = [];
    lines.push('');
    lines.push('shiori adopt --wizard — Select groups to adopt');
    lines.push('');
    lines.push('Available candidate groups:');

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      const label = formatGroupLabel(g);
      lines.push(`  ${i + 1}. ${label} (${g.count} candidate(s))`);
    }

    lines.push('');
    lines.push(
      `Enter numbers to adopt (comma-separated, e.g. "1,3"), "all" for all, or "q" to quit:`,
    );

    console.error(lines.join('\n'));

    const answer = await rl.question('> ');
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === 'q' || trimmed === 'quit' || trimmed === '') {
      return undefined;
    }

    if (trimmed === 'all' || trimmed === 'a') {
      return groups;
    }

    // Parse comma-separated numbers
    const parts = trimmed.split(',').map((s) => s.trim());
    const selected: AdoptGroupSummary[] = [];

    for (const part of parts) {
      const num = parseInt(part, 10);
      if (Number.isNaN(num) || num < 1 || num > groups.length) {
        console.error(`Invalid selection: ${part}`);
        return undefined;
      }
      const group = groups[num - 1]!;
      if (!selected.includes(group)) {
        selected.push(group);
      }
    }

    return selected.length > 0 ? selected : undefined;
  } finally {
    rl.close();
  }
}

/**
 * Wizard Step 1.5: Suggest ref prefix based on registry and config.
 * Shows numbered suggestions from suggestPrefixes() and a next-ref preview.
 * Returns selected prefix or undefined if cancelled.
 */
async function wizardSuggestPrefix(opts: {
  registry: Registry;
  refPatterns: import('../core/ref-pattern.ts').RefPatternConfig[] | undefined;
  currentPrefix: string;
}): Promise<string | undefined> {
  const { registry, refPatterns, currentPrefix } = opts;
  const { suggestions } = suggestPrefixes({ registry, refPatterns });

  // Nothing to suggest — keep current prefix
  if (suggestions.length === 0) {
    return currentPrefix;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const lines: string[] = [];
    lines.push('');
    lines.push('Suggested ref prefixes:');
    lines.push('');

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i]!;
      const next = suggestNextRef(s.prefix, registry);
      const sourceLabel = formatPrefixSource(s);
      lines.push(
        `  ${i + 1}. ${s.prefix} → next: ${next.ref}  (${sourceLabel})`,
      );
    }

    lines.push('');
    lines.push(
      `Enter number to select, or type a custom prefix (Enter = ${suggestions[0]!.prefix}), "q" to quit:`,
    );

    console.error(lines.join('\n'));

    const answer = await rl.question('> ');
    const trimmed = answer.trim();

    if (trimmed.toLowerCase() === 'q' || trimmed.toLowerCase() === 'quit') {
      return undefined;
    }

    // Empty input → accept first suggestion
    if (trimmed === '') {
      return suggestions[0]!.prefix;
    }

    // Numeric selection
    const num = parseInt(trimmed, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= suggestions.length) {
      return suggestions[num - 1]!.prefix;
    }

    // Custom prefix input (uppercase)
    return trimmed;
  } finally {
    rl.close();
  }
}

/**
 * Format a prefix suggestion source for display.
 * Exported for testing.
 */
export function formatPrefixSource(s: PrefixSuggestion): string {
  switch (s.source) {
    case 'registry':
      return `${s.usageCount} existing ref(s)`;
    case 'refPattern':
      return 'from config';
    case 'default':
      return s.reason;
  }
}

/**
 * Wizard Step 2: Confirm prefix and reason.
 * Shows current defaults and allows override.
 */
async function wizardConfirmOptions(opts: {
  prefix: string;
  reason: string;
  kind: string;
  selectedCount: number;
  totalCount: number;
}): Promise<
  | { prefix: string; reason: string; kind: string; confirmed: true }
  | { confirmed: false }
> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const lines: string[] = [];
    lines.push('');
    lines.push(
      `Selected ${opts.selectedCount} of ${opts.totalCount} candidate(s)`,
    );
    lines.push('');
    lines.push(`  Prefix: ${opts.prefix}`);
    lines.push(`  Reason: ${opts.reason}`);
    lines.push(`  Kind:   ${opts.kind}`);
    lines.push('');
    lines.push(
      'Press Enter to confirm, or type "prefix=<NEW>" / "reason=<NEW>" / "kind=<NEW>" to override:',
    );
    console.error(lines.join('\n'));

    const answer = await rl.question('> ');
    const trimmed = answer.trim();

    if (trimmed === 'q' || trimmed === 'quit') {
      return { confirmed: false };
    }

    let { prefix, reason, kind } = opts;

    if (trimmed !== '') {
      // Parse key=value overrides
      const overrides = trimmed.split(/\s+/);
      for (const override of overrides) {
        const eqIdx = override.indexOf('=');
        if (eqIdx === -1) continue;
        const key = override.slice(0, eqIdx).toLowerCase();
        const value = override.slice(eqIdx + 1);
        if (key === 'prefix' && value) prefix = value;
        else if (key === 'reason' && value) reason = value;
        else if (key === 'kind' && value) kind = value;
      }
    }

    return { prefix, reason, kind, confirmed: true };
  } finally {
    rl.close();
  }
}

/**
 * Wizard Step 3: Final confirmation before applying changes.
 * Follows doctor-cli.ts confirm() pattern.
 */
async function wizardConfirmApply(previewText: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    console.error('');
    console.error('--- Adoption Preview ---');
    console.error(previewText);
    console.error('--- End Preview ---');
    console.error('');

    const answer = await rl.question(
      'Apply these changes to source files and registry? [y/N] ',
    );
    return (
      answer.trim().toLowerCase() === 'y' ||
      answer.trim().toLowerCase() === 'yes'
    );
  } finally {
    rl.close();
  }
}

export const adoptCommand = define({
  name: 'adopt',
  description:
    'Adopt existing lint disable comments into shiori tracking (onboarding wizard)',
  examples: `  # Interactive wizard (recommended for first-time adoption)
  shiori scan && shiori adopt --wizard

  # Preview adoption plan (dry-run, default)
  shiori scan && shiori adopt

  # Apply adoption (write to files + registry)
  shiori scan && shiori adopt --apply

  # Custom ref prefix and reason
  shiori scan && shiori adopt --apply --prefix DEBT --reason "legacy code"

  # Pipe from scan
  shiori scan | shiori adopt`,
  rendering: { header: null },
  args: {
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
    prefix: {
      type: 'string',
      description: 'Ref prefix for generated refs. Default: "ADOPT"',
      default: 'ADOPT',
    },
    reason: {
      type: 'string',
      description:
        'Default reason for registry entries. Default: "adopted by shiori adopt"',
      default: 'adopted by shiori adopt',
    },
    kind: {
      type: 'string',
      description: 'Default kind for registry entries. Default: "adoption"',
      default: 'adoption',
    },
    apply: {
      type: 'boolean',
      short: 'a',
      description:
        'Actually write changes to source files and registry (default: dry-run preview)',
    },
    wizard: {
      type: 'boolean',
      short: 'w',
      description:
        'Interactive wizard for selective adoption — choose which groups to adopt',
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
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const apply = ctx.values.apply ?? false;
    const wizard = ctx.values.wizard ?? false;
    let prefix = ctx.values.prefix ?? 'ADOPT';
    let reason = ctx.values.reason ?? 'adopted by shiori adopt';
    let kind = ctx.values.kind ?? 'adoption';

    // --wizard and --apply are mutually exclusive
    if (wizard && apply) {
      console.error(
        'Error: --wizard and --apply are mutually exclusive. --wizard includes its own apply confirmation step.',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Wizard requires TTY; fall back to dry-run for non-TTY
    if (wizard && !process.stdin.isTTY) {
      console.error(
        'Warning: --wizard requires an interactive terminal. Falling back to dry-run mode.',
      );
    }

    // Validate prefix format (also re-validated after wizard override)
    if (!/^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/.test(prefix)) {
      console.error(
        `Error: Invalid --prefix "${prefix}". Must start with uppercase letter, e.g. "ADOPT", "DEBT", "JIRA:PROJ"`,
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Load config + registry, auto-initializing if not yet set up (EP-0152)
    let loadResult: ConfigAndRegistryResult;
    try {
      loadResult = await loadConfigAndRegistry({
        cwd,
        configDir: ctx.values.config,
        registryPath: ctx.values.registry,
      });
    } catch (err) {
      if (err instanceof RegistryNotFoundError) {
        // Auto-initialize config + empty registry
        const initResult = await autoInitProject({
          cwd,
          configDir: ctx.values.config,
          registryPath: ctx.values.registry,
        });
        const parts: string[] = [];
        if (initResult.configCreated) parts.push('config');
        if (initResult.registryCreated) parts.push('registry');
        if (parts.length > 0) {
          console.error(
            `Auto-initialized .config/shiori/ (${parts.join(', ')}). Run "shiori init" for full setup.`,
          );
        }
        // Retry loading after auto-init
        loadResult = await loadConfigAndRegistry({
          cwd,
          configDir: ctx.values.config,
          registryPath: ctx.values.registry,
        });
      } else {
        throw err;
      }
    }

    const { config, registry: existingRegistry, registryPath } = loadResult;

    // Load scan result
    const scanResult = await loadScanResult({
      explicitPath: ctx.values.scan,
      config,
      cwd,
    });

    if (scanResult.candidates.length === 0) {
      console.error('No candidates found. Nothing to adopt.');
      console.error('All lint disable comments are already tracked by shiori.');
      return;
    }

    // ── Wizard flow ──
    let candidates: ShioriCandidate[] = scanResult.candidates;

    if (wizard && process.stdin.isTTY) {
      // Step 1: Group selection
      const allGroups = buildGroupSummaries(candidates);

      console.error(
        `Found ${candidates.length} untracked candidate(s) in ${allGroups.length} group(s).`,
      );

      const selectedGroups = await wizardSelectGroups(allGroups);
      if (!selectedGroups) {
        console.error('Adoption cancelled.');
        return;
      }

      // Filter candidates to selected groups (using shared buildGroupKey)
      const selectedKeys = new Set(selectedGroups.map(buildGroupKey));
      candidates = filterCandidatesByGroups(candidates, selectedKeys);

      if (candidates.length === 0) {
        console.error('No candidates in selected groups.');
        return;
      }

      // Step 1.5: Suggest ref prefix (from registry patterns and config)
      const suggestedPrefix = await wizardSuggestPrefix({
        registry: existingRegistry,
        refPatterns: config.refPatterns,
        currentPrefix: prefix,
      });
      if (suggestedPrefix === undefined) {
        console.error('Adoption cancelled.');
        return;
      }
      prefix = suggestedPrefix;

      // Show next ref preview after prefix selection
      const nextRef = suggestNextRef(prefix, existingRegistry);
      console.error(`  → Next ref: ${nextRef.ref}`);

      // Step 2: Confirm/override options
      const optResult = await wizardConfirmOptions({
        prefix,
        reason,
        kind,
        selectedCount: candidates.length,
        totalCount: scanResult.candidates.length,
      });

      if (!optResult.confirmed) {
        console.error('Adoption cancelled.');
        return;
      }

      prefix = optResult.prefix;
      reason = optResult.reason;
      kind = optResult.kind;

      // Re-validate prefix after potential override
      if (!/^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/.test(prefix)) {
        console.error(
          `Error: Invalid prefix "${prefix}". Must start with uppercase letter, e.g. "ADOPT", "DEBT", "JIRA:PROJ"`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }

    // Plan adoption (with possibly filtered candidates)
    const result = planAdoption({
      candidates,
      existingRegistry,
      prefix,
      reason,
      kind,
    });

    // Validate generated refs
    for (const action of result.migrate.actions) {
      if (!isValidRef(action.ref)) {
        console.error(
          `Error: Generated ref "${action.ref}" is invalid. Try a different --prefix.`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }
    }

    // ── Wizard: show preview and confirm apply ──
    if (wizard && process.stdin.isTTY) {
      const previewText = formatAdoptPreview(result);
      const confirmed = await wizardConfirmApply(previewText);
      if (!confirmed) {
        console.error('Adoption cancelled.');
        return;
      }

      // Wizard auto-applies on confirmation (no --apply needed)
      return await applyAdoption({
        result,
        existingRegistry,
        registryPath,
        config,
        cwd,
      });
    }

    // ── Non-wizard flow ──
    if (!apply) {
      // Dry-run: show preview
      console.log(formatAdoptPreview(result));
      console.error('');
      console.error(
        'Run with --apply to write changes to source files and registry.',
      );
      return;
    }

    return await applyAdoption({
      result,
      existingRegistry,
      registryPath,
      config,
      cwd,
    });
  },
});

/**
 * Apply adoption changes to source files and registry.
 * Extracted to avoid duplication between wizard and --apply paths.
 */
async function applyAdoption(opts: {
  result: ReturnType<typeof planAdoption>;
  existingRegistry: Registry;
  registryPath: string;
  config: ResolvedConfig;
  cwd: string;
}): Promise<void> {
  const { result, existingRegistry, registryPath, config, cwd } = opts;

  // Check git status
  await warnIfGitDirty(cwd);

  // Validate source file write targets are within cwd
  const byFile = groupActionsByFile(result.migrate.actions);
  const sourceFiles = [...byFile.keys()].map((file) => resolve(cwd, file));

  try {
    await assertAllWithinCwd(sourceFiles, cwd);
  } catch (err) {
    if (err instanceof PathBoundaryError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = ExitCode.ENVIRONMENT_ERROR;
      return;
    }
    throw err;
  }

  // Apply file modifications (non-atomic: files are written sequentially;
  // partial failure leaves already-written files modified on disk)
  let totalModified = 0;
  const allWarnings: string[] = [];
  const writtenFiles: string[] = [];

  for (const [file, actions] of byFile) {
    const filePath = resolve(cwd, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const editResult = applyMigrateToFile(content, actions);
      await writeFile(filePath, editResult.content, 'utf-8');
      writtenFiles.push(file);
      totalModified += editResult.modifiedLines;
      allWarnings.push(...editResult.warnings);
    } catch (err) {
      console.error(
        `Error writing ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (writtenFiles.length > 0) {
        console.error(
          `Warning: ${writtenFiles.length} file(s) were already modified before the error:`,
        );
        for (const f of writtenFiles) {
          console.error(`  ${f}`);
        }
        console.error(
          'Use "git checkout" or "git stash" to revert partial changes.',
        );
      }
      process.exitCode = ExitCode.ENVIRONMENT_ERROR;
      return;
    }
  }

  // Update registry
  const mergedRegistry = {
    ...existingRegistry,
    ...result.migrate.registry,
  };

  const saved = await saveRegistryRouted({
    registry: mergedRegistry,
    registryPath,
    cwd,
    refPatterns: config.refPatterns,
    label: 'Adopted',
  });
  if (!saved) return;

  // Journal: record adopt operation
  const adoptedRefs = Object.keys(result.migrate.registry);
  recordJournalEvent({
    cwd,
    eventType: 'cli.adopt',
    refs: adoptedRefs,
    success: true,
    entriesAdded: adoptedRefs.length,
  });

  // Report
  console.error(
    `Adopted ${result.migrate.actions.length} candidate(s) across ${result.filesAffected} file(s)`,
  );
  console.error(
    `Modified ${totalModified} line(s), added ${Object.keys(result.migrate.registry).length} registry entry/entries`,
  );

  if (allWarnings.length > 0) {
    console.error('');
    console.error('Warnings:');
    for (const w of allWarnings) {
      console.error(`  ${w}`);
    }
  }

  console.error('');
  console.error(
    'Run "shiori check" to verify all adopted annotations are valid.',
  );
}
