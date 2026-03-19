import type { ScanResult, VerifyResult } from '../core/types.ts';
import { verify, type VerifyOptions, type OutputFormat } from './verify.ts';

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

export { type OutputFormat };
