/**
 * Shared governance pipeline: scan → report orchestration (ADR 031).
 *
 * Composition source — orchestrates scan() + report() for CLI commands
 * that need the full governance pipeline (pitch-cli, health-cli, onboard-cli).
 *
 * Moved from core/ to commands/ because it depends on command modules
 * (scan, report) and therefore belongs in the commands layer.
 */

import { scan } from './scan.ts';
import { report } from './report.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
  type RegistryContext,
} from '../core/cli-context.ts';
import type {
  ScanResult,
  ReportResult,
  Registry,
  VerifyIssueType,
} from '../core/types.ts';

// ── Types ────────────────────────────────────────────────────

export interface GovernancePipelineOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Config directory override */
  configDir?: string;
  /** Registry path override */
  registryPath?: string;
  /** Glob patterns (comma-separated) */
  patterns?: string;
  /** Ignore patterns (comma-separated) */
  ignore?: string;
  /** Expiring threshold override */
  expiringThreshold?: string;
  /** Issue types to treat as fail (for report) */
  failOn?: VerifyIssueType[];
  /** Issue types to treat as warn (for report) */
  warnOn?: VerifyIssueType[];
  /** Progress callback for scan summary (defaults to stderr) */
  onScanProgress?: (message: string) => void;
}

export interface GovernancePipelineResult {
  scanResult: ScanResult;
  reportResult: ReportResult;
  registry: Registry;
  registryPath: string;
  registryContext: RegistryContext;
  /** Resolved expiring threshold in days (used by downstream triage, pitch) */
  expiringThresholdDays: number;
}

// ── Pipeline ─────────────────────────────────────────────────

/**
 * Run the shared governance pipeline: scan → report.
 *
 * Encapsulates the createBaseContext → withRegistry → resolveScanPatterns →
 * scan → report sequence common to pitch-cli, health-cli, and onboard-cli.
 */
export async function runGovernancePipeline(
  options: GovernancePipelineOptions = {},
): Promise<GovernancePipelineResult> {
  const base = createBaseContext(options.cwd);
  const regCtx = await withRegistry(base, {
    configDir: options.configDir,
    registryPath: options.registryPath,
  });

  const { patterns, ignore } = resolveScanPatterns(
    options.patterns,
    options.ignore,
    regCtx.config,
  );

  // Scan
  const provider = new CommentProvider();
  const scanResult = await scan({
    patterns,
    ignore,
    provider,
    cwd: base.cwd,
    providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
  });

  const onProgress =
    options.onScanProgress ?? ((msg: string) => console.error(msg));
  onProgress(
    `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
  );

  // Report
  const expiringThresholdDays = resolveExpiringThreshold(
    options.expiringThreshold,
    regCtx.config,
  );

  const reportResult = report({
    scanResult,
    registry: regCtx.registry,
    failOn: options.failOn ?? [],
    warnOn: options.warnOn ?? [],
    duplicates: regCtx.duplicates,
    refPatterns: regCtx.config.refPatterns,
    refOrigins: regCtx.refOrigins,
    expiringThresholdDays,
  });

  return {
    scanResult,
    reportResult,
    registry: regCtx.registry,
    registryPath: regCtx.registryPath,
    registryContext: regCtx,
    expiringThresholdDays,
  };
}
