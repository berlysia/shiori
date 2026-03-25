/**
 * Auto-initialization for projects without shiori setup.
 *
 * When a command detects that the registry (and config) don't exist,
 * it can call autoInitProject() to create the minimal config + empty
 * registry so the command can proceed without requiring `shiori init`.
 *
 * This follows the EP-0141 graceful degradation pattern established
 * in scan-cli.ts, extended per EP-0152 to the adopt command.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileExists, findExistingConfig } from './fs-utils.ts';
import { DEFAULT_REGISTRY_PATH } from './config.ts';
import { saveRegistry } from './registry.ts';
import { CONFIG_YAML_TEMPLATE } from './config-template.ts';

export interface AutoInitOptions {
  /** Project working directory */
  cwd: string;
  /** Explicit config directory (from --config flag), or undefined for default */
  configDir?: string;
  /** Explicit registry path (from --registry flag), or undefined for default */
  registryPath?: string;
}

export interface AutoInitResult {
  /** Whether config was created (false if already existed) */
  configCreated: boolean;
  /** Whether registry was created (false if already existed) */
  registryCreated: boolean;
  /** Path to the registry file */
  registryPath: string;
}

/**
 * Create minimal shiori config and empty registry if they don't exist.
 *
 * This is intentionally minimal — it creates only what's needed for
 * commands that require a registry. Full initialization (scan patterns,
 * CI templates, etc.) still requires `shiori init`.
 */
export async function autoInitProject(
  options: AutoInitOptions,
): Promise<AutoInitResult> {
  const {
    cwd,
    configDir: configDirFlag,
    registryPath: registryPathFlag,
  } = options;

  // Use resolve() for explicit flags (handles both relative and absolute paths),
  // join() for defaults (always relative to cwd). Consistent with config.ts strategy.
  const configDir = configDirFlag
    ? resolve(cwd, configDirFlag)
    : join(cwd, '.config', 'shiori');

  // Create config directory and config.yaml if needed
  let configCreated = false;
  const existingConfig = await findExistingConfig(configDir);
  if (!existingConfig) {
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'config.yaml'),
      CONFIG_YAML_TEMPLATE,
      'utf-8',
    );
    configCreated = true;
  }

  // Create empty registry if needed.
  // Explicit --registry flag is resolved via resolve() (same as resolveRegistryPath in config.ts).
  const registryPath = registryPathFlag
    ? resolve(cwd, registryPathFlag)
    : join(cwd, DEFAULT_REGISTRY_PATH);
  let registryCreated = false;
  if (!(await fileExists(registryPath))) {
    await mkdir(dirname(registryPath), { recursive: true });
    await saveRegistry(registryPath, {});
    registryCreated = true;
  }

  return { configCreated, registryCreated, registryPath };
}
