/**
 * Staged CLI context builders for shared setup across CLI wrappers.
 *
 * Eliminates repeated boilerplate (cwd resolution, config+registry loading,
 * scan pattern resolution, expiring threshold, git dirty check, routed save)
 * by providing composable building blocks.
 *
 * @see EP-0002 for design rationale
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { saveRegistry } from './registry.ts';
import type { Registry } from './types.ts';
import type { ResolvedConfig } from './config.ts';
import type { RefPatternConfig } from './ref-pattern.ts';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
  type ConfigAndRegistryResult,
} from './registry-loader.ts';
import {
  loadScanResult,
  type LoadScanResultOptions,
} from './scan-result-loader.ts';
import type { ScanResult } from './types.ts';
import { DEFAULT_SCAN_PATTERNS, DEFAULT_SCAN_IGNORE } from './scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from './path-boundary.ts';
import { routeRegistryByPattern } from './registry-router.ts';

const execFileAsync = promisify(execFile);

// ── Stage 1: Base Context ──────────────────────────────────

/** Base context: resolved cwd */
export interface BaseContext {
  cwd: string;
}

/**
 * Create the base context by resolving the working directory.
 *
 * @param cwdArg - Value of the --cwd CLI flag (undefined falls back to process.cwd())
 */
export function createBaseContext(cwdArg: string | undefined): BaseContext {
  return { cwd: cwdArg ?? process.cwd() };
}

// ── Stage 2: With Registry ─────────────────────────────────

/** Context after config and registry are loaded */
export interface RegistryContext extends BaseContext {
  config: ResolvedConfig;
  registry: Registry;
  registryPath: string;
  duplicates: ConfigAndRegistryResult['duplicates'];
  refOrigins: ConfigAndRegistryResult['refOrigins'];
}

/**
 * Load config and multi-registry, report issues to stderr.
 *
 * @param base - Base context (cwd)
 * @param options - CLI flag values for config/registry overrides
 */
export async function withRegistry(
  base: BaseContext,
  options: {
    configDir?: string;
    registryPath?: string;
  },
): Promise<RegistryContext> {
  const result = await loadConfigAndRegistry({
    cwd: base.cwd,
    configDir: options.configDir,
    registryPath: options.registryPath,
  });
  reportRegistryIssues(result);

  return {
    ...base,
    config: result.config,
    registry: result.registry,
    registryPath: result.registryPath,
    duplicates: result.duplicates,
    refOrigins: result.refOrigins,
  };
}

/** Context after scan result is loaded (read-only commands that consume pre-existing scan output) */
export interface ScanResultContext extends RegistryContext {
  scanResult: ScanResult;
}

/**
 * Load a pre-existing scan result (stdin / file / config path).
 *
 * Used by read-only commands like `verify` that consume `scan` output.
 *
 * @param regCtx - Registry context
 * @param scanArg - Value of the --scan CLI flag
 */
export async function withScanResult(
  regCtx: RegistryContext,
  scanArg: string | undefined,
): Promise<ScanResultContext> {
  const scanResult = await loadScanResult({
    explicitPath: scanArg,
    config: regCtx.config,
    cwd: regCtx.cwd,
  });
  return { ...regCtx, scanResult };
}

// ── Utilities ──────────────────────────────────────────────

/**
 * Resolve scan patterns from CLI flags or config, falling back to defaults.
 *
 * @param patternsArg - Value of the --patterns CLI flag (comma-separated)
 * @param ignoreArg - Value of the --ignore CLI flag (comma-separated)
 * @param config - Resolved configuration
 */
export function resolveScanPatterns(
  patternsArg: string | undefined,
  ignoreArg: string | undefined,
  config: ResolvedConfig,
): { patterns: string[]; ignore: string[] } {
  const patterns = patternsArg
    ? patternsArg.split(',').map((s) => s.trim())
    : (config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

  const ignore = ignoreArg
    ? ignoreArg.split(',').map((s) => s.trim())
    : [...DEFAULT_SCAN_IGNORE, ...(config.scanIgnore ?? [])];

  return { patterns, ignore };
}

/**
 * Resolve the expiring threshold from CLI flag or config.
 *
 * Validates that the CLI value is a finite positive integer.
 * Falls back to `config.verify.expiringThresholdDays` when no flag is given.
 *
 * @param thresholdArg - Value of the --expiring-threshold CLI flag
 * @param config - Resolved configuration
 * @throws {Error} When the CLI value is not a valid positive integer
 */
export function resolveExpiringThreshold(
  thresholdArg: string | undefined,
  config: ResolvedConfig,
): number {
  if (thresholdArg === undefined) {
    return config.verify.expiringThresholdDays;
  }
  const parsed = Number.parseInt(thresholdArg, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid --expiring-threshold value: ${JSON.stringify(thresholdArg)}. Must be a positive integer.`,
    );
  }
  return parsed;
}

/**
 * Check if the git working tree has uncommitted changes.
 *
 * @returns `true` if dirty, `false` if clean, `undefined` if git is not available
 */
export async function warnIfGitDirty(
  cwd: string,
): Promise<boolean | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd,
    });
    const dirty = stdout.trim().length > 0;
    if (dirty) {
      console.error(
        'Warning: Git working tree has uncommitted changes. Consider committing first.',
      );
    }
    return dirty;
  } catch {
    // Not a git repo or git not available
    return undefined;
  }
}

/**
 * Save registry entries routed by refPattern configuration.
 *
 * Validates all write targets are within cwd before any I/O.
 * Handles both simple (single file) and routed (multi-file) saves.
 *
 * @returns `true` on success, `false` if a path boundary error occurred (exitCode set)
 */
export async function saveRegistryRouted(options: {
  registry: Registry;
  registryPath: string;
  cwd: string;
  refPatterns: RefPatternConfig[] | undefined;
  label?: string;
  /** When true, suppress per-file log messages (useful in watch/daemon contexts) */
  quiet?: boolean;
}): Promise<boolean> {
  const { registry, registryPath, cwd, refPatterns, label, quiet } = options;

  // Validate all write targets before any I/O
  try {
    await assertWithinCwd(registryPath, cwd);
    if (refPatterns) {
      const basePath = dirname(resolve(registryPath));
      for (const pattern of refPatterns) {
        if (pattern.registryFile) {
          await assertWithinCwd(resolve(basePath, pattern.registryFile), cwd);
        }
      }
    }
  } catch (err) {
    if (err instanceof PathBoundaryError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return false;
    }
    throw err;
  }

  // Route entries by pattern if refPatterns are configured
  if (refPatterns) {
    const routed = routeRegistryByPattern(registry, refPatterns);
    const basePath = dirname(resolve(registryPath));

    for (const [target, entries] of routed) {
      if (target === null) {
        await saveRegistry(registryPath, entries);
        if (!quiet) {
          console.error(
            `${label ?? 'Updated'} default registry (${Object.keys(entries).length} entries) at ${registryPath}`,
          );
        }
      } else {
        const targetPath = resolve(basePath, target);
        await saveRegistry(targetPath, entries);
        if (!quiet) {
          console.error(
            `${label ?? 'Updated'} pattern registry (${Object.keys(entries).length} entries) at ${targetPath}`,
          );
        }
      }
    }
  } else {
    await saveRegistry(registryPath, registry);
  }

  return true;
}
