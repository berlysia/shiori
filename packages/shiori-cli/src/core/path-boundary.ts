import { resolve, dirname, basename, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

/** Error thrown when a path escapes the allowed boundary */
export class PathBoundaryError extends Error {
  readonly path: string;
  readonly boundary: string;

  constructor(path: string, boundary: string) {
    super(
      `Path "${path}" is outside the allowed boundary "${boundary}". Refusing to write.`,
    );
    this.name = 'PathBoundaryError';
    this.path = path;
    this.boundary = boundary;
  }
}

/**
 * Assert that `targetPath` resolves within `cwd` after symlink resolution.
 *
 * 1. Resolve `targetPath` to absolute (against `cwd`)
 * 2. Resolve symlinks via `realpath` (falls back to resolved path if target doesn't exist yet)
 * 3. Verify the resolved path starts with the realpath of `cwd`
 *
 * @throws {PathBoundaryError} if the resolved path escapes `cwd`
 */
export async function assertWithinCwd(
  targetPath: string,
  cwd: string,
): Promise<string> {
  const absoluteTarget = resolve(cwd, targetPath);

  // Resolve symlinks for the boundary (cwd must exist)
  const realCwd = await realpath(cwd);

  // Resolve symlinks for target; if target doesn't exist yet,
  // walk up to the nearest existing ancestor and resolve from there
  let realTarget: string;
  try {
    realTarget = await realpath(absoluteTarget);
  } catch {
    // Target doesn't exist — find nearest existing ancestor
    let current = absoluteTarget;
    const pendingSegments: string[] = [];
    // eslint-disable-next-line no-constant-condition -- shiori: DEV-001 reason="infinite loop pattern requires eslint suppress"
    while (true) {
      const parent = dirname(current);
      pendingSegments.unshift(basename(current));
      try {
        const realAncestor = await realpath(parent);
        realTarget = resolve(realAncestor, ...pendingSegments);
        break;
      } catch {
        if (parent === current) {
          // Reached filesystem root without success — use absolute path as-is
          realTarget = absoluteTarget;
          break;
        }
        current = parent;
      }
    }
  }

  // Normalize: ensure cwd boundary ends with separator for prefix check
  const boundaryPrefix = realCwd.endsWith(sep) ? realCwd : realCwd + sep;

  if (realTarget !== realCwd && !realTarget.startsWith(boundaryPrefix)) {
    throw new PathBoundaryError(targetPath, realCwd);
  }

  return realTarget;
}

/**
 * Validate multiple paths against the cwd boundary (fail-fast).
 * Returns all validated absolute paths on success.
 *
 * @throws {PathBoundaryError} on the first path that escapes `cwd`
 */
export async function assertAllWithinCwd(
  paths: readonly string[],
  cwd: string,
): Promise<string[]> {
  const results: string[] = [];
  for (const p of paths) {
    results.push(await assertWithinCwd(p, cwd));
  }
  return results;
}
