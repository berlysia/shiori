import {
  DOCTOR_FORMATS,
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorResult,
  type DoctorFormat,
  type MaturityResult,
  type MaturityLevel,
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
  checkExitCodePolicies,
} from './doctor/checks.ts';
import { assessMaturity } from './doctor/maturity.ts';
import { buildUpgradePlan } from './doctor/upgrade.ts';
import { REGISTERED_COMMANDS } from '../core/exit-codes.ts';

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
  checkExitCodePolicies,
} from './doctor/checks.ts';
export { assessMaturity } from './doctor/maturity.ts';
export { buildUpgradePlan } from './doctor/upgrade.ts';
export type {
  UpgradePlan,
  UpgradeAction,
  UpgradeActionKind,
  UpgradeActionResult,
  UpgradeResult,
  BadgeMode,
  BuildUpgradePlanOptions,
} from './doctor/upgrade.ts';
export { formatUpgradePlan, formatUpgradeResult } from './doctor/upgrade.ts';

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

  // Exit code policy self-verification (ADR 027)
  checks.push(checkExitCodePolicies(REGISTERED_COMMANDS));

  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  const result: DoctorResult = { checks, summary };

  // Maturity assessment (when --maturity or --upgrade flag is used)
  if (options.maturity || options.upgrade) {
    result.maturity = await assessMaturity(options.cwd, configLoadResult);
  }

  return result;
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

  // Maturity assessment section
  if (result.maturity) {
    lines.push('');
    lines.push(formatMaturityText(result.maturity));
  }

  return lines.join('\n');
}

/** Format maturity level bar: filled blocks for achieved, empty for remaining */
function maturityBar(level: MaturityLevel): string {
  return '█'.repeat(level) + '░'.repeat(4 - level);
}

/**
 * Format the maturity assessment as human-readable text.
 */
export function formatMaturityText(maturity: MaturityResult): string {
  const lines: string[] = [];

  lines.push(
    `Governance Maturity: Level ${maturity.level}/4 — ${maturity.levelLabel}`,
  );
  lines.push(`  [${maturityBar(maturity.level as MaturityLevel)}]`);
  lines.push('');

  // Show signals
  lines.push('  Signals:');
  for (const signal of maturity.signals) {
    const icon = signal.detected ? '✓' : '·';
    lines.push(`    ${icon} ${signal.label}: ${signal.message}`);
  }

  // Show next actions
  if (maturity.nextActions.length > 0) {
    lines.push('');
    lines.push('  Next steps:');
    for (const action of maturity.nextActions) {
      lines.push(`    → Level ${action.targetLevel}: ${action.description}`);
      lines.push(`      Run: ${action.action}`);
    }
  }

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

export { DOCTOR_FORMATS };
export type { DoctorResult, DoctorFormat, MaturityResult };
