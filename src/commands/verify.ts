import {
  VERIFY_ISSUE_TYPES,
  type IssueSeverity,
  type Registry,
  type ShioriAnnotation,
  type VerifyIssue,
  type VerifyIssueType,
  type VerifyResult,
} from '../core/types.ts';
import type { RegistryDuplicateWarning } from '../core/registry.ts';
import type { RefPatternConfig } from '../core/ref-pattern.ts';
import { isValidRef } from '../core/ref-validation.ts';
import { matchRefPattern } from '../core/ref-pattern.ts';

export type { OutputFormat } from '../core/types.ts';

export interface VerifyOptions {
  /** Shiori annotations from scan */
  records: ShioriAnnotation[];
  /** Registry data */
  registry: Registry;
  /** Issue types that cause exit code 1 */
  failOn: VerifyIssueType[];
  /** Issue types reported as warnings */
  warnOn: VerifyIssueType[];
  /** Reference date for expiry checks (default: now, injectable for tests) */
  now?: Date;
  /** Registry duplicate warnings from multi-registry loading */
  duplicates?: RegistryDuplicateWarning[];
  /** Pattern-based ref routing configuration (ADR 012) */
  refPatterns?: RefPatternConfig[];
  /**
   * Maps each ref to its origin registryFile config value (ADR 012 phase 2).
   * null = default registry, string = pattern's registryFile.
   * Used to detect registry-routing-mismatch.
   */
  refOrigins?: Map<string, string | null>;
  /** Threshold in days for expiring-soon detection (default: 14) */
  expiringThresholdDays?: number;
}

function determineSeverity(
  type: VerifyIssueType,
  failOn: VerifyIssueType[],
  warnOn: VerifyIssueType[],
): IssueSeverity {
  if (failOn.includes(type)) return 'error';
  if (warnOn.includes(type)) return 'warning';
  return 'warning';
}

function buildSummary(issues: VerifyIssue[]): VerifyResult['summary'] {
  // shiori: DEV-011 reason="Object.fromEntries returns Record<string, number> but we need Record<VerifyIssueType, number>; TS cannot narrow string keys from mapped const array"
  const byType = Object.fromEntries(
    VERIFY_ISSUE_TYPES.map((t) => [t, 0]),
  ) as Record<VerifyIssueType, number>;
  let errors = 0;
  let warnings = 0;

  for (const issue of issues) {
    byType[issue.type]++;
    if (issue.severity === 'error') errors++;
    else warnings++;
  }

  return { total: issues.length, errors, warnings, byType };
}

/**
 * Normalize expires for comparison.
 * YYYY-MM → YYYY-MM-99 to treat month-only as "end of month".
 */
function normalizeExpires(expires: string): string {
  return expires.length === 7 ? expires + '-99' : expires;
}

/**
 * Verify scan results against registry, detecting issues.
 */
