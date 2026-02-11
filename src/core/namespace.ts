/** Parsed ref with optional namespace */
export interface ParsedRef {
  namespace: string | undefined;
  id: string;
  raw: string;
}

/** Namespace configuration */
export interface NamespaceConfig {
  urlTemplate: string;
  /** Per-namespace registry file path (JSON/YAML, auto-detected by extension) */
  registryFile?: string;
}

/**
 * Pattern for namespace: uppercase letter followed by uppercase letters/digits.
 * e.g. "JIRA", "ADR", "A"
 */
const NAMESPACE_PATTERN = /^[A-Z][A-Z0-9]*$/;

/**
 * Parse a ref string into namespace and id components.
 *
 * Rules:
 * 1. Split on first colon
 * 2. If prefix matches [A-Z][A-Z0-9]* → namespace
 * 3. Otherwise → namespace is undefined, entire string is id
 */
export function parseRef(ref: string): ParsedRef {
  const colonIndex = ref.indexOf(':');

  if (colonIndex === -1) {
    return { namespace: undefined, id: ref, raw: ref };
  }

  const prefix = ref.slice(0, colonIndex);

  if (NAMESPACE_PATTERN.test(prefix)) {
    return { namespace: prefix, id: ref.slice(colonIndex + 1), raw: ref };
  }

  return { namespace: undefined, id: ref, raw: ref };
}

/**
 * Resolve a ref to a URL using namespace configuration.
 * Returns undefined if no namespace or no matching config.
 */
export function resolveRefUrl(
  ref: string,
  namespaces: Record<string, NamespaceConfig> | undefined,
): string | undefined {
  if (!namespaces) return undefined;

  const parsed = parseRef(ref);
  if (!parsed.namespace) return undefined;

  const config = namespaces[parsed.namespace];
  if (!config) return undefined;

  return config.urlTemplate.replace('{id}', parsed.id);
}
