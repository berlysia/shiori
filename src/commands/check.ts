import type {
  ScanResult,
  VerifyResult,
  VerifyIssueType,
  Registry,
} from '../core/types.ts';
import type { RegistryDuplicateWarning } from '../core/registry.ts';
import { verify, type OutputFormat } from './verify.ts';

export interface CheckOptions {
  scanResult: ScanResult;
  registry: Registry;
  failOn: VerifyIssueType[];
  warnOn: VerifyIssueType[];
  /** Registry duplicate warnings from multi-registry loading */
  duplicates?: RegistryDuplicateWarning[];
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
    duplicates: options.duplicates,
  });

  return {
    scanResult: options.scanResult,
    verifyResult,
  };
}

export { type OutputFormat };
