import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';
import type {
  ShioriAnnotation,
  ShioriCandidate,
  ScanResult,
  ReportResult,
} from '../core/types.ts';
import { healthEmoji } from '../core/emoji.ts';
import type {
  AnnotationProvider,
  ProviderScanOptions,
} from '../core/providers/AnnotationProvider.ts';

export type { ScanResult } from '../core/types.ts';

export interface ScanOptions {
  /** Glob patterns to scan */
  patterns: string[];
  /** Glob patterns to exclude */
  ignore: string[];
  /** Annotation provider to use */
  provider: AnnotationProvider;
  /** Working directory for glob resolution */
  cwd: string;
  /** Provider scan options (candidate patterns etc.) */
  providerOptions?: ProviderScanOptions;
}

function sortAnnotations(records: ShioriAnnotation[]): ShioriAnnotation[] {
  return records.sort((a, b) => {
    if (a.ref !== b.ref) return a.ref.localeCompare(b.ref);
    if (a.location.file !== b.location.file)
      return a.location.file.localeCompare(b.location.file);
    return a.location.line - b.location.line;
  });
}

function sortCandidates(candidates: ShioriCandidate[]): ShioriCandidate[] {
  return candidates.sort((a, b) => {
    if (a.location.file !== b.location.file)
      return a.location.file.localeCompare(b.location.file);
    return a.location.line - b.location.line;
  });
}

/**
 * Format a scan result as a human-readable string for TTY output.
 */
export function formatScanResultForDisplay(
  result: ScanResult,
  savedTo?: string,
): string {
  const lines: string[] = [];

  lines.push(`Scanned ${result.filesScanned} files`);

  if (result.annotations.length > 0) {
    lines.push('');
    lines.push(`Annotations (${result.annotations.length}):`);
    for (const a of result.annotations) {
      const ref = a.ref || '(draft)';
      const loc = `${a.location.file}:${a.location.line}`;
      const parts = [
        `  ${ref}`,
        loc,
        ...(a.rule ? [a.rule] : []),
        ...(a.expires ? [`expires=${a.expires}`] : []),
        ...(a.reason ? [`reason=${a.reason}`] : []),
      ];
      lines.push(parts.join('   '));
    }
  }

  if (result.candidates.length > 0) {
    lines.push('');
    lines.push(`Candidates (${result.candidates.length}):`);
    for (const c of result.candidates) {
      const loc = `${c.location.file}:${c.location.line}`;
      const detail = c.rule ?? c.text ?? '';
      const parts = [`  ${loc}`, c.pattern, ...(detail ? [detail] : [])];
      lines.push(parts.join('   '));
    }
  }

  if (savedTo) {
    lines.push('');
    lines.push(`Saved to ${savedTo}`);
  }

  return lines.join('\n');
}

/**
 * Scan source files and extract shiori annotations and candidates.
 *
 * Resolves glob patterns to files, reads each file, and delegates extraction
 * to the configured provider. Results are stably sorted for deterministic output.
 *
 * @param options - Scan configuration (patterns, ignore, provider, cwd)
 * @returns Annotations and candidates found, plus the number of files scanned
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const files = await fg(options.patterns, {
    ignore: options.ignore,
    cwd: options.cwd,
    onlyFiles: true,
    absolute: false,
  });

  const allAnnotations: ShioriAnnotation[] = [];
  const allCandidates: ShioriCandidate[] = [];

  // Read and scan files in parallel batches to reduce I/O wait
  const BATCH_SIZE = 20;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        const absolutePath = join(options.cwd, filePath);
        const content = await readFile(absolutePath, 'utf-8');
        return options.provider.scan(
          { path: filePath, content },
          options.providerOptions,
        );
      }),
    );
    for (const result of results) {
      allAnnotations.push(...result.annotations);
      allCandidates.push(...result.candidates);
    }
  }

  return {
    annotations: sortAnnotations(allAnnotations),
    candidates: sortCandidates(allCandidates),
    filesScanned: files.length,
  };
}

/**
 * Format a Governance Report Card for TTY display after scan.
 *
 * Reuses ReportResult from report() to show tracking rate, candidate count,
 * health score, and recommended next actions. Designed for scan-cli TTY mode
 * to guide new users toward governance adoption.
 */
export function formatGovernanceReportCard(
  scanResult: ScanResult,
  reportResult: ReportResult,
): string {
  const lines: string[] = [];
  const { annotations, candidates } = scanResult;
  const total = annotations.length + candidates.length;

  lines.push('');
  lines.push('── Governance Report Card ──────────────────');

  // Health score
  const emoji = healthEmoji(reportResult.health.level);
  lines.push(
    `${emoji} Health: ${reportResult.health.score}/100 (${reportResult.health.level})`,
  );

  // Tracking rate
  if (total > 0) {
    const trackedRate = ((annotations.length / total) * 100).toFixed(0);
    lines.push(
      `Tracked: ${annotations.length}/${total} (${trackedRate}%)   Candidates: ${candidates.length}`,
    );
  } else {
    lines.push('No annotations or candidates found.');
  }

  // Issue summary (if any)
  if (reportResult.totals.issues > 0) {
    lines.push(
      `Issues: ${reportResult.totals.issues} (${reportResult.totals.errors} errors, ${reportResult.totals.warnings} warnings)`,
    );
  }

  // Recommended next actions
  const actions: string[] = [];
  if (candidates.length > 0) {
    actions.push('shiori adopt     # Track untracked lint disables');
  }
  if (reportResult.totals.issues > 0) {
    actions.push('shiori verify    # Check registry consistency');
  }
  if (
    reportResult.totals.issues === 0 &&
    candidates.length === 0 &&
    annotations.length > 0
  ) {
    actions.push('shiori health    # View detailed governance health');
  }

  if (actions.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    for (const action of actions) {
      lines.push(`  $ ${action}`);
    }
  }

  lines.push('────────────────────────────────────────────');

  return lines.join('\n');
}
