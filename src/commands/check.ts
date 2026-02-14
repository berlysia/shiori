import type { ScanResult } from './scan.ts';
import type { VerifyResult, VerifyIssueType } from '../core/types.ts';
import type { Registry } from '../core/types.ts';
import { verify, type OutputFormat } from './verify.ts';

export interface CheckOptions {
  scanResult: ScanResult;
  registry: Registry;
  failOn: VerifyIssueType[];
  warnOn: VerifyIssueType[];
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
  const verifyResult = verify({
    records: options.scanResult.annotations,
    registry: options.registry,
    failOn: options.failOn,
    warnOn: options.warnOn,
  });

  return {
    scanResult: options.scanResult,
    verifyResult,
  };
}

export { type OutputFormat };
