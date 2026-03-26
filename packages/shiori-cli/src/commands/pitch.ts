import type {
  ReportResult,
  TrendResult,
  PitchResult,
  PitchHighlight,
  HealthLevel,
  RecommendedAction,
} from '../core/types.ts';
import { PITCH_FORMATS, type PitchFormat } from '../core/types.ts';
import type { TriageResult } from './triage.ts';

export { PITCH_FORMATS };
export type { PitchFormat, PitchResult };

// ── Options ─────────────────────────────────────────────────

export interface PitchOptions {
  /** Pre-computed report result */
  reportResult: ReportResult;
  /** Pre-computed trend result (optional, from snapshot history) */
  trendResult?: TrendResult;
  /** Pre-computed triage result (optional, for priority distribution) */
  triageResult?: TriageResult;
  /** Team/project name (fallback: cwd basename) */
  teamName: string;
}

// ── Core logic ──────────────────────────────────────────────

/**
 * Generate a governance adoption pitch from report, trend, and triage data.
 * Pure function -- no I/O.
 */
export function pitch(options: PitchOptions): PitchResult {
  const { reportResult, trendResult, triageResult, teamName } = options;

  const { score, level } = reportResult.health;

  const highlights = buildHighlights(reportResult, trendResult, triageResult);
  const headline = buildHeadline(teamName, score, level);
  const nextSteps = buildNextSteps(reportResult, trendResult);
  const recommendedActions = buildRecommendedActions(reportResult, trendResult);

  const result: PitchResult = {
    timestamp: reportResult.timestamp,
    teamName,
    headline,
    health: { score, level },
    highlights,
    nextSteps,
    recommendedActions,
  };

  if (trendResult && trendResult.points.length > 0) {
    result.trend = {
      direction: trendResult.summary.direction,
      scoreChange: trendResult.summary.scoreChange,
      dataPoints: trendResult.summary.count,
    };
  }

  return result;
}

// ── Headline ────────────────────────────────────────────────

function buildHeadline(
  teamName: string,
  score: number,
  level: HealthLevel,
): string {
  if (score >= 80) {
    return `${teamName}: Governance score ${score}/100 -- ready to enforce in CI`;
  }
  if (score >= 50) {
    return `${teamName}: Governance score ${score}/100 -- quick wins available to reach healthy`;
  }
  return `${teamName}: Governance score ${score}/100 -- high-impact improvements identified`;
}

// ── Highlights ──────────────────────────────────────────────

function buildHighlights(
  reportResult: ReportResult,
  trendResult?: TrendResult,
  triageResult?: TriageResult,
): PitchHighlight[] {
  const highlights: PitchHighlight[] = [];

  // Health score overview
  const { score, level } = reportResult.health;
  const healthEmoji =
    level === 'healthy' ? '🟢' : level === 'warning' ? '🟡' : '🔴';
  highlights.push({
    emoji: healthEmoji,
    category: 'health',
    message: `Current governance score: ${score}/100 (${level})`,
  });

  // Tracking coverage
  const { annotations, candidates } = reportResult.totals;
  const total = annotations + candidates;
  if (total > 0) {
    const coverage = Math.round((annotations / total) * 100);
    highlights.push({
      emoji: '📊',
      category: 'coverage',
      message: `${coverage}% of lint disables are tracked (${annotations} tracked, ${candidates} untracked)`,
    });
  }

  // Trend direction (when available)
  if (trendResult && trendResult.points.length > 0) {
    const { direction, scoreChange, count } = trendResult.summary;
    const sign = scoreChange >= 0 ? '+' : '';
    const arrow =
      direction === 'improving'
        ? '📈'
        : direction === 'declining'
          ? '📉'
          : '➡️';
    highlights.push({
      emoji: arrow,
      category: 'trend',
      message: `Score trend: ${direction} (${sign}${scoreChange} over ${count} snapshots)`,
    });
  }

  // Risk exposure from triage
  if (triageResult && triageResult.summary.total > 0) {
    const { critical, high } = triageResult.summary.byPriority;
    const urgent = critical + high;
    if (urgent > 0) {
      highlights.push({
        emoji: '🚨',
        category: 'risk',
        message: `${urgent} urgent issue(s) (${critical} critical, ${high} high priority)`,
      });
    }
  }

  // Expired annotations
  const expiredCount = reportResult.byType['expired'];
  if (expiredCount > 0) {
    highlights.push({
      emoji: '⏰',
      category: 'expired',
      message: `${expiredCount} expired annotation(s) need resolution`,
    });
  }

  // Expiring soon
  const expiringCount = reportResult.byType['expiring-soon'];
  if (expiringCount > 0) {
    highlights.push({
      emoji: '⚠️',
      category: 'expiring',
      message: `${expiringCount} annotation(s) expiring soon`,
    });
  }

  return highlights;
}

