import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import type { ShioriAnnotation, ShioriCandidate } from '../core/types.ts';
import type {
  AnnotationProvider,
  ProviderScanOptions,
} from '../core/providers/AnnotationProvider.ts';

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

export interface ScanResult {
  /** Extracted annotations (stably sorted by ref, location.file, location.line) */
  annotations: ShioriAnnotation[];
  /** Detected candidates (sorted by location.file, location.line) */
  candidates: ShioriCandidate[];
  /** Number of files scanned */
  filesScanned: number;
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

  for (const filePath of files) {
    const absolutePath = `${options.cwd}/${filePath}`;
    const content = await readFile(absolutePath, 'utf-8');
    const result = options.provider.scan(
      { path: filePath, content },
      options.providerOptions,
    );
    allAnnotations.push(...result.annotations);
    allCandidates.push(...result.candidates);
  }

  return {
    annotations: sortAnnotations(allAnnotations),
    candidates: sortCandidates(allCandidates),
    filesScanned: files.length,
  };
}
