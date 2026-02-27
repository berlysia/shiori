import type { ReportResult } from '../commands/report.ts';

/**
 * Shields.io endpoint badge JSON structure.
 * @see https://shields.io/endpoint
 */
export interface ShieldsBadge {
  /** Must be 1 */
  schemaVersion: 1;
  /** Left side text */
  label: string;
  /** Right side text (score display) */
  message: string;
  /** Badge color based on health level */
  color: 'brightgreen' | 'yellow' | 'red';
}

/**
 * Map health level to shields.io color.
 */
function healthColor(
  level: ReportResult['health']['level'],
): ShieldsBadge['color'] {
  switch (level) {
    case 'healthy':
      return 'brightgreen';
    case 'warning':
      return 'yellow';
    case 'critical':
      return 'red';
  }
}

/**
 * Format a ReportResult as shields.io endpoint badge JSON.
 * Pure function — no I/O.
 */
export function formatReportAsBadge(result: ReportResult): string {
  const badge: ShieldsBadge = {
    schemaVersion: 1,
    label: 'governance',
    message: `${result.health.score}/100`,
    color: healthColor(result.health.level),
  };
  return JSON.stringify(badge, null, 2);
}
