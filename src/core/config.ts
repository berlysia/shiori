import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RefPatternConfig } from './ref-pattern.ts';
import type { CandidatePatternConfig } from './providers/AnnotationProvider.ts';
import { DEFAULT_CANDIDATE_PATTERNS } from './providers/AnnotationProvider.ts';

/** Shape of .shiorirc.json */
export interface ShioriConfig {
  /** Candidate detection pattern overrides */
  candidates?: Partial<CandidatePatternConfig>;
  /** Pattern-based ref resolution (ADR 012) */
  refPatterns?: RefPatternConfig[];
}

/** Resolved configuration with all defaults applied */
export interface ResolvedConfig {
  candidatePatterns: CandidatePatternConfig;
  /** Pattern-based ref resolution (passed through as-is) */
  refPatterns: RefPatternConfig[] | undefined;
}

const CONFIG_FILENAME = '.shiorirc.json';

/**
 * Load .shiorirc.json from the given directory, merging with defaults.
 * Returns default config if the file does not exist.
 */
export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: ShioriConfig = {};

  try {
    const content = await readFile(configPath, 'utf-8');
    raw = JSON.parse(content) as ShioriConfig;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'ENOENT') {
      // No config file — use defaults
      return {
        candidatePatterns: { ...DEFAULT_CANDIDATE_PATTERNS },
        refPatterns: undefined,
      };
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
  };
}
