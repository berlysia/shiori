import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReportResult } from './types.ts';

const VALID_HEALTH_LEVELS: readonly string[] = [
  'healthy',
  'warning',
  'critical',
];

/**
 * Runtime shape check for ReportResult JSON.
 * Validates the minimum fields required by downstream consumers
 * (computeTrend, buildHealthResult) without importing full schema.
 */
export function isReportShape(value: Record<string, unknown>): boolean {
  if (typeof value.timestamp !== 'string') return false;

  const health = value.health as Record<string, unknown> | undefined;
  if (!health) return false;
  if (typeof health.score !== 'number' || Number.isNaN(health.score))
    return false;
  if (!VALID_HEALTH_LEVELS.includes(health.level as string)) return false;

  // EP-0193: validate coverage/hygiene when present (optional for backward compat)
  if ('coverage' in health && typeof health.coverage !== 'number') return false;
  if ('hygiene' in health && typeof health.hygiene !== 'number') return false;

  const totals = value.totals as Record<string, unknown> | undefined;
  if (!totals) return false;
  if (typeof totals.issues !== 'number') return false;
  if (typeof totals.annotations !== 'number') return false;
  if (typeof totals.candidates !== 'number') return false;
  if (typeof totals.registryEntries !== 'number') return false;
  if (typeof totals.errors !== 'number') return false;
  if (typeof totals.warnings !== 'number') return false;

  return true;
}

/**
 * Callback for loadReportFiles diagnostics.
 * Allows callers (CLI) to control logging behavior.
 */
export interface ReportFilesCallbacks {
  onDirectoryError?: (message: string) => void;
  onNoFiles?: (dir: string) => void;
  onLoaded?: (count: number, dir: string) => void;
  /** Called when a JSON file is skipped due to parse error or invalid shape */
  onSkipped?: (fileName: string, reason: string) => void;
}

/**
 * Load ReportResult JSON files from a directory.
 * Returns null if directory cannot be read or no valid files found.
 *
 * Extracted from health-cli.ts for reuse across commands
 * (health, trend, future snapshot chain).
 */
export async function loadReportFiles(
  dir: string,
  callbacks?: ReportFilesCallbacks,
): Promise<ReportResult[] | null> {
  let files: string[];
  try {
    const entries = await readdir(dir);
    files = entries.filter((f) => f.endsWith('.json'));
  } catch (err) {
    callbacks?.onDirectoryError?.(
      `Cannot read history directory: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (files.length === 0) {
    callbacks?.onNoFiles?.(dir);
    return null;
  }

  const reports: ReportResult[] = [];
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      if (isReportShape(parsed)) {
        // shiori: DEV-018 reason="runtime JSON shape validated by isReportShape but static type requires assertion"
        reports.push(parsed as unknown as ReportResult);
      } else {
        callbacks?.onSkipped?.(
          file,
          'Invalid report shape: missing required fields',
        );
      }
    } catch (err) {
      callbacks?.onSkipped?.(
        file,
        `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (reports.length === 0) {
    return null;
  }

  callbacks?.onLoaded?.(reports.length, dir);
  return reports;
}
