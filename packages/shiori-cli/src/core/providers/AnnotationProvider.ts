import type { ShioriAnnotation, ShioriCandidate } from '../types.ts';

/** Provider input: a single file to scan */
export interface FileInput {
  /** File path (relative) */
  path: string;
  /** File content (text) */
  content: string;
}

// === Matcher definition (YAML/JSON serializable) ===

/** Declarative matcher config for a single pattern variant */
export interface MatcherConfig {
  /** Regex pattern string. Capture group 1 = rest after keyword */
  pattern: string;
  /** Rule extraction mode. Omit = no rule extraction */
  rules?: 'csv' | 'single';
  /** Separator between rules part and meta part. Omit = null (entire rest is meta) */
  separator?: string;
  /** Store capture group 1 in ShioriCandidate.text. Omit = false */
  text?: boolean;
}

// === User-facing config types ===

/** Per-tool config: _matchers for custom definitions, boolean flags for matcher enable/disable */
export interface CandidateToolConfig {
  _matchers?: Record<string, MatcherConfig>;
  [matcher: string]: boolean | Record<string, MatcherConfig> | undefined;
}

/** User-facing candidate pattern config */
export interface CandidatePatternConfig {
  [entry: string]: boolean | CandidateToolConfig | undefined;
}

// === Resolved internal types ===

/** Resolved matcher ready for use in scan loop */
export interface ResolvedMatcher {
  name: string;
  enabled: boolean;
  pattern: RegExp;
  rules: 'csv' | 'single' | null;
  separator: string | null;
  captureText: boolean;
}

/** Resolved candidate patterns (internal) */
export interface ResolvedCandidatePatterns {
  /** Entries keyed by tool/keyword name, each with resolved matchers */
  entries: Record<string, ResolvedMatcher[]>;
}

// === Built-in matchers ===

export const BUILTIN_MATCHERS: Record<string, Record<string, MatcherConfig>> = {
  eslint: {
    'disable-next-line': {
      pattern: '\\beslint-disable-next-line\\s+(.*)',
      rules: 'csv',
      separator: '--',
    },
    'disable-line': {
      pattern: '\\beslint-disable-line\\s+(.*)',
      rules: 'csv',
      separator: '--',
    },
  },
  stylelint: {
    'disable-next-line': {
      pattern: '\\bstylelint-disable-next-line\\s+([\\s\\S]+)',
      rules: 'csv',
      separator: '--',
    },
    'disable-line': {
      pattern: '\\bstylelint-disable-line\\s+([\\s\\S]+)',
      rules: 'csv',
      separator: '--',
    },
  },
  typescript: {
    'ts-ignore': {
      pattern: '@ts-ignore\\b(.*)',
    },
    'ts-expect-error': {
      pattern: '@ts-expect-error\\b(.*)',
    },
  },
  keywords: {
    todo: { pattern: '^TODO\\b:?\\s*(.*)', text: true },
    fixme: { pattern: '^FIXME\\b:?\\s*(.*)', text: true },
    hack: { pattern: '^HACK\\b:?\\s*(.*)', text: true },
    xxx: { pattern: '^XXX\\b:?\\s*(.*)', text: true },
  },
};

/** Default candidate pattern config: eslint and stylelint enabled, keywords disabled */
export const DEFAULT_CANDIDATE_PATTERNS: CandidatePatternConfig = {
  eslint: true,
  stylelint: true,
  keywords: false,
};

/**
 * Resolve user-facing config into internal resolved form.
 *
 * Resolution rules:
 * 1. Per entry, merge _matchers with builtins (user-defined takes precedence for same name)
 * 2. Boolean shorthand → all matchers set to same value
 * 3. Per-matcher → individual enabled control
 *    - Builtin matchers (not specified) → default enabled
 *    - _matchers-added new matchers (not specified) → default disabled
 * 4. Unknown matcher name → warning (future: CI fail)
 */
export function resolveCandidatePatterns(
  config: CandidatePatternConfig,
): ResolvedCandidatePatterns {
  const entries: Record<string, ResolvedMatcher[]> = {};

  for (const [entryName, entryValue] of Object.entries(config)) {
    if (entryValue === undefined) continue;

    const builtinMatchers = BUILTIN_MATCHERS[entryName] ?? {};

    if (typeof entryValue === 'boolean') {
      // Boolean shorthand: all matchers enabled/disabled with same value
      const allMatchers = { ...builtinMatchers };
      entries[entryName] = Object.entries(allMatchers).map(([name, mc]) =>
        resolveOneMatcher(name, mc, entryValue),
      );
    } else {
      // CandidateToolConfig: per-matcher control with optional _matchers
      const userMatchers = entryValue._matchers ?? {};
      // Merge: user-defined matchers override builtins of same name
      const mergedMatcherConfigs: Record<string, MatcherConfig> = {
        ...builtinMatchers,
        ...userMatchers,
      };

      const matchers: ResolvedMatcher[] = [];
      for (const [matcherName, matcherConfig] of Object.entries(
        mergedMatcherConfigs,
      )) {
        if (matcherName === '_matchers') continue;
        const explicitValue = entryValue[matcherName];
        let enabled: boolean;
        if (typeof explicitValue === 'boolean') {
          enabled = explicitValue;
        } else if (matcherName in builtinMatchers) {
          // Builtin matcher not explicitly set → default enabled
          enabled = true;
        } else {
          // User-added matcher not explicitly set → default disabled
          enabled = false;
        }
        matchers.push(resolveOneMatcher(matcherName, matcherConfig, enabled));
      }
      entries[entryName] = matchers;
    }
  }

  return { entries };
}

function resolveOneMatcher(
  name: string,
  config: MatcherConfig,
  enabled: boolean,
): ResolvedMatcher {
  return {
    name,
    enabled,
    pattern: new RegExp(config.pattern),
    rules: config.rules ?? null,
    separator: config.separator ?? null,
    captureText: config.text ?? false,
  };
}

/** Options for provider scan */
export interface ProviderScanOptions {
  /** Enabled candidate detection patterns (resolved form) */
  candidatePatterns?: ResolvedCandidatePatterns;
}

/** Result from a provider scan */
export interface ProviderResult {
  annotations: ShioriAnnotation[];
  candidates: ShioriCandidate[];
}

/** Pluggable interface for extracting shiori annotations */
export interface AnnotationProvider {
  /** Provider name */
  readonly name: string;
  /** Extract annotations and candidates from a single file */
  scan(file: FileInput, options?: ProviderScanOptions): ProviderResult;
}