export function verify(options: VerifyOptions): VerifyResult {
  const { records, registry, failOn, warnOn, duplicates } = options;
  const now = options.now ?? new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const issues: VerifyIssue[] = [];

  // Collect source refs (excluding empty refs and ignored annotations)
  const sourceRefs = new Set<string>();
  for (const record of records) {
    if (record.ref !== '' && !record.ignored) {
      sourceRefs.add(record.ref);
    }
  }

  // Check syntax-error (annotation marker present but parse errors exist)
  for (const record of records) {
    if (record.ignored) continue;
    if (
      record.tagged &&
      record.syntaxErrors &&
      record.syntaxErrors.length > 0
    ) {
      issues.push({
        type: 'syntax-error',
        severity: determineSeverity('syntax-error', failOn, warnOn),
        ref: record.ref,
        message: `Syntax error: ${record.syntaxErrors.join('; ')}`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check ref-format (ADR 015-B: warn about invalid ref formats, deduplicate by ref)
  const reportedRefFormat = new Set<string>();
  for (const record of records) {
    if (record.ref === '' || record.ignored) continue;
    if (reportedRefFormat.has(record.ref)) continue;
    if (!isValidRef(record.ref)) {
      reportedRefFormat.add(record.ref);
      issues.push({
        type: 'ref-format',
        severity: determineSeverity('ref-format', failOn, warnOn),
        ref: record.ref,
        message: `Invalid ref format "${record.ref}": expected uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check unrouted-ref (ADR 012: refs that don't match any configured pattern, deduplicate by ref)
  if (options.refPatterns && options.refPatterns.length > 0) {
    const reportedUnrouted = new Set<string>();
    for (const record of records) {
      if (record.ref === '' || record.ignored) continue;
      if (reportedUnrouted.has(record.ref)) continue;
      if (!matchRefPattern(record.ref, options.refPatterns)) {
        reportedUnrouted.add(record.ref);
        issues.push({
          type: 'unrouted-ref',
          severity: determineSeverity('unrouted-ref', failOn, warnOn),
          ref: record.ref,
          message: `Ref "${record.ref}" does not match any configured refPatterns`,
          file: record.location.file,
          line: record.location.line,
        });
      }
    }
  }

  // Check missing-in-registry (deduplicate by ref)
  const reportedMissing = new Set<string>();
  for (const record of records) {
    if (record.ref === '' || record.ignored) continue;
    if (reportedMissing.has(record.ref)) continue;
    if (!(record.ref in registry)) {
      reportedMissing.add(record.ref);
      issues.push({
        type: 'missing-in-registry',
        severity: determineSeverity('missing-in-registry', failOn, warnOn),
        ref: record.ref,
        message: `ID "${record.ref}" found in source but not in registry`,
        file: record.location.file,
        line: record.location.line,
      });
    }
  }

  // Check unused-in-source
  for (const ref of Object.keys(registry)) {
    if (!sourceRefs.has(ref)) {
      issues.push({
        type: 'unused-in-source',
        severity: determineSeverity('unused-in-source', failOn, warnOn),
        ref,
        message: `ID "${ref}" exists in registry but not found in source`,
        file: undefined,
        line: undefined,
      });
    }
  }

  // Check expired (registry entries) — track reported refs to avoid double-reporting with expiring-soon
  const reportedExpired = new Set<string>();
  for (const [ref, entry] of Object.entries(registry)) {
    if (entry.expires) {
      const norm = normalizeExpires(entry.expires);
      if (norm < todayStr) {
        reportedExpired.add(ref);
        issues.push({
          type: 'expired',
          severity: determineSeverity('expired', failOn, warnOn),
          ref,
          message: `ID "${ref}" expired on ${entry.expires}`,
          file: undefined,
          line: undefined,
        });
      }
    }
  }

  // Check expiring-soon (registry entries approaching expiration)
  const expiringThresholdDays = options.expiringThresholdDays ?? 14;
  const thresholdDate = new Date(now);
  thresholdDate.setDate(thresholdDate.getDate() + expiringThresholdDays);
  const thresholdDateStr = thresholdDate.toISOString().slice(0, 10);
  for (const [ref, entry] of Object.entries(registry)) {
    if (!entry.expires) continue;
    if (reportedExpired.has(ref)) continue;
    const norm = normalizeExpires(entry.expires);
    if (norm <= thresholdDateStr) {
      issues.push({
        type: 'expiring-soon',
        severity: determineSeverity('expiring-soon', failOn, warnOn),
        ref,
        message: `ID "${ref}" expires on ${entry.expires} (within ${expiringThresholdDays} days)`,
        file: undefined,
        line: undefined,
      });
    }
  }

  // Check ref-collision (multi-registry duplicate keys)
  if (duplicates && duplicates.length > 0) {
    for (const dup of duplicates) {
      issues.push({
        type: 'ref-collision',
        severity: determineSeverity('ref-collision', failOn, warnOn),
        ref: dup.ref,
        message: `Ref "${dup.ref}" defined in both ${dup.defaultFile} and ${dup.patternFile} (pattern file takes precedence)`,
        file: undefined,
        line: undefined,
      });
    }
  }

  // Check registry-routing-mismatch (ADR 012 phase 2: ref in wrong registry file)
  if (
    options.refOrigins &&
    options.refPatterns &&
    options.refPatterns.length > 0
  ) {
    for (const ref of Object.keys(registry)) {
      const match = matchRefPattern(ref, options.refPatterns);
      if (!match) continue; // unrouted refs handled by unrouted-ref check
      const expectedFile = match.config.registryFile ?? null;
      const actualFile = options.refOrigins.get(ref) ?? null;
      if (expectedFile !== actualFile) {
        const actualLabel = actualFile ?? 'default registry';
        const expectedLabel = expectedFile ?? 'default registry';
        issues.push({
          type: 'registry-routing-mismatch',
          severity: determineSeverity(
            'registry-routing-mismatch',
            failOn,
            warnOn,
          ),
          ref,
          message: `Ref "${ref}" is in ${actualLabel} but pattern "${match.config.match}" routes to ${expectedLabel}`,
          file: undefined,
          line: undefined,
        });
      }
    }
  }

  return {
    timestamp: now.toISOString(),
    issues,
    summary: buildSummary(issues),
    scannedRecords: records.length,
    registryEntries: Object.keys(registry).length,
  };
}

/**
 * Generate action hints based on verify result issue types.
 * Intended for stderr output to guide users on next steps.
 */
export function formatActionHints(result: VerifyResult): string[] {
  const hints: string[] = [];
  const { byType } = result.summary;

  if (result.summary.total === 0) {
    hints.push('All checks passed. Registry is in sync with source.');
    return hints;
  }

  hints.push('');
  hints.push('Action hints:');

  if (byType['missing-in-registry'] > 0) {
    hints.push(
      `  missing-in-registry (${byType['missing-in-registry']}): Run "shiori update" to add new refs, then fill in reason/owner/expires.`,
    );
  }
  if (byType['unused-in-source'] > 0) {
    hints.push(
      `  unused-in-source (${byType['unused-in-source']}): Remove stale entries from the registry, or re-add the annotation in source.`,
    );
  }
  if (byType['expired'] > 0) {
    hints.push(
      `  expired (${byType['expired']}): Resolve the underlying issue and remove the annotation, or extend expires in the registry.`,
    );
  }
  if (byType['syntax-error'] > 0) {
    hints.push(
      `  syntax-error (${byType['syntax-error']}): Fix annotation syntax. Expected: "shiori: <ref> [key=value ...]"`,
    );
  }
  if (byType['ref-format'] > 0) {
    hints.push(
      `  ref-format (${byType['ref-format']}): Fix ref format. Expected: uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
    );
  }
  if (byType['ref-collision'] > 0) {
    hints.push(
      `  ref-collision (${byType['ref-collision']}): Duplicate ref across registry files. Move the entry to a single registry, or use distinct refs.`,
    );
  }
  if (byType['unrouted-ref'] > 0) {
    hints.push(
      `  unrouted-ref (${byType['unrouted-ref']}): Ref does not match any refPatterns in config. Add a matching pattern or rename the ref.`,
    );
  }
  if (byType['registry-routing-mismatch'] > 0) {
    hints.push(
      `  registry-routing-mismatch (${byType['registry-routing-mismatch']}): Ref is in the wrong registry file. Move it to the file specified by its matching refPattern.`,
    );
  }
  if (byType['expiring-soon'] > 0) {
    hints.push(
      `  expiring-soon (${byType['expiring-soon']}): Entries approaching expiration. Extend expires or resolve the underlying issue.`,
    );
  }

  return hints;
}
