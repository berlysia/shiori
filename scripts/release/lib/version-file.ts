// Rewrites the VERSION constant in packages/shiori-cli/src/core/version.ts.
// The constant is synced rather than derived at build time; version.ts says why.
import type { ValidVersion } from './semver.ts';

export type SyncResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly reason: string };

const CONSTANT_LINE = /^export const VERSION = '[^']+';$/gm;

export function syncVersionConstant(
  source: string,
  version: ValidVersion,
): SyncResult {
  const count = source.match(CONSTANT_LINE)?.length ?? 0;
  if (count !== 1) {
    return {
      ok: false,
      reason: `expected exactly one "export const VERSION = '...';" line, found ${count}`,
    };
  }
  // A replacer function: a string replacement would give `$` sequences in the
  // value a meaning. The value is validated, but the cost of being safe is nil.
  return {
    ok: true,
    source: source.replace(
      CONSTANT_LINE,
      () => `export const VERSION = '${version}';`,
    ),
  };
}
