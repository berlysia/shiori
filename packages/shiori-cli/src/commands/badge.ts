/**
 * Governance maturity badge generation (EP-0213).
 *
 * Generates shields.io-compatible badge data from health results,
 * using the HealthMaturityStage (Foundation/Tracking/Maintained/Autonomous)
 * for stage-specific color mapping.
 *
 * Pure functions — no I/O.
 */
import { assertNever } from '../core/types.ts';
import type { HealthMaturityStage, HealthResult } from '../core/types.ts';

// ── Badge types ──────────────────────────────────────────────

/** Shields.io endpoint badge JSON with maturity stage focus */
export interface MaturityBadge {
  /** Must be 1 */
  schemaVersion: 1;
  /** Left side text */
  label: string;
  /** Right side text (stage name) */
  message: string;
  /** Stage-specific color */
  color: string;
}

/** Badge style options supported by shields.io */
export type BadgeStyle =
  | 'flat'
  | 'flat-square'
  | 'plastic'
  | 'for-the-badge'
  | 'social';

/** Canonical list of badge output formats (derived → BadgeFormat) */
export const BADGE_FORMATS = ['json', 'markdown', 'url'] as const;

/** Output format for badge command */
export type BadgeFormat = (typeof BADGE_FORMATS)[number];

/** Canonical list of badge styles */
export const BADGE_STYLES: readonly BadgeStyle[] = [
  'flat',
  'flat-square',
  'plastic',
  'for-the-badge',
  'social',
] as const;

// ── Color mapping ────────────────────────────────────────────

/**
 * Map HealthMaturityStage to shields.io color.
 * Foundation=red, Tracking=orange, Maintained=blue, Autonomous=brightgreen.
 */
export const MATURITY_STAGE_COLORS: Record<HealthMaturityStage, string> = {
  Foundation: 'red',
  Tracking: 'orange',
  Maintained: 'blue',
  Autonomous: 'brightgreen',
};

// ── Badge generation ─────────────────────────────────────────

/**
 * Build a MaturityBadge from a HealthResult.
 * Falls back to 'Foundation' if maturityStage is missing.
 */
export function buildMaturityBadge(result: HealthResult): MaturityBadge {
  const stage: HealthMaturityStage = result.maturityStage ?? 'Foundation';
  return {
    schemaVersion: 1,
    label: 'governance',
    message: stage,
    color: MATURITY_STAGE_COLORS[stage],
  };
}

/**
 * Format badge as shields.io endpoint JSON.
 */
export function formatBadgeAsJson(badge: MaturityBadge): string {
  return JSON.stringify(badge, null, 2);
}

/**
 * Build a shields.io static badge URL.
 * Uses the /badge/:label-:message-:color format for self-contained URLs.
 */
export function buildBadgeUrl(
  badge: MaturityBadge,
  style?: BadgeStyle,
): string {
  const label = encodeURIComponent(badge.label);
  const message = encodeURIComponent(badge.message);
  const base = `https://img.shields.io/badge/${label}-${message}-${badge.color}`;
  return style ? `${base}?style=${style}` : base;
}

/**
 * Format badge as Markdown image syntax.
 * Produces `![governance: Stage](url)`.
 */
export function formatBadgeAsMarkdown(
  badge: MaturityBadge,
  style?: BadgeStyle,
): string {
  const url = buildBadgeUrl(badge, style);
  return `![${badge.label}: ${badge.message}](${url})`;
}

// ── Unified format dispatch ──────────────────────────────────

export interface BadgeOptions {
  format: BadgeFormat;
  style?: BadgeStyle;
}

/**
 * Generate badge output from a HealthResult.
 * Dispatches to the appropriate format function.
 */
export function formatBadgeOutput(
  result: HealthResult,
  options: BadgeOptions,
): string {
  const badge = buildMaturityBadge(result);

  switch (options.format) {
    case 'json':
      return formatBadgeAsJson(badge);
    case 'markdown':
      return formatBadgeAsMarkdown(badge, options.style);
    case 'url':
      return buildBadgeUrl(badge, options.style);
    default:
      return assertNever(options.format);
  }
}
