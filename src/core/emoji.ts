import type { HealthLevel, TrendDirection } from './types.ts';

/** Insight severity level (matches ReportInsight.level) */
type InsightLevel = 'info' | 'warning' | 'error';

/**
 * Emoji indicator for governance health level.
 * Used across health summary, report markdown, and trend timeline.
 */
export function healthEmoji(level: HealthLevel): string {
  switch (level) {
    case 'healthy':
      return '🟢';
    case 'warning':
      return '🟡';
    case 'critical':
      return '🔴';
  }
}

/**
 * Compact arrow for trend direction in summary boxes.
 * Used in health summary (stderr box).
 */
export function trendArrow(direction: TrendDirection): string {
  switch (direction) {
    case 'improving':
      return '↑';
    case 'declining':
      return '↓';
    case 'stable':
      return '→';
  }
}

/**
 * Rich emoji for trend direction in markdown headings.
 * Used in trend markdown report.
 */
export function trendEmoji(direction: TrendDirection): string {
  switch (direction) {
    case 'improving':
      return '📈';
    case 'declining':
      return '📉';
    case 'stable':
      return '➡️';
  }
}

/**
 * Icon for insight severity level in report markdown.
 */
export function insightIcon(level: InsightLevel): string {
  switch (level) {
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️';
    case 'info':
      return 'ℹ️';
  }
}

/**
 * Icon for gate pass/fail status in delta markdown.
 */
export function gateIcon(passed: boolean): string {
  return passed ? '✅' : '❌';
}
