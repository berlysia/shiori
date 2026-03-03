import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNodeError } from '../core/errors.ts';
import {
  loadConfig,
  CONFIG_FILENAMES,
  DEFAULT_REGISTRY_PATH,
} from '../core/config.ts';
import { loadMultiRegistry } from '../core/registry.ts';
import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorResult,
  DoctorFormat,
} from '../core/types.ts';

/** Minimum Node.js version required by shiori */
const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 6;

/** Options for the doctor command (pure logic) */
export interface DoctorOptions {
  /** Working directory */
  cwd: string;
  /** Explicit config directory (from --config flag) */
  configDir?: string;
  /** Whether to show fix suggestions */
  fix?: boolean;
}

/**
 * Run all diagnostic checks and return the result.
 * Pure async function — no console output.
 */
export async function doctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Run checks concurrently where possible
  const [nodeCheck, configCheck] = await Promise.all([
    checkNodeVersion(),
    checkConfig(options.cwd, options.configDir),
  ]);
  checks.push(nodeCheck);
  checks.push(configCheck);

  // Registry check depends on config check to know the registry path
  const registryCheck = await checkRegistry(options.cwd, options.configDir);
  checks.push(registryCheck);

  // gitignore check
  const gitignoreCheck = await checkGitignore(options.cwd);
  checks.push(gitignoreCheck);

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  return { checks, summary };
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
 */
export async function checkRegistry(
  cwd: string,
  configDir?: string,
): Promise<DoctorCheck> {
  // Load config to resolve registry path
  let config;
  try {
    config = await loadConfig(cwd, configDir);
  } catch {
    return {
      name: 'registry',
      label: 'Registry',
      status: 'fail',
      message: 'Cannot check registry: config loading failed',
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
        name: 'registry',
        label: 'Registry',
        status: 'fail',
        message: `Registry file not found: ${registryPath}`,
        fix: 'Run "shiori init" to create the registry',
      };
    }
    return {
      name: 'registry',
      label: 'Registry',
      status: 'fail',
      message: `Error accessing registry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Try to load and validate the registry
  try {
    const result = await loadMultiRegistry(registryPath, config.refPatterns);
    const entryCount = Object.keys(result.registry).length;

    if (result.errors.length > 0) {
      return {
        name: 'registry',
        label: 'Registry',
        status: 'warn',
        message: `Registry loaded with ${result.errors.length} validation error(s) (${entryCount} entries)`,
        fix: 'Run "shiori verify" to see detailed validation errors',
      };
    }

    if (result.duplicates.length > 0) {
      return {
        name: 'registry',
        label: 'Registry',
        status: 'warn',
        message: `Registry loaded with ${result.duplicates.length} duplicate warning(s) (${entryCount} entries)`,
        fix: 'Check for duplicate refs across registry files',
      };
    }

    return {
      name: 'registry',
      label: 'Registry',
      status: 'pass',
      message: `Registry loaded (${entryCount} entries)`,
    };
  } catch (err) {
    return {
      name: 'registry',
      label: 'Registry',
      status: 'fail',
      message: `Failed to load registry: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check registry file syntax (JSON/YAML)',
    };
  }
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

/** Status icon for display */
function statusIcon(status: DoctorCheckStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'warn':
      return '!';
    case 'fail':
      return '✗';
  }
}

/**
 * Format the doctor result as human-readable text.
 */
export function formatDoctorText(
  result: DoctorResult,
  showFix: boolean,
): string {
  const lines: string[] = [];

  lines.push('shiori doctor:');
  lines.push('');

  for (const check of result.checks) {
    lines.push(
      `  ${statusIcon(check.status)} ${check.label}: ${check.message}`,
    );
    if (showFix && check.fix) {
      lines.push(`    → ${check.fix}`);
    }
  }

  lines.push('');
  const parts: string[] = [];
  if (result.summary.pass > 0) parts.push(`${result.summary.pass} passed`);
  if (result.summary.warn > 0) parts.push(`${result.summary.warn} warning(s)`);
  if (result.summary.fail > 0) parts.push(`${result.summary.fail} failed`);
  lines.push(`  ${parts.join(', ')}`);

  return lines.join('\n');
}

/**
 * Format the doctor result for output.
 */
export function formatDoctor(
  result: DoctorResult,
  format: DoctorFormat,
  showFix: boolean,
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);
    default:
      return formatDoctorText(result, showFix);
  }
}

export type { DoctorResult, DoctorFormat };
