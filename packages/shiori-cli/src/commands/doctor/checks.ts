import { access, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNodeError } from '../../core/errors.ts';
import {
  loadConfig,
  CONFIG_FILENAMES,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_SCAN_RESULT_PATH,
} from '../../core/config.ts';
import type { ResolvedConfig } from '../../core/config.ts';
import type { Registry } from '../../core/types.ts';
import { loadMultiRegistry } from '../../core/registry.ts';
import { matchRefPattern } from '../../core/ref-pattern.ts';
import type { DoctorCheck } from '../../core/types.ts';
import type { ConfigLoadResult, RegistryCheckResult } from './types.ts';

/** Minimum Node.js version required by shiori */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 6;

/**
 * Load config once — returns the resolved config or undefined if loading failed.
 * Failure is not fatal since checkConfig will report it independently.
 */
export async function loadConfigOnce(
  cwd: string,
  configDir?: string,
): Promise<ConfigLoadResult> {
  try {
    const config = await loadConfig(cwd, configDir);
    return { config };
  } catch (err) {
    return {
      config: undefined,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Check that the current Node.js version meets the minimum requirement.
 */
export function checkNodeVersion(): DoctorCheck {
  const version = process.version; // e.g. "v22.6.0"
  const match = version.match(/^v(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return {
      name: 'node-version',
      label: 'Node.js version',
      status: 'fail',
      message: `Could not parse Node.js version: ${version}`,
    };
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (
    major > MIN_NODE_MAJOR ||
    (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)
  ) {
    return {
      name: 'node-version',
      label: 'Node.js version',
      status: 'pass',
      message: `Node.js ${version} (>= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0)`,
    };
  }

  return {
    name: 'node-version',
    label: 'Node.js version',
    status: 'fail',
    message: `Node.js ${version} is below minimum ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`,
    fix: `Upgrade Node.js to >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0`,
  };
}

/**
 * Check that a config file exists and is loadable.
 */
export async function checkConfig(
  cwd: string,
  configDir?: string,
): Promise<DoctorCheck> {
  const dir = configDir ? resolve(cwd, configDir) : join(cwd, '.config/shiori');

  // Check if any config file exists
  let foundConfig: string | undefined;
  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(dir, filename);
    try {
      await access(configPath);
      foundConfig = filename;
      break;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') continue;
      return {
        name: 'config',
        label: 'Configuration',
        status: 'fail',
        message: `Error accessing ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!foundConfig) {
    return {
      name: 'config',
      label: 'Configuration',
      status: 'warn',
      message: 'No config file found (using defaults)',
      fix: 'Run "shiori init" to create .config/shiori/config.yaml',
    };
  }

  // Try to load it
  try {
    await loadConfig(cwd, configDir);
    return {
      name: 'config',
      label: 'Configuration',
      status: 'pass',
      message: `Loaded ${foundConfig}`,
    };
  } catch (err) {
    return {
      name: 'config',
      label: 'Configuration',
      status: 'fail',
      message: `Failed to parse ${foundConfig}: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check config file syntax (YAML/JSON)',
    };
  }
}

/**
 * Check that the registry file exists and is loadable.
 * Uses pre-loaded config to avoid redundant filesystem reads.
 */
export async function checkRegistryWithConfig(
  cwd: string,
  configResult: ConfigLoadResult,
): Promise<RegistryCheckResult> {
  const config = configResult.config;
  if (!config) {
    return {
      check: {
        name: 'registry',
        label: 'Registry',
        status: 'fail',
        message: 'Cannot check registry: config loading failed',
      },
    };
  }

  const registryPath = config.paths.registry
    ? resolve(cwd, config.paths.registry)
    : resolve(cwd, DEFAULT_REGISTRY_PATH);

  try {
    await access(registryPath);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {
        check: {
          name: 'registry',
          label: 'Registry',
          status: 'fail',
          message: `Registry file not found: ${registryPath}`,
          fix: 'Run "shiori init" to create the registry',
        },
      };
    }
    return {
      check: {
        name: 'registry',
        label: 'Registry',
        status: 'fail',
        message: `Error accessing registry: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Try to load and validate the registry
  try {
    const result = await loadMultiRegistry(
      registryPath,
      config.refPatterns,
      undefined,
      cwd,
    );
    const entryCount = Object.keys(result.registry).length;
    const registryRefs = Object.keys(result.registry);

    if (result.errors.length > 0) {
      return {
        check: {
          name: 'registry',
          label: 'Registry',
          status: 'warn',
          message: `Registry loaded with ${result.errors.length} validation error(s) (${entryCount} entries)`,
          fix: 'Run "shiori verify" to see detailed validation errors',
        },
        registryRefs,
        registry: result.registry,
      };
    }

    if (result.duplicates.length > 0) {
      return {
        check: {
          name: 'registry',
          label: 'Registry',
          status: 'warn',
          message: `Registry loaded with ${result.duplicates.length} duplicate warning(s) (${entryCount} entries)`,
          fix: 'Check for duplicate refs across registry files',
        },
        registryRefs,
        registry: result.registry,
      };
    }

    return {
      check: {
        name: 'registry',
        label: 'Registry',
        status: 'pass',
        message: `Registry loaded (${entryCount} entries)`,
      },
      registryRefs,
      registry: result.registry,
    };
  } catch (err) {
    return {
      check: {
        name: 'registry',
        label: 'Registry',
        status: 'fail',
        message: `Failed to load registry: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Check registry file syntax (JSON/YAML)',
      },
    };
  }
}

/**
 * Keep the existing public API for backward compatibility with tests.
 * Delegates to checkRegistryWithConfig internally.
 */
export async function checkRegistry(
  cwd: string,
  configDir?: string,
): Promise<DoctorCheck> {
  const configResult = await loadConfigOnce(cwd, configDir);
  const result = await checkRegistryWithConfig(cwd, configResult);
  return result.check;
}

/**
 * Check that registry refs are consistent with configured refPatterns.
 *
 * When refPatterns are defined, every registry ref should match at least one pattern.
 * Unmatched refs indicate config drift (pattern was removed or ref was added without a pattern).
 *
 * Skipped when refPatterns is not configured (returns pass — no patterns to enforce).
 */
export function checkRefPatternsConsistency(
  config: ResolvedConfig | undefined,
  registryRefs: string[],
): DoctorCheck {
  if (!config?.refPatterns || config.refPatterns.length === 0) {
    return {
      name: 'ref-patterns',
      label: 'Ref patterns',
      status: 'pass',
      message: 'No refPatterns configured (skipped)',
    };
  }

  if (registryRefs.length === 0) {
    return {
      name: 'ref-patterns',
      label: 'Ref patterns',
      status: 'pass',
      message: `${config.refPatterns.length} pattern(s) configured, registry is empty`,
    };
  }

  const unmatchedRefs = registryRefs.filter(
    (ref) => !matchRefPattern(ref, config.refPatterns),
  );

  if (unmatchedRefs.length === 0) {
    return {
      name: 'ref-patterns',
      label: 'Ref patterns',
      status: 'pass',
      message: `All ${registryRefs.length} ref(s) match configured patterns`,
    };
  }

  const examples = unmatchedRefs.slice(0, 3).join(', ');
  const suffix =
    unmatchedRefs.length > 3 ? `, … (${unmatchedRefs.length} total)` : '';

  return {
    name: 'ref-patterns',
    label: 'Ref patterns',
    status: 'warn',
    message: `${unmatchedRefs.length} ref(s) do not match any configured pattern: ${examples}${suffix}`,
    fix: 'Add matching patterns to refPatterns in config, or update refs to follow existing patterns',
  };
}

/** Default staleness threshold in hours (24h) */
const SCAN_RESULT_STALE_HOURS = 24;

/**
 * Check that scan-result.json exists and is reasonably fresh.
 *
 * - Missing: warn (scan has never been run)
 * - Stale (> threshold): warn (results may not reflect current source)
 * - Fresh: pass
 */
export async function checkScanResultFreshness(
  cwd: string,
  config: ResolvedConfig | undefined,
): Promise<DoctorCheck> {
  const scanResultPath = resolve(
    cwd,
    config?.paths.scanResult ?? DEFAULT_SCAN_RESULT_PATH,
  );

  let fileStat;
  try {
    fileStat = await stat(scanResultPath);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {
        name: 'scan-result',
        label: 'Scan result',
        status: 'warn',
        message: 'scan-result.json not found (has "shiori scan" been run?)',
        fix: 'Run "shiori scan" to generate scan results',
      };
    }
    return {
      name: 'scan-result',
      label: 'Scan result',
      status: 'fail',
      message: `Error accessing scan-result.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const ageMs = Date.now() - fileStat.mtimeMs;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > SCAN_RESULT_STALE_HOURS) {
    const ageDisplay =
      ageHours >= 48
        ? `${Math.round(ageHours / 24)}d ago`
        : `${Math.round(ageHours)}h ago`;
    return {
      name: 'scan-result',
      label: 'Scan result',
      status: 'warn',
      message: `scan-result.json is stale (last updated ${ageDisplay})`,
      fix: 'Run "shiori scan" to refresh scan results',
    };
  }

  return {
    name: 'scan-result',
    label: 'Scan result',
    status: 'pass',
    message: 'scan-result.json is up to date',
  };
}

/**
 * Check that scan-result.json is in .gitignore.
 */
export async function checkGitignore(cwd: string): Promise<DoctorCheck> {
  const gitignorePath = join(cwd, '.gitignore');
  const entry = '.config/shiori/scan-result.json';

  try {
    const content = await readFile(gitignorePath, 'utf-8');
    const hasEntry = content
      .split('\n')
      .some((line) => line.trim() === entry.trim());

    if (hasEntry) {
      return {
        name: 'gitignore',
        label: '.gitignore',
        status: 'pass',
        message: 'scan-result.json is in .gitignore',
      };
    }

    return {
      name: 'gitignore',
      label: '.gitignore',
      status: 'warn',
      message: 'scan-result.json is not in .gitignore',
      fix: 'Run "shiori init" or add ".config/shiori/scan-result.json" to .gitignore',
    };
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {
        name: 'gitignore',
        label: '.gitignore',
        status: 'warn',
        message: '.gitignore not found',
        fix: 'Run "shiori init" to create .gitignore with scan-result.json entry',
      };
    }
    return {
      name: 'gitignore',
      label: '.gitignore',
      status: 'fail',
      message: `Error reading .gitignore: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Check for expired registry entries.
 *
 * Warns when entries have an `expires` date in the past, indicating
 * workarounds or temporary suppression that should have been resolved.
 */
export function checkExpiredEntries(
  registry: Registry,
  now?: Date,
): DoctorCheck {
  const currentDate = now ?? new Date();
  const entries = Object.entries(registry);
  if (entries.length === 0) {
    return {
      name: 'expired-entries',
      label: 'Expired entries',
      status: 'pass',
      message: 'No registry entries to check',
    };
  }

  const expired: string[] = [];
  for (const [ref, entry] of entries) {
    if (!entry.expires) continue;
    // Parse YYYY-MM-DD or YYYY-MM format
    const expiresDate = new Date(entry.expires);
    if (!Number.isNaN(expiresDate.getTime()) && expiresDate < currentDate) {
      expired.push(ref);
    }
  }

  if (expired.length === 0) {
    return {
      name: 'expired-entries',
      label: 'Expired entries',
      status: 'pass',
      message: 'No expired entries in registry',
    };
  }

  const examples = expired.slice(0, 3).join(', ');
  const suffix = expired.length > 3 ? `, … (${expired.length} total)` : '';

  return {
    name: 'expired-entries',
    label: 'Expired entries',
    status: 'warn',
    message: `${expired.length} expired entry/entries in registry: ${examples}${suffix}`,
    fix: 'Review and resolve expired entries, or update their expiration dates',
  };
}

/**
 * Check that registry entries have required metadata (reason, owner).
 *
 * Warns about entries with placeholder reasons or missing owners,
 * which indicate incomplete onboarding.
 */
export function checkRegistryCompleteness(registry: Registry): DoctorCheck {
  const entries = Object.entries(registry);
  if (entries.length === 0) {
    return {
      name: 'registry-completeness',
      label: 'Registry completeness',
      status: 'pass',
      message: 'No registry entries to check',
    };
  }

  const incomplete: string[] = [];
  for (const [ref, entry] of entries) {
    if (entry.reason === 'TODO: fill in reason') {
      incomplete.push(ref);
    }
  }

  if (incomplete.length === 0) {
    return {
      name: 'registry-completeness',
      label: 'Registry completeness',
      status: 'pass',
      message: `All ${entries.length} entries have reasons filled in`,
    };
  }

  const examples = incomplete.slice(0, 3).join(', ');
  const suffix =
    incomplete.length > 3 ? `, … (${incomplete.length} total)` : '';

  return {
    name: 'registry-completeness',
    label: 'Registry completeness',
    status: 'warn',
    message: `${incomplete.length} entry/entries have placeholder reasons: ${examples}${suffix}`,
    fix: 'Fill in reasons for these entries in the registry file',
  };
}
