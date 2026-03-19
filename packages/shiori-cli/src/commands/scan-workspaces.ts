/**
 * Workspace-level scanning orchestration.
 *
 * Composes core workspace detection + merge with commands/scan logic.
 * Lives in commands layer because it depends on scan() (a command).
 * See ADR 022.
 */
import { join } from 'node:path';
import type { ScanOptions } from './scan.ts';
import { scan } from './scan.ts';
import type {
  WorkspacePackage,
  PackageScanResult,
  WorkspaceScanResult,
} from '../core/workspace.ts';
import { mergePackageResults } from '../core/workspace.ts';

export type {
  WorkspaceScanResult,
  PackageScanResult,
} from '../core/workspace.ts';

/**
 * Scan all workspace packages and merge results.
 *
 * Each package is scanned independently with its own cwd.
 * Annotation/candidate location.file paths are normalized to
 * `<pkg.dir>/<relative-path>` (root-relative) in the merged result.
 *
 * @param packages - Workspace packages to scan
 * @param rootCwd - Workspace root directory (for registry resolution)
 * @param scanOptions - Scan options (without cwd — each package provides its own)
 */
export async function scanWorkspaces(
  packages: WorkspacePackage[],
  rootCwd: string,
  scanOptions: Omit<ScanOptions, 'cwd'>,
): Promise<WorkspaceScanResult> {
  const packageResults = await Promise.all(
    packages.map(async (pkg): Promise<PackageScanResult> => {
      const pkgCwd = join(rootCwd, pkg.dir);
      const scanResult = await scan({ ...scanOptions, cwd: pkgCwd });
      return {
        package: pkg.name,
        dir: pkg.dir,
        scanResult,
      };
    }),
  );

  const merged = mergePackageResults(packageResults);
  return { packages: packageResults, merged };
}
