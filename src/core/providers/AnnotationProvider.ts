import type { ShioriAnnotation, ShioriCandidate } from '../types.ts';

/** Provider input: a single file to scan */
export interface FileInput {
  /** File path (relative) */
  path: string;
  /** File content (text) */
  content: string;
}

/** Configuration for which candidate patterns to detect */
export interface CandidatePatternConfig {
  'lint-disable': boolean;
  todo: boolean;
  fixme: boolean;
  hack: boolean;
  xxx: boolean;
}

/** Default candidate pattern config: only lint-disable enabled */
export const DEFAULT_CANDIDATE_PATTERNS: CandidatePatternConfig = {
  'lint-disable': true,
  todo: false,
  fixme: false,
  hack: false,
  xxx: false,
};

/** Options for provider scan */
export interface ProviderScanOptions {
  /** Enabled candidate detection patterns */
  candidatePatterns?: CandidatePatternConfig;
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
