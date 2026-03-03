import { define } from 'gunshi';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { saveRegistry } from '../core/registry.ts';
import { loadConfigAndRegistry } from '../core/registry-loader.ts';
import { loadScanResult } from '../core/scan-result-loader.ts';
import {
  assertAllWithinCwd,
  PathBoundaryError,
} from '../core/path-boundary.ts';
import { routeRegistryByPattern, isValidRef } from './registry-generator.ts';
import { applyMigrateToFile, groupActionsByFile } from './migrate.ts';
import { planAdoption, formatAdoptPreview } from './adopt.ts';

const execFileAsync = promisify(execFile);

/**
 * Check if git working tree has uncommitted changes.
 * Returns true if dirty, false if clean, undefined if not a git repo.
 */
async function isGitDirty(cwd: string): Promise<boolean | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd,
    });
    return stdout.trim().length > 0;
  } catch {
    return undefined;
  }
}

export const adoptCommand = define({
  name: 'adopt',
  description:
    'Adopt existing lint disable comments into shiori tracking (onboarding wizard)',
  examples: `  # Preview adoption plan (dry-run, default)
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
    const prefix = ctx.values.prefix ?? 'ADOPT';
    const reason = ctx.values.reason ?? 'adopted by shiori adopt';
    const kind = ctx.values.kind ?? 'adoption';

    // Validate prefix format
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

    // Plan adoption
    const result = planAdoption({
      candidates: scanResult.candidates,
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

    if (!apply) {
      // Dry-run: show preview
      console.log(formatAdoptPreview(result));
      console.error('');
      console.error(
        'Run with --apply to write changes to source files and registry.',
      );
      return;
    }

    // Apply mode: check git status
    const gitDirty = await isGitDirty(cwd);
    if (gitDirty === true) {
      console.error(
        'Warning: Git working tree has uncommitted changes. Consider committing first.',
      );
    }

    // Validate all write targets are within cwd
    const byFile = groupActionsByFile(result.migrate.actions);
    const sourceFiles = [...byFile.keys()].map((file) => resolve(cwd, file));

    const registryTargets: string[] = [registryPath];
    if (config.refPatterns) {
      const mergedForValidation = {
        ...existingRegistry,
        ...result.migrate.registry,
      };
      const routedForValidation = routeRegistryByPattern(
        mergedForValidation,
        config.refPatterns,
      );
      const basePath = dirname(resolve(registryPath));
      for (const [target] of routedForValidation) {
        if (target !== null) {
          registryTargets.push(resolve(basePath, target));
        }
      }
    }

    try {
      await assertAllWithinCwd([...sourceFiles, ...registryTargets], cwd);
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

    if (config.refPatterns) {
      const routed = routeRegistryByPattern(mergedRegistry, config.refPatterns);
      const basePath = dirname(resolve(registryPath));

      for (const [target, entries] of routed) {
        if (target === null) {
          await saveRegistry(registryPath, entries);
        } else {
          const targetPath = resolve(basePath, target);
          await saveRegistry(targetPath, entries);
        }
      }
    } else {
      await saveRegistry(registryPath, mergedRegistry);
    }

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
  },
});
