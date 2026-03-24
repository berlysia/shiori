/**
 * Ref suggestion engine for adopt/onboard workflows.
 *
 * Suggests appropriate ref prefixes and generates ref candidates
 * based on existing registry patterns, configured refPatterns,
 * and ADR naming conventions. Pure functions — no I/O.
 */

import type { Registry } from './types.ts';
import type { RefPatternConfig } from './ref-pattern.ts';
import { escapeRegex } from './regex-utils.ts';

// ── Types ────────────────────────────────────────────────────

/** Source of a prefix suggestion */
export type PrefixSource = 'registry' | 'refPattern' | 'default';

/** A single prefix suggestion with metadata */
export interface PrefixSuggestion {
  /** Suggested prefix (e.g. "ADOPT", "DEBT", "SUP") */
  prefix: string;
  /** Where this suggestion came from */
  source: PrefixSource;
  /** How many existing refs use this prefix */
  usageCount: number;
  /** Human-readable explanation of the suggestion */
  reason: string;
}

/** Options for generating prefix suggestions */
export interface SuggestPrefixesOptions {
  /** Existing registry to extract prefix patterns from */
  registry: Registry;
  /** Configured ref patterns (from shiori config) */
  refPatterns?: RefPatternConfig[];
}

/** Result of prefix suggestion */
export interface SuggestPrefixesResult {
  /** Ordered suggestions (most relevant first) */
  suggestions: PrefixSuggestion[];
}

/** Next available ref for a given prefix */
export interface NextRefSuggestion {
  /** The prefix used */
  prefix: string;
  /** Next available number */
  nextNumber: number;
  /** Formatted ref string (e.g. "ADOPT-004") */
  ref: string;
}

// ── Default prefixes ─────────────────────────────────────────

/** Built-in default prefixes when no other signals are available */
const DEFAULT_PREFIXES: ReadonlyArray<{
  prefix: string;
  reason: string;
}> = [
  { prefix: 'ADOPT', reason: 'standard prefix for adopted lint suppressions' },
  { prefix: 'DEBT', reason: 'common prefix for technical debt tracking' },
];

// ── Core functions ───────────────────────────────────────────

/**
 * Extract unique prefixes from registry keys.
 *
 * Recognizes patterns like `PREFIX-NNN` (e.g. "ADOPT-001", "SUP-1234").
 * Returns a Map of prefix → usage count.
 *
 * O(n) where n = number of registry keys.
 */
export function extractPrefixesFromRegistry(
  registry: Registry,
): Map<string, number> {
  const prefixCounts = new Map<string, number>();
  const refPattern = /^([A-Z][A-Z0-9]*(?:[-:][A-Z][A-Z0-9]*)*)-\d+$/;

  for (const key of Object.keys(registry)) {
    const m = key.match(refPattern);
    if (m) {
      const prefix = m[1]!;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }

  return prefixCounts;
}

/**
 * Extract prefixes from refPattern configurations.
 *
 * Derives prefix from `match` field patterns like "JIRA-{id}" → "JIRA",
 * "ADR:{id}" → "ADR". Only extracts when the pattern has a clear
 * uppercase prefix before a separator.
 */
export function extractPrefixesFromPatterns(
  refPatterns: RefPatternConfig[] | undefined,
): string[] {
  if (!refPatterns || refPatterns.length === 0) return [];

  const prefixes: string[] = [];
  const prefixPattern = /^([A-Z][A-Z0-9]*)[-:{]/;

  for (const config of refPatterns) {
    // Only extract from patterns that contain {id} placeholder
    if (!config.match.includes('{id}')) continue;

    const m = config.match.match(prefixPattern);
    if (m) {
      const prefix = m[1]!;
      if (!prefixes.includes(prefix)) {
        prefixes.push(prefix);
      }
    }
  }

  return prefixes;
}

/**
 * Suggest ref prefixes based on existing registry and configuration.
 *
 * Priority order:
 * 1. Prefixes actively used in the registry (most popular first)
 * 2. Prefixes derived from refPattern config
 * 3. Default prefixes (ADOPT, DEBT)
 *
 * Deduplicates across sources: registry > refPattern > default.
 */
export function suggestPrefixes(
  options: SuggestPrefixesOptions,
): SuggestPrefixesResult {
  const { registry, refPatterns } = options;
  const seen = new Set<string>();
  const suggestions: PrefixSuggestion[] = [];

  // 1. Registry-derived prefixes (sorted by count descending)
  const registryCounts = extractPrefixesFromRegistry(registry);
  const sortedEntries = [...registryCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  );

  for (const [prefix, count] of sortedEntries) {
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    suggestions.push({
      prefix,
      source: 'registry',
      usageCount: count,
      reason: `${count} existing ref(s) in registry`,
    });
  }

  // 2. refPattern-derived prefixes
  const patternPrefixes = extractPrefixesFromPatterns(refPatterns);
  for (const prefix of patternPrefixes) {
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    suggestions.push({
      prefix,
      source: 'refPattern',
      usageCount: 0,
      reason: 'configured in refPatterns',
    });
  }

  // 3. Default prefixes
  for (const { prefix, reason } of DEFAULT_PREFIXES) {
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    suggestions.push({
      prefix,
      source: 'default',
      usageCount: 0,
      reason,
    });
  }

  return { suggestions };
}

/**
 * Find the next available ref number for a given prefix in the registry.
 *
 * Scans existing keys matching `PREFIX-NNN` and returns max+1.
 * Returns 1 if no existing refs match.
 *
 * Note: This mirrors migrate.ts findNextNumber() but is public API
 * for use in wizard and suggestion contexts.
 */
export function findNextAvailableNumber(
  prefix: string,
  registry: Registry,
): number {
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  let max = 0;
  for (const key of Object.keys(registry)) {
    const m = key.match(pattern);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Format a ref number with zero-padding.
 *
 * Uses 3-digit padding by default (e.g. "001"),
 * switches to 4-digit when totalCount >= 1000.
 */
function formatRefNumber(num: number, totalCount: number): string {
  const width = totalCount >= 1000 ? 4 : 3;
  return String(num).padStart(width, '0');
}

/**
 * Suggest the next available ref for a given prefix.
 *
 * Combines findNextAvailableNumber with formatting to produce
 * a complete ref suggestion like "ADOPT-004".
 */
export function suggestNextRef(
  prefix: string,
  registry: Registry,
  estimatedTotal?: number,
): NextRefSuggestion {
  const nextNumber = findNextAvailableNumber(prefix, registry);
  const total = estimatedTotal ?? Object.keys(registry).length;
  const ref = `${prefix}-${formatRefNumber(nextNumber, total)}`;

  return { prefix, nextNumber, ref };
}
