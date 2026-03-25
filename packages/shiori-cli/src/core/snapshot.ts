import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { assertWithinCwd, PathBoundaryError } from './path-boundary.ts';
import type { ReportResult } from './types.ts';
import { loadReportFiles, type ReportFilesCallbacks } from './report-files.ts';

/**
 * Default directory for auto-accumulated report snapshots (relative to cwd).
 * Used by weekly-report auto-save (EP-0144) and health --trend (EP-0145).
 */
export const DEFAULT_REPORTS_DIR = '.config/shiori/reports';

/**
 * Result of a snapshot save operation.
 * Pure data — no side effects like process.exitCode.
 */
export type SaveSnapshotResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Generate a snapshot filename from a ReportResult timestamp.
 * Replaces characters that are problematic in filenames (: and .)
 */
export function snapshotFilename(timestamp: string): string {
  return `${timestamp.replace(/[:.]/g, '-')}.json`;
}

/**
 * Save a ReportResult JSON snapshot to a directory.
 *
 * - Validates the output path is within `cwd`
 * - Creates the directory if needed
 * - Writes JSON with 2-space indentation and trailing newline
 *
 * Extracted from health-cli.ts for reuse across commands
 * (health, trend, CI workflows, snapshot chain).
 */
export async function saveSnapshot(
  reportResult: ReportResult,
  snapshotDir: string,
  cwd: string,
): Promise<SaveSnapshotResult> {
  const resolvedDir = resolve(cwd, snapshotDir);
  const filename = snapshotFilename(reportResult.timestamp);
  const snapshotFile = join(resolvedDir, filename);

  try {
    await assertWithinCwd(snapshotFile, cwd);
  } catch (err) {
    if (err instanceof PathBoundaryError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }

  try {
    await mkdir(resolvedDir, { recursive: true });
    await writeFile(
      snapshotFile,
      JSON.stringify(reportResult, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, path: snapshotFile };
}

/**
 * Load snapshot files from a history directory.
 * Thin wrapper over loadReportFiles with consistent naming.
 *
 * @param historyDir - Directory containing ReportResult JSON files
 * @param callbacks - Optional diagnostic callbacks
 */
export async function loadSnapshots(
  historyDir: string,
  cwd: string,
  callbacks?: ReportFilesCallbacks,
): Promise<ReportResult[] | null> {
  const resolvedDir = resolve(cwd, historyDir);
  return loadReportFiles(resolvedDir, callbacks);
}
