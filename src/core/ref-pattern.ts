import { escapeRegex } from './regex-utils.ts';

/** Configuration for a single ref pattern */
export interface RefPatternConfig {
  /** Pattern to match, e.g. "JIRA-{id}", "ADR-{id}", "LEGACY-WORKAROUND" */
  match: string;
  /** URL template with {id} placeholder, e.g. "https://jira.example.com/browse/{id}" */
  urlTemplate?: string;
  /** Per-pattern registry file path (JSON/YAML, auto-detected by extension) */
  registryFile?: string;
  /** Reserved for ADR 011 (JSON Schema validation) */
  entrySchema?: string;
}

/** Result of matching a ref against a pattern */
export interface RefPatternMatch {
  config: RefPatternConfig;
  captures: { id: string };
}

/** Convert a match pattern to a RegExp. {id} becomes (.+) */
function patternToRegExp(pattern: string): RegExp {
  const idPlaceholder = '{id}';
  const idx = pattern.indexOf(idPlaceholder);

  if (idx === -1) {
    // Literal pattern — exact match
    return new RegExp(`^${escapeRegex(pattern)}$`);
  }

  const before = pattern.slice(0, idx);
  const after = pattern.slice(idx + idPlaceholder.length);
  return new RegExp(`^${escapeRegex(before)}(.+)${escapeRegex(after)}$`);
}

/**
 * Match a ref string against an array of patterns.
 * Returns the first match with captured id, or undefined.
 */
export function matchRefPattern(
  ref: string,
  patterns: RefPatternConfig[] | undefined,
): RefPatternMatch | undefined {
  if (!patterns || patterns.length === 0 || ref === '') return undefined;

  for (const config of patterns) {
    const re = patternToRegExp(config.match);
    const m = re.exec(ref);
    if (m) {
      // If pattern had {id}, captured group is m[1]; otherwise use full ref
      const id = m[1] ?? ref;
      return { config, captures: { id } };
    }
  }

  return undefined;
}

/**
 * Resolve a ref to a URL using pattern configuration.
 * Returns undefined if no match or no urlTemplate.
 */
export function resolveRefUrl(
  ref: string,
  patterns: RefPatternConfig[] | undefined,
): string | undefined {
  const match = matchRefPattern(ref, patterns);
  if (!match) return undefined;
  if (!match.config.urlTemplate) return undefined;

  return match.config.urlTemplate.replace('{id}', match.captures.id);
}