// ── Next Steps ──────────────────────────────────────────────

function buildNextSteps(
  reportResult: ReportResult,
  trendResult?: TrendResult,
): string[] {
  const steps: string[] = [];
  const { score } = reportResult.health;
  const { candidates } = reportResult.totals;
  const expired = reportResult.byType['expired'];
  const missing = reportResult.byType['missing-in-registry'];

  // Priority-ordered next steps
  if (expired > 0) {
    steps.push(
      'shiori triage --expired-only  # Review and resolve expired annotations',
    );
  }

  if (missing > 0) {
    steps.push('shiori update  # Register untracked annotations');
  }

  if (candidates > 0) {
    steps.push('shiori adopt  # Convert lint disables to tracked annotations');
  }

  if (score >= 80) {
    steps.push(
      'shiori check --fail-on expired,missing-in-registry  # Enforce in CI',
    );
  }

  if (!trendResult || trendResult.points.length === 0) {
    steps.push('shiori health --snapshot  # Start accumulating trend data');
  }

  // Always suggest health as the monitoring entry point
  if (steps.length === 0) {
    steps.push('shiori health --trend  # Monitor governance trend');
  }

  return steps;
}

// ── Recommended Actions (EP-0179) ───────────────────────────

/**
 * Build machine-readable recommended actions from report and trend data.
 * Mirrors buildNextSteps conditions but produces structured RecommendedAction[].
 */
function buildRecommendedActions(
  reportResult: ReportResult,
  trendResult?: TrendResult,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const { score } = reportResult.health;
  const { candidates } = reportResult.totals;
  const expired = reportResult.byType['expired'];
  const missing = reportResult.byType['missing-in-registry'];
  let priority = 1;

  if (expired > 0) {
    actions.push({
      action: 'triage',
      command: 'shiori triage --expired-only',
      args: ['--expired-only'],
      reason: 'Review and resolve expired annotations',
      priority: priority++,
    });
  }

  if (missing > 0) {
    actions.push({
      action: 'update',
      command: 'shiori update',
      args: [],
      reason: 'Register untracked annotations',
      priority: priority++,
    });
  }

  if (candidates > 0) {
    actions.push({
      action: 'adopt',
      command: 'shiori adopt',
      args: [],
      reason: 'Convert lint disables to tracked annotations',
      priority: priority++,
    });
  }

  if (score >= 80) {
    actions.push({
      action: 'check',
      command: 'shiori check --fail-on expired,missing-in-registry',
      args: ['--fail-on', 'expired,missing-in-registry'],
      reason: 'Enforce in CI',
      priority: priority++,
    });
  }

  if (!trendResult || trendResult.points.length === 0) {
    actions.push({
      action: 'health',
      command: 'shiori health --snapshot',
      args: ['--snapshot'],
      reason: 'Start accumulating trend data',
      priority: priority++,
    });
  }

  // Fallback: suggest monitoring when no other actions apply
  if (actions.length === 0) {
    actions.push({
      action: 'health',
      command: 'shiori health --trend',
      args: ['--trend'],
      reason: 'Monitor governance trend',
      priority: 1,
    });
  }

  return actions;
}

// ── Markdown Formatter ──────────────────────────────────────

/**
 * Format PitchResult as a Markdown report suitable for sharing in
 * team channels, PRs, or wiki pages.
 */
export function formatPitchAsMarkdown(result: PitchResult): string {
  const lines: string[] = [];

  lines.push(`# ${result.headline}`);
  lines.push('');

  // Health badge
  const healthEmoji =
    result.health.level === 'healthy'
      ? '🟢'
      : result.health.level === 'warning'
        ? '🟡'
        : '🔴';
  lines.push(
    `**Governance Health:** ${healthEmoji} ${result.health.score}/100 (${result.health.level})`,
  );
  lines.push('');

  // Highlights
  if (result.highlights.length > 0) {
    lines.push('## Key Findings');
    lines.push('');
    for (const h of result.highlights) {
      lines.push(`- ${h.emoji} **${h.category}**: ${h.message}`);
    }
    lines.push('');
  }

  // Trend
  if (result.trend) {
    const sign = result.trend.scoreChange >= 0 ? '+' : '';
    lines.push('## Trend');
    lines.push('');
    lines.push(
      `Score is **${result.trend.direction}** (${sign}${result.trend.scoreChange}) over ${result.trend.dataPoints} snapshot(s).`,
    );
    lines.push('');
  }

  // Next steps
  if (result.nextSteps.length > 0) {
    lines.push('## Recommended Next Steps');
    lines.push('');
    for (const step of result.nextSteps) {
      lines.push(`\`\`\`sh\n${step}\n\`\`\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by \`shiori pitch\` at ${result.timestamp}*`);
  lines.push('');

  return lines.join('\n');
}
