/**
 * Shared HTML utility functions for formatters.
 *
 * Centralizes escapeHtml, healthColor (CSS), and healthIndicator
 * to eliminate duplication across report-html-formatter,
 * aggregate-html-formatter, and report-generator.
 */

import type { HealthLevel } from './types.ts';

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Map health level to CSS hex color value.
 * For shields.io badge colors, see report-formatter.ts.
 */
export function healthColorCss(level: HealthLevel): string {
  switch (level) {
    case 'healthy':
      return '#22c55e';
    case 'warning':
      return '#eab308';
    case 'critical':
      return '#ef4444';
  }
}

/**
 * Map health level to emoji indicator for HTML contexts.
 */
export function healthIndicator(level: HealthLevel): string {
  switch (level) {
    case 'healthy':
      return '\u{1F7E2}'; // green circle
    case 'warning':
      return '\u{1F7E1}'; // yellow circle
    case 'critical':
      return '\u{1F534}'; // red circle
  }
}
