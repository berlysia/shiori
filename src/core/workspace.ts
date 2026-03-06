/**
 * Workspace detection and cross-package scanning.
 *
 * Provides lightweight monorepo workspace detection (pnpm, npm/yarn)
 * and parallel package-level scanning with path normalization.
 *
 * Design: CLI orchestration layer only — pure logic (verify, report, health)
 * remains untouched. See ADR 022.
 */
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';

import type { ScanResult, ShioriAnnotation, ShioriCandidate } from './types.ts';
import type { ScanOptions } from '../commands/scan.ts';
import { scan } from '../commands/scan.ts';

// ── Types ────────────────────────────────────────────────────

/** A single workspace package */
export interface WorkspacePackage {
  /** Package name (from package.json#name) */
  name: string;
  /** Root-relative directory path (forward-slash separated) */
  dir: string;
}

/** Workspace detection source */
export type WorkspaceSource = 'pnpm-workspace' | 'npm-workspaces';

/** Result of workspace detection */
export interface WorkspaceDetectionResult {
  /** Detected packages */
  packages: WorkspacePackage[];
  /** Workspace root path */
  root: string;
  /** Detection source */
  source: WorkspaceSource;
}

/** Scan result for a single package */
export interface PackageScanResult {
  /** Package name */
  package: string;
  /** Root-relative directory */
  dir: string;
  /** Scan result (location.file paths are package-relative) */
  scanResult: ScanResult;
}

/** Aggregated workspace scan result */
export interface WorkspaceScanResult {
  /** Per-package results */
  packages: PackageScanResult[];
  /** Merged result with root-relative paths (for verify/report/health) */
  merged: ScanResult;
}

// ── Detection ────────────────────────────────────────────────

/**
 * Detect workspace packages from a monorepo root.
 *
 * Detection priority:
 *   1. pnpm-workspace.yaml → packages field glob expansion
 *   2. package.json#workspaces → glob expansion
 *
 * Returns null if no workspace configuration is found.
 */
export async function detectWorkspaces(
  cwd: string,
): Promise<WorkspaceDetectionResult | null> {
  // Priority 1: pnpm-workspace.yaml
  const pnpmResult = await detectPnpmWorkspace(cwd);
  if (pnpmResult) return pnpmResult;

  // Priority 2: package.json#workspaces
  const npmResult = await detectNpmWorkspaces(cwd);
  if (npmResult) return npmResult;

  return null;
}

async function detectPnpmWorkspace(
  cwd: string,
): Promise<WorkspaceDetectionResult | null> {
  const configPath = join(cwd, 'pnpm-workspace.yaml');
  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseYaml(content) as { packages?: string[] } | null;
  const patterns = parsed?.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) return null;

  const packages = await resolvePackageGlobs(cwd, patterns);
  return { packages, root: cwd, source: 'pnpm-workspace' };
}

async function detectNpmWorkspaces(
  cwd: string,
): Promise<WorkspaceDetectionResult | null> {
  const pkgPath = join(cwd, 'package.json');
  let content: string;
  try {
    content = await readFile(pkgPath, 'utf-8');
  } catch {
    return null;
  }

  const parsed = JSON.parse(content) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const workspaces = parsed.workspaces;
  if (!workspaces) return null;

  const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) return null;

  const packages = await resolvePackageGlobs(cwd, patterns);
  return { packages, root: cwd, source: 'npm-workspaces' };
}

/**
 * Resolve glob patterns to workspace packages.
 * Each matched directory must contain a package.json with a name field.
 */
async function resolvePackageGlobs(
  cwd: string,
  patterns: string[],
): Promise<WorkspacePackage[]> {
  const dirs = await fg(patterns, {
    cwd,
    onlyDirectories: true,
    absolute: false,
  });

  const packages: WorkspacePackage[] = [];
  for (const dir of dirs.sort()) {
    const pkgPath = join(cwd, dir, 'package.json');
    try {
      const content = await readFile(pkgPath, 'utf-8');
      const parsed = JSON.parse(content) as { name?: string };
      if (parsed.name) {
        // Normalize to forward-slash for cross-platform consistency
        packages.push({ name: parsed.name, dir: dir.split('\\').join('/') });
      }
    } catch {
      // Skip directories without valid package.json
    }
  }

  return packages;
}

// ── Scanning ─────────────────────────────────────────────────

/**
 * Scan all workspace packages and merge results.
 *
 * Each package is scanned independently with its own cwd.
 * Annotation/candidate location.file paths are normalized to
 * `<pkg.dir>/<relative-path>` (root-relative) in the merged result.
 *
 * @param packages - Workspace packages to scan
 * @param rootCwd - Workspace root directory (for registry resolution)
 * @param scanOptions - Scan options (without cwd — each package provides its own)
 */
export async function scanWorkspaces(
  packages: WorkspacePackage[],
  rootCwd: string,
  scanOptions: Omit<ScanOptions, 'cwd'>,
): Promise<WorkspaceScanResult> {
  const packageResults = await Promise.all(
    packages.map(async (pkg): Promise<PackageScanResult> => {
      const pkgCwd = join(rootCwd, pkg.dir);
      const scanResult = await scan({ ...scanOptions, cwd: pkgCwd });
      return {
        package: pkg.name,
        dir: pkg.dir,
        scanResult,
      };
    }),
  );

  const merged = mergePackageResults(packageResults);
  return { packages: packageResults, merged };
}

/**
 * Merge per-package scan results into a single ScanResult.
 * Rewrites location.file to root-relative paths: `<pkg.dir>/<file>`.
 */
function mergePackageResults(results: PackageScanResult[]): ScanResult {
  const allAnnotations: ShioriAnnotation[] = [];
  const allCandidates: ShioriCandidate[] = [];
  let filesScanned = 0;

  for (const { dir, scanResult } of results) {
    for (const annotation of scanResult.annotations) {
      allAnnotations.push({
        ...annotation,
        location: {
          ...annotation.location,
          file: posix.join(dir, annotation.location.file),
        },
      });
    }
    for (const candidate of scanResult.candidates) {
      allCandidates.push({
        ...candidate,
        location: {
          ...candidate.location,
          file: posix.join(dir, candidate.location.file),
        },
      });
    }
    filesScanned += scanResult.filesScanned;
  }

  // Stable sort: by ref/file/line for annotations, by file/line for candidates
  allAnnotations.sort((a, b) => {
    if (a.ref !== b.ref) return a.ref.localeCompare(b.ref);
    if (a.location.file !== b.location.file)
      return a.location.file.localeCompare(b.location.file);
    return a.location.line - b.location.line;
  });

  allCandidates.sort((a, b) => {
    if (a.location.file !== b.location.file)
      return a.location.file.localeCompare(b.location.file);
    return a.location.line - b.location.line;
  });

  return {
    annotations: allAnnotations,
    candidates: allCandidates,
    filesScanned,
  };
}
