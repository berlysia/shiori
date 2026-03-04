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
import { routeRegistryByPattern } from './registry-generator.ts';
import {
  planResolve,
  applyResolveToFile,
  groupResolveActionsByFile,
  formatResolvePreview,
} from './resolve.ts';

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

export const resolveCommand = define({
  name: 'resolve',
  description:
    'Remove resolved or expired annotations from source and registry',
  examples: `  # Preview resolve plan (dry-run, default)
  shiori scan && shiori resolve --ref SUP-1234

  # Apply resolve (write to files + registry)
  shiori scan && shiori resolve --ref SUP-1234 --apply

  # Also remove lint disable directive
  shiori scan && shiori resolve --ref SUP-1234 --apply --remove-directive`,
  rendering: { header: null },
  args: {
    ref: {
      type: 'string',
      required: true,
      description: 'The ref to resolve (e.g. "SUP-1234", "ADR:0007")',
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
    const removeDirective = ctx.values['remove-directive'] ?? false;
    const ref = ctx.values.ref;

    if (!ref) {
      console.error('Error: --ref is required.');
      process.exitCode = 1;
      return;
    }

    const { config, registry, registryPath } = await loadConfigAndRegistry({
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
    const gitDirty = await isGitDirty(cwd);
    if (gitDirty === true) {
      console.error(
        'Warning: Git working tree has uncommitted changes. Consider committing first.',
      );
    }

    // Validate all write targets are within cwd
    const byFile = groupResolveActionsByFile(result.actions);
    const sourceFiles = [...byFile.keys()].map((file) => resolve(cwd, file));

    const registryTargets: string[] = [registryPath];
    if (config.refPatterns) {
      const routedForValidation = routeRegistryByPattern(
        registry,
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

    if (config.refPatterns) {
      const routed = routeRegistryByPattern(
        updatedRegistry,
        config.refPatterns,
      );
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
      await saveRegistry(registryPath, updatedRegistry);
    }

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
