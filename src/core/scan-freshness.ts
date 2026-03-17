import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  resolveScanResultPath,
  type LoadScanResultOptions,
} from './scan-result-loader.ts';
import {
  checkScanFreshness,
  type ScanFreshnessResult,
} from '../commands/resolve.ts';

/**
 * Result of scan-freshness I/O check.
 * Wraps the pure ScanFreshnessResult with an additional `skipped` flag
 * for cases where the check could not be performed (e.g. stdin source).
 */
export interface ScanFreshnessCheckResult {
  /** Whether freshness check was actually performed */
  checked: boolean;
  /** Freshness result (only meaningful when checked === true) */
  freshness: ScanFreshnessResult;
}

/**
 * Perform scan-result freshness check with file I/O.
 *
 * Compares the mtime of the scan-result file against each source file's mtime.
 * Extracted from resolve-cli.ts to enable reuse in both single-ref and --closed modes.
 *
 * Returns `{ checked: false }` when:
 * - Scan result path cannot be resolved (e.g. stdin source)
 * - Scan result file cannot be stat'd
 *
 * @param scanResultOptions - Options to resolve scan result path
 * @param sourceFiles - Relative source file paths to check freshness against
 * @param cwd - Working directory for resolving relative paths
 */
export async function performScanFreshnessCheck(
  scanResultOptions: Pick<
    LoadScanResultOptions,
    'explicitPath' | 'config' | 'cwd'
  >,
  sourceFiles: string[],
  cwd: string,
): Promise<ScanFreshnessCheckResult> {
  const notChecked: ScanFreshnessCheckResult = {
    checked: false,
    freshness: { fresh: true, staleFiles: [] },
  };

  if (sourceFiles.length === 0) {
    return notChecked;
  }

  const scanResultPath = await resolveScanResultPath(scanResultOptions);
  if (!scanResultPath) {
    return notChecked;
  }

  try {
    const scanStat = await stat(scanResultPath);
    const sourceFileMtimes = new Map<string, number>();
    for (const file of sourceFiles) {
      try {
        const fileStat = await stat(resolve(cwd, file));
        sourceFileMtimes.set(file, fileStat.mtimeMs);
      } catch {
        // File stat failed — skip (caller already warned about unreadable files)
      }
    }

    const freshness = checkScanFreshness(scanStat.mtimeMs, sourceFileMtimes);
    return { checked: true, freshness };
  } catch {
    // Could not stat scan result file — proceed without freshness check
    return notChecked;
  }
}
