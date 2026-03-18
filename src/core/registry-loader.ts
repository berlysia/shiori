import { loadConfig, resolveRegistryPath } from './config.ts';
import type { ResolvedConfig } from './config.ts';
import { loadMultiRegistry } from './registry.ts';
import type {
  MultiRegistryLoadResult,
  RegistryValidationError,
  RegistryDuplicateWarning,
} from './registry.ts';
import type { Registry } from './types.ts';

/** Options for loading config and registry together */
export interface LoadConfigAndRegistryOptions {
  /** Working directory */
  cwd: string;
  /** Explicit config directory (from --config flag) */
  configDir?: string;
  /** Explicit registry path (from --registry flag) */
  registryPath?: string;
}

/** Result of loading config and registry */
export interface ConfigAndRegistryResult {
  config: ResolvedConfig;
  registry: Registry;
  registryPath: string;
  errors: RegistryValidationError[];
  duplicates: RegistryDuplicateWarning[];
  /** Maps each ref to its origin registryFile (ADR 012 phase 2) */
  refOrigins: Map<string, string | null>;
}

/**
 * Load config and multi-registry in a single call.
 *
 * This encapsulates the common CLI pattern:
 *   1. loadConfig(cwd, configDir)
 *   2. resolveRegistryPath(explicit, config, cwd)
 *   3. loadMultiRegistry(registryPath, config.refPatterns)
 *
 * @see ADR 010 for multi-registry design
 */
export async function loadConfigAndRegistry(
  options: LoadConfigAndRegistryOptions,
): Promise<ConfigAndRegistryResult> {
  const config = await loadConfig(options.cwd, options.configDir);

  const registryPath = await resolveRegistryPath(
    options.registryPath,
    config,
    options.cwd,
  );

  const { registry, errors, duplicates, refOrigins } = await loadMultiRegistry(
    registryPath,
    config.refPatterns,
    undefined, // basePath: use default (dirname of registryPath)
    options.cwd, // path boundary validation
  );

  return { config, registry, registryPath, errors, duplicates, refOrigins };
}

/**
 * Report registry load issues (validation errors and duplicate warnings) to stderr.
 *
 * This is the standard error reporting pattern used by read-only commands
 * (verify, check, show). Commands that silently ignore errors (update, watch,
 * migrate) should skip this call.
 */
export function reportRegistryIssues(
  result: Pick<MultiRegistryLoadResult, 'errors' | 'duplicates'>,
): void {
  if (result.errors.length > 0) {
    console.error('Registry validation errors:');
    for (const err of result.errors) {
      console.error(`  ${err.id}: ${err.message}`);
    }
  }
  if (result.duplicates.length > 0) {
    console.error('Registry duplicate warnings:');
    for (const dup of result.duplicates) {
      console.error(
        `  ${dup.ref}: found in both ${dup.defaultFile} and ${dup.patternFile}`,
      );
    }
  }
}
