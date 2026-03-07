import type { ScanResult, Registry, ReportResult } from '../core/types.ts';
import type { RefPatternConfig } from '../core/ref-pattern.ts';
import type { RegistryDuplicateWarning } from '../core/registry.ts';
import { report, type ReportOptions } from './report.ts';

/**
 * Options for generating a dashboard report from a scan result.
 * Pure function — no I/O.
 */
export interface WatchDashboardOptions {
  /** Scan result from the latest refresh */
  scanResult: ScanResult;
  /** Loaded registry */
  registry: Registry;
  /** Issue types that cause failure */
  failOn: string[];
  /** Issue types reported as warnings */
  warnOn: string[];
  /** Pattern-based ref routing configuration (ADR 012) */
  refPatterns?: RefPatternConfig[];
  /** Registry duplicate warnings */
  duplicates?: RegistryDuplicateWarning[];
  /** Maps each ref to its origin registry file */
  refOrigins?: Map<string, string | null>;
  /** Days before expiration to trigger expiring-soon */
  expiringThresholdDays?: number;
}

/**
 * Generate a ReportResult from a scan result.
 * Pure function — delegates to report() for verify + insights.
 *
 * This is the core composition point for watch --dashboard:
 *   scan() → watchReport() → formatReportAsHtml()
 */
export function watchReport(options: WatchDashboardOptions): ReportResult {
  const reportOptions: ReportOptions = {
    scanResult: options.scanResult,
    registry: options.registry,
    failOn: options.failOn as ReportOptions['failOn'],
    warnOn: options.warnOn as ReportOptions['warnOn'],
    refPatterns: options.refPatterns,
    duplicates: options.duplicates,
    refOrigins: options.refOrigins,
    expiringThresholdDays: options.expiringThresholdDays,
  };
  return report(reportOptions);
}
