import type {
  ScanResult,
  VerifyResult,
  VerifyIssueType,
} from '../core/types.ts';
import { verify, type VerifyOptions, type OutputFormat } from './verify.ts';
import { calculateCoverage, calculateHygiene } from './report.ts';

/**
 * Input options for one-shot check.
 * Derived from VerifyOptions — replaces `records` with `scanResult`
 * so that field additions to VerifyOptions automatically propagate.
 */
export interface CheckOptions extends Omit<VerifyOptions, 'records'> {
  scanResult: ScanResult;
}

export interface CheckResult {
  scanResult: ScanResult;
  verifyResult: VerifyResult;
}

/**
 * One-shot check: takes scan result and registry, runs verify.
 * Pure function — all I/O is handled by the CLI wrapper.
 */
export function check(options: CheckOptions): CheckResult {
  const { scanResult, ...verifyOpts } = options;

  const verifyResult = verify({
    ...verifyOpts,
    records: scanResult.annotations,
  });

  return {
    scanResult,
    verifyResult,
  };
}

// ── Dual-axis threshold checking (ADR 024 Phase 2) ──────────

export interface ThresholdOptions {
  coverage: number;
  hygiene: number;
  coverageThreshold?: number;
  hygieneThreshold?: number;
}

export interface ThresholdViolation {
  axis: 'coverage' | 'hygiene';
  actual: number;
  threshold: number;
}

export interface ThresholdResult {
  passed: boolean;
  violations: ThresholdViolation[];
}

/**
 * Check coverage/hygiene values against optional thresholds.
 * Pure function — returns structured result for CLI to act on.
 */
export function checkThresholds(options: ThresholdOptions): ThresholdResult {
  const violations: ThresholdViolation[] = [];

  if (
    options.coverageThreshold !== undefined &&
    options.coverage < options.coverageThreshold
  ) {
    violations.push({
      axis: 'coverage',
      actual: options.coverage,
      threshold: options.coverageThreshold,
    });
  }

  if (
    options.hygieneThreshold !== undefined &&
    options.hygiene < options.hygieneThreshold
  ) {
    violations.push({
      axis: 'hygiene',
      actual: options.hygiene,
      threshold: options.hygieneThreshold,
    });
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Compute dual-axis scores from check results.
 * Convenience wrapper that calls calculateCoverage/calculateHygiene
 * so callers don't need to import from report.ts directly.
 */
export function computeDualAxisScores(
  scanResult: ScanResult,
  byType: Record<VerifyIssueType, number>,
): { coverage: number; hygiene: number } {
  return {
    coverage: calculateCoverage(scanResult.annotations, scanResult.candidates),
    hygiene: calculateHygiene(byType),
  };
}

export { type OutputFormat };
