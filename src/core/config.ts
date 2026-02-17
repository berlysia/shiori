import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RefPatternConfig } from './ref-pattern.ts';
import type {
  CandidatePatternConfig,
  ResolvedCandidatePatterns,
} from './providers/AnnotationProvider.ts';
import {
  DEFAULT_CANDIDATE_PATTERNS,
  resolveCandidatePatterns,
} from './providers/AnnotationProvider.ts';

/** Default path for scan result (relative to cwd) */
export const DEFAULT_SCAN_RESULT_PATH = '.config/shiori/scan-result.json';

/** Default registry path (relative to cwd) */
export const DEFAULT_REGISTRY_PATH = '.config/shiori/registry.json';

/** Shape of .config/shiori/config.{yaml,yml,json} (ADR 013) */
export interface ShioriConfig {
  /** Candidate detection pattern overrides */
  candidates?: Partial<CandidatePatternConfig>;
  /** Pattern-based ref resolution (ADR 012) */
  refPatterns?: RefPatternConfig[];
  /** Default scan options */
  scan?: {
    /** Default glob patterns for scanning */
    patterns?: string[];
    /** Default ignore patterns for scanning */
    ignore?: string[];
  };
  /** Default file paths */
  paths?: {
    /** Path to scan result file (relative to cwd) */
    scanResult?: string;
    /** Path to registry file (relative to cwd) */
    registry?: string;
  };
}

/** Resolved configuration with all defaults applied */
export interface ResolvedConfig {
  candidatePatterns: ResolvedCandidatePatterns;
  /** Pattern-based ref resolution (passed through as-is) */
  refPatterns: RefPatternConfig[] | undefined;
  /** Resolved scan patterns (undefined = use command defaults) */
  scanPatterns: string[] | undefined;
  /** Resolved scan ignore patterns (undefined = use command defaults) */
  scanIgnore: string[] | undefined;
  /** Resolved file paths */
  paths: {
    scanResult: string;
    registry: string | undefined;
  };
}

const CONFIG_DIR = '.config/shiori';
/** Config file candidates in priority order: yaml (canonical) → yml (common abbreviation) → json (backward compat) */
export const CONFIG_FILENAMES = [
  'config.yaml',
  'config.yml',
  'config.json',
] as const;

/**
 * Load config from the given directory, merging with defaults.
 * Searches for config.yaml → config.yml → config.json and loads the first one found.
 * Returns default config if no file exists.
 *
 * @param cwd - working directory
 * @param configDir - explicit config directory (from --config flag). If provided, looks for config files inside it.
 */
export async function loadConfig(
  cwd: string,
  configDir?: string,
): Promise<ResolvedConfig> {
  const dir = configDir ?? join(cwd, CONFIG_DIR);

  for (const filename of CONFIG_FILENAMES) {
    const configPath = join(dir, filename);
    let content: string;
    try {
      content = await readFile(configPath, 'utf-8');
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'ENOENT') continue;
      throw err;
    }

    const raw: ShioriConfig = filename.endsWith('.json')
      ? (JSON.parse(content) as ShioriConfig)
      : ((parseYaml(content) as ShioriConfig) ?? {});

    return resolveConfig(raw);
  }

  return resolveConfig({});
}

/**
 * Merge user config with defaults to produce a fully resolved configuration.
 *
 * Candidate patterns are merged with built-in defaults (user overrides win).
 * Other fields fall through as-is, with path defaults applied when absent.
 *
 * @param raw - User-provided partial config (from config file or empty object)
 * @returns Fully resolved config with all defaults applied
 */
export function resolveConfig(raw: ShioriConfig): ResolvedConfig {
  return {
    candidatePatterns: resolveCandidatePatterns({
      ...DEFAULT_CANDIDATE_PATTERNS,
      ...raw.candidates,
    }),
    refPatterns: raw.refPatterns,
    scanPatterns: raw.scan?.patterns,
    scanIgnore: raw.scan?.ignore,
    paths: {
      scanResult: raw.paths?.scanResult ?? DEFAULT_SCAN_RESULT_PATH,
      registry: raw.paths?.registry,
    },
  };
}

/**
 * Resolve registry file path by checking candidates in order:
 * 1. Explicit --registry argument
 * 2. config.paths.registry
 * 3. .config/shiori/registry.json (cwd)
 *
 * Returns the first path that exists on disk.
 * Throws if none found.
 */
export async function resolveRegistryPath(
  explicitPath: string | undefined,
  config: ResolvedConfig,
  cwd: string,
): Promise<string> {
  const candidates: { label: string; path: string }[] = [];

  if (explicitPath) {
    return explicitPath;
  }

  if (config.paths.registry) {
    candidates.push({
      label: `config: ${config.paths.registry}`,
      path: join(cwd, config.paths.registry),
    });
  }

  candidates.push({
    label: DEFAULT_REGISTRY_PATH,
    path: join(cwd, DEFAULT_REGISTRY_PATH),
  });

  for (const candidate of candidates) {
    try {
      await access(candidate.path);
      return candidate.path;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') continue;
      throw err;
    }
  }

  const tried = candidates.map((c) => `  ${c.label} (not found)`).join('\n');
  throw new Error(`No registry file found. Tried:\n${tried}`);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
