/**
 * Weekly/health/custom report generation pipeline.
 *
 * Two-layer pipeline (data collection and analysis):
 *   1. collectReportData()  — gather journal, registry, and governance data
 *   2. analyzeReportData()  — compute activity summary, health, and velocity metrics
 *
 * Format rendering (formatWeeklyReport) is in formatters/weekly-report-formatter.ts.
 *
 * Pure functions (except collectReportData which performs I/O for data loading).
 *
 * @see EP-0084 for design rationale
 */

import type {
  CollectedReportData,
  AnalyzedReportMetrics,
  ActivitySummary,
  WeeklyReportPreset,
  CliJournalEntry,
  Registry,
  ReportResult,
  JournalVelocityResult,
} from './types.ts';

// ── Layer 1: Data Collector ─────────────────────────────────

/**
 * Resolve the time range for a report preset.
 *
 * - weekly: past 7 days
 * - health: current point-in-time (no time filtering)
 * - custom: uses explicit since/until (defaults to past 30 days)
 */
export function resolvePresetPeriod(
  preset: WeeklyReportPreset,
  since?: string,
  until?: string,
): { since: string; until: string } {
  const now = new Date();
  const untilDate = until ?? now.toISOString().slice(0, 10);

  switch (preset) {
    case 'weekly': {
      const sinceDate =
        since ??
        (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - 7);
          return d.toISOString().slice(0, 10);
        })();
      return { since: sinceDate, until: untilDate };
    }
    case 'health': {
      // Health is point-in-time; use wide range to include all journal data
      const sinceDate = since ?? '1970-01-01';
      return { since: sinceDate, until: untilDate };
    }
    case 'custom': {
      const sinceDate =
        since ??
        (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - 30);
          return d.toISOString().slice(0, 10);
        })();
      return { since: sinceDate, until: untilDate };
    }
  }
}

/**
 * Filter journal entries by time range.
 * Uses ISO string lexicographic comparison (YYYY-MM-DD).
 */
export function filterJournalByPeriod(
  entries: CliJournalEntry[],
  since: string,
  until: string,
): CliJournalEntry[] {
  return entries.filter((entry) => {
    const date = entry.timestamp.slice(0, 10);
    return date >= since && date <= until;
  });
}

/**
 * Assemble collected report data from pre-loaded sources.
 *
 * This function does NOT perform I/O — it filters and assembles data
 * that has already been loaded by the CLI layer.
 */
export function collectReportData(options: {
  journalEntries: CliJournalEntry[];
  registry: Registry;
  reportResult: ReportResult;
  velocity: JournalVelocityResult;
  preset: WeeklyReportPreset;
  since?: string;
  until?: string;
}): CollectedReportData {
  const period = resolvePresetPeriod(
    options.preset,
    options.since,
    options.until,
  );

  const filteredEntries = filterJournalByPeriod(
    options.journalEntries,
    period.since,
    period.until,
  );

  return {
    journalEntries: filteredEntries,
    registry: options.registry,
    reportResult: options.reportResult,
    velocity: options.velocity,
    period,
  };
}

// ── Layer 2: Analyzer ───────────────────────────────────────

/**
 * Compute activity summary from journal entries.
 */
export function computeActivitySummary(
  entries: CliJournalEntry[],
): ActivitySummary {
  const totalOperations = entries.length;
  const successfulOperations = entries.filter((e) => e.success).length;
  const failedOperations = totalOperations - successfulOperations;
  const successRate =
    totalOperations > 0
      ? Math.round((successfulOperations / totalOperations) * 100)
      : 0;

  let entriesAdded = 0;
  let entriesRemoved = 0;
  const refsSet = new Set<string>();
  const byEventType: Record<string, number> = {};

  for (const entry of entries) {
    entriesAdded += entry.entries_added ?? 0;
    entriesRemoved += entry.entries_removed ?? 0;
    for (const ref of entry.refs) {
      refsSet.add(ref);
    }
    byEventType[entry.event_type] = (byEventType[entry.event_type] ?? 0) + 1;
  }

  return {
    totalOperations,
    successfulOperations,
    failedOperations,
    successRate,
    netChange: entriesAdded - entriesRemoved,
    uniqueRefs: [...refsSet].sort(),
    byEventType,
  };
}

/**
 * Analyze collected report data into structured metrics.
 * Pure function — no I/O.
 */
export function analyzeReportData(
  data: CollectedReportData,
): AnalyzedReportMetrics {
  const activity = computeActivitySummary(data.journalEntries);

  return {
    timestamp: new Date().toISOString(),
    period: data.period,
    activity,
    health: { ...data.reportResult.health },
    registryOverview: {
      totalEntries: data.reportResult.totals.registryEntries,
      totalAnnotations: data.reportResult.totals.annotations,
      totalCandidates: data.reportResult.totals.candidates,
      totalIssues: data.reportResult.totals.issues,
    },
    insights: data.reportResult.insights,
    velocity: data.velocity.summary,
  };
}
