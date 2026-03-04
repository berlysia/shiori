import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorResult,
  DoctorFormat,
} from '../core/types.ts';
import type { DoctorOptions } from './doctor/types.ts';
import {
  loadConfigOnce,
  checkNodeVersion,
  checkConfig,
  checkRegistryWithConfig,
  checkRefPatternsConsistency,
  checkGitignore,
  checkScanResultFreshness,
  checkExpiredEntries,
  checkRegistryCompleteness,
} from './doctor/checks.ts';

// Re-export public APIs for backward compatibility (tests, CLI wrapper)
export type { DoctorOptions } from './doctor/types.ts';
export {
  checkNodeVersion,
  checkConfig,
  checkRegistry,
  checkRefPatternsConsistency,
  checkScanResultFreshness,
  checkGitignore,
  checkExpiredEntries,
  checkRegistryCompleteness,
} from './doctor/checks.ts';

/**
 * Run all diagnostic checks and return the result.
 * Pure async function — no console output.
 *
 * Config is loaded once and shared across checks that need it,
 * avoiding redundant filesystem reads.
 */
export async function doctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  // Load config once — shared by registry, ref-patterns, and scan-result checks
  const configLoadResult = await loadConfigOnce(options.cwd, options.configDir);

  // Run independent checks concurrently
  const [nodeCheck, configCheck, gitignoreCheck, scanResultCheck] =
    await Promise.all([
      checkNodeVersion(),
      checkConfig(options.cwd, options.configDir),
      checkGitignore(options.cwd),
      checkScanResultFreshness(options.cwd, configLoadResult.config),
    ]);
  checks.push(nodeCheck);
  checks.push(configCheck);

  // Registry check uses pre-loaded config
  const registryCheck = await checkRegistryWithConfig(
    options.cwd,
    configLoadResult,
  );
  checks.push(registryCheck.check);

  // ref-patterns check uses registry result (depends on registry check)
  if (registryCheck.registryRefs) {
    const refPatternsCheck = checkRefPatternsConsistency(
      configLoadResult.config,
      registryCheck.registryRefs,
    );
    checks.push(refPatternsCheck);
  }

  // Registry content checks (depend on registry data)
  if (registryCheck.registry) {
    checks.push(checkExpiredEntries(registryCheck.registry));
    checks.push(checkRegistryCompleteness(registryCheck.registry));
  }

  checks.push(gitignoreCheck);
  checks.push(scanResultCheck);

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  return { checks, summary };
}

/** Status icon for display */
function statusIcon(status: DoctorCheckStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'warn':
      return '!';
    case 'fail':
      return '✗';
  }
}

/**
 * Format the doctor result as human-readable text.
 */
export function formatDoctorText(
  result: DoctorResult,
  showFix: boolean,
): string {
  const lines: string[] = [];

  lines.push('shiori doctor:');
  lines.push('');

  for (const check of result.checks) {
    lines.push(
      `  ${statusIcon(check.status)} ${check.label}: ${check.message}`,
    );
    if (showFix && check.fix) {
      lines.push(`    → ${check.fix}`);
    }
  }

  lines.push('');
  const parts: string[] = [];
  if (result.summary.pass > 0) parts.push(`${result.summary.pass} passed`);
  if (result.summary.warn > 0) parts.push(`${result.summary.warn} warning(s)`);
  if (result.summary.fail > 0) parts.push(`${result.summary.fail} failed`);
  lines.push(`  ${parts.join(', ')}`);

  return lines.join('\n');
}

/**
 * Format the doctor result for output.
 */
export function formatDoctor(
  result: DoctorResult,
  format: DoctorFormat,
  showFix: boolean,
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);
    default:
      return formatDoctorText(result, showFix);
  }
}

export type { DoctorResult, DoctorFormat };
