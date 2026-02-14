import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RefPatternConfig } from './ref-pattern.ts';
import type { CandidatePatternConfig } from './providers/AnnotationProvider.ts';
import { DEFAULT_CANDIDATE_PATTERNS } from './providers/AnnotationProvider.ts';

/** Default path for scan result (relative to cwd) */
export const DEFAULT_SCAN_RESULT_PATH = '.config/shiori/scan-result.json';

/** Default registry filename (relative to cwd) */
export const DEFAULT_REGISTRY_FILENAME = 'shiori-registry.json';

/** Shape of .config/shiori/config.json (ADR 013) */
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
  candidatePatterns: CandidatePatternConfig;
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
const CONFIG_FILENAME = 'config.json';

/**
 * Load .config/shiori/config.json from the given directory, merging with defaults.
 * Returns default config if the file does not exist.
 *
 * @param cwd - working directory
 * @param configDir - explicit config directory (from --config flag). If provided, looks for config.json inside it.
 */
export async function loadConfig(
  cwd: string,
  configDir?: string,
): Promise<ResolvedConfig> {
  const dir = configDir ?? join(cwd, CONFIG_DIR);
  const configPath = join(dir, CONFIG_FILENAME);
  let raw: ShioriConfig = {};

  try {
    const content = await readFile(configPath, 'utf-8');
    raw = JSON.parse(content) as ShioriConfig;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ENOENT') {
      return resolveConfig({});
    }
    throw err;
  }

  return resolveConfig(raw);
}

/** Merge user config with defaults */
export function resolveConfig(raw: ShioriConfig): ResolvedConfig {
  return {
    candidatePatterns: {
      ...DEFAULT_CANDIDATE_PATTERNS,
      ...raw.candidates,
    },
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
 * 3. shiori-registry.json (cwd)
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
    label: DEFAULT_REGISTRY_FILENAME,
    path: join(cwd, DEFAULT_REGISTRY_FILENAME),
  });

  for (const candidate of candidates) {
    try {
      await access(candidate.path);
      return candidate.path;
    } catch {
      // not found, try next
    }
  }

  const tried = candidates.map((c) => `  ${c.label} (not found)`).join('\n');
  throw new Error(`No registry file found. Tried:\n${tried}`);
}
