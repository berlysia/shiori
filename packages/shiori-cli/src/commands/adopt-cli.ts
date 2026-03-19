import { createInterface } from 'node:readline/promises';
import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfigAndRegistry } from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import type { ResolvedConfig } from '../core/config.ts';
import {
  assertAllWithinCwd,
  PathBoundaryError,
} from '../core/path-boundary.ts';
import { warnIfGitDirty, saveRegistryRouted } from '../core/cli-context.ts';
import { recordJournalEvent } from '../core/journal.ts';
import { isValidRef } from '../core/ref-validation.ts';
import { applyMigrateToFile, groupActionsByFile } from './migrate.ts';
import {
  planAdoption,
  formatAdoptPreview,
  buildGroupSummaries,
  filterCandidatesByGroups,
  formatGroupLabel,
  type AdoptGroupSummary,
} from './adopt.ts';
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
      process.exitCode = 1;
      return;
    }

    const {
      config,
      registry: existingRegistry,
      registryPath,
    } = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

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

      // Filter candidates to selected groups
      const selectedKeys = new Set(
        selectedGroups.map((g) =>
          g.directive ? `${g.pattern}/${g.directive}` : g.pattern,
        ),
      );
      candidates = filterCandidatesByGroups(candidates, selectedKeys);

      if (candidates.length === 0) {
        console.error('No candidates in selected groups.');
        return;
      }

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
        process.exitCode = 1;
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
        process.exitCode = 1;
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
    const content = await readFile(filePath, 'utf-8');
    const editResult = applyMigrateToFile(content, actions);
    await writeFile(filePath, editResult.content, 'utf-8');
    totalModified += editResult.modifiedLines;
    allWarnings.push(...editResult.warnings);
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
