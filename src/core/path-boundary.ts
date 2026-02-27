import { resolve, dirname, basename } from 'node:path';
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

  // Resolve symlinks for target; if target doesn't exist yet, resolve its parent
  let realTarget: string;
  try {
    realTarget = await realpath(absoluteTarget);
  } catch {
    // Target file doesn't exist yet — resolve parent directory + basename
    const parentDir = dirname(absoluteTarget);
    const fileName = basename(absoluteTarget);
    try {
      const realParent = await realpath(parentDir);
      realTarget = resolve(realParent, fileName);
    } catch {
      // Parent doesn't exist either — use the absolute path as-is
      realTarget = absoluteTarget;
    }
  }

  // Normalize: ensure cwd boundary ends with separator for prefix check
  const boundaryPrefix = realCwd.endsWith('/') ? realCwd : realCwd + '/';

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
