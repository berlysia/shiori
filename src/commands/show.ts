import type {
  ShioriAnnotation,
  Registry,
  RegistryEntry,
} from '../core/types.ts';
import type { NamespaceConfig } from '../core/namespace.ts';
import { resolveRefUrl } from '../core/namespace.ts';

export interface ShowInput {
  ref: string;
  registry: Registry;
  annotations: ShioriAnnotation[];
  namespaces: Record<string, NamespaceConfig> | undefined;
}

export interface ShowResult {
  ref: string;
  registryEntry: RegistryEntry | undefined;
  sourceLocations: Array<{ file: string; line: number }>;
  url: string | undefined;
}

/**
 * Look up information about a specific ref.
 * Pure function — no IO.
 */
export function show(input: ShowInput): ShowResult {
  const { ref, registry, annotations, namespaces } = input;

  const registryEntry = registry[ref];

  const sourceLocations = annotations
    .filter((a) => a.ref === ref)
    .map((a) => ({ file: a.location.file, line: a.location.line }));

  const url = resolveRefUrl(ref, namespaces);

  return {
    ref,
    registryEntry: registryEntry ?? undefined,
    sourceLocations,
    url,
  };
}

/** Whether the show result found any information */
export function isFound(result: ShowResult): boolean {
  return result.registryEntry !== undefined || result.sourceLocations.length > 0;
}
