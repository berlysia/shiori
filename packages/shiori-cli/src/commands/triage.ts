import {
  assertNever,
  TRIAGE_FORMATS,
  type RegistryEntry,
  type ScanResult,
  type VerifyIssue,
  type VerifyIssueType,
  type VerifyResult,
  type TriageFormat,
} from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { resolveRefUrl } from '../core/ref-pattern.ts';
import { verify, type VerifyOptions } from './verify.ts';
import { ACTION_HINTS } from '../core/action-hints.ts';

export { TRIAGE_FORMATS };
export type { TriageFormat };

// ── Types ────────────────────────────────────────────────────

export interface TriageOptions extends Omit<VerifyOptions, 'records'> {
  scanResult: ScanResult;
  /** Pre-computed verify result to avoid duplicate verify() calls (e.g. from summary) */
  verifyResult?: VerifyResult;
  /** Filter by owner (from registry entry) */
  owner?: string;
  /** Filter by kind (from registry entry) */
  kind?: string;
  /** Show only expired entries */
  expiredOnly?: boolean;
  /** Reference date for expiry (injectable for tests) */
  now?: Date;
}

export type TriagePriority = 'critical' | 'high' | 'medium' | 'low';

export interface TriageItem {
  ref: string;
  priority: TriagePriority;
  issues: VerifyIssue[];
  /** Registry entry (undefined if not in registry) */
  registryEntry: RegistryEntry | undefined;
  /** Source locations */
  sourceLocations: Array<{ file: string; line: number; rule?: string }>;
  /** Resolved URL */
  url: string | undefined;
  /** Suggested action (based on highest-priority issue type) */
  action: string;
}

export interface TriageResult {
  timestamp: string;
  items: TriageItem[];
  summary: {
    total: number;
    byPriority: Record<TriagePriority, number>;
  };
}

// ── Priority mapping ─────────────────────────────────────────

const PRIORITY_ORDER: TriagePriority[] = ['critical', 'high', 'medium', 'low'];

const ISSUE_TYPE_PRIORITY: Record<VerifyIssueType, TriagePriority> = {
  expired: 'critical',
  'expiring-soon': 'high',
  'missing-in-registry': 'high',
  'syntax-error': 'high',
  'ref-format': 'medium',
  'unused-in-source': 'medium',
  'ref-collision': 'medium',
  'unrouted-ref': 'low',
  'registry-routing-mismatch': 'low',
  'ref-status-closed': 'high',
};

// ── Priority helpers ─────────────────────────────────────────

function priorityRank(p: TriagePriority): number {
  return PRIORITY_ORDER.indexOf(p);
}

function highestPriority(issues: VerifyIssue[]): TriagePriority {
  let best: TriagePriority = 'low';
  for (const issue of issues) {
    const p = ISSUE_TYPE_PRIORITY[issue.type];
    if (priorityRank(p) < priorityRank(best)) {
      best = p;
    }
  }
  return best;
}

/** Determine action from the highest-priority issue type, with ref substitution */
function determineAction(issues: VerifyIssue[], ref: string): string {
  let bestPriority: TriagePriority = 'low';
  let bestType: VerifyIssueType = issues[0]!.type;
  for (const issue of issues) {
    const p = ISSUE_TYPE_PRIORITY[issue.type];
    if (priorityRank(p) < priorityRank(bestPriority)) {
      bestPriority = p;
      bestType = issue.type;
    }
  }
  return ACTION_HINTS[bestType].replaceAll('<ref>', ref);
}

// ── Main function ────────────────────────────────────────────

/**
 * Generate a prioritized triage list from scan results and registry.
 * Pure function — no I/O. Uses injected verifyResult when provided,
 * otherwise runs verify() internally. Groups issues by ref,
 * enriches with registry context and source locations, and sorts by priority.
 */
export function triage(options: TriageOptions): TriageResult {
  const {
    scanResult,
    verifyResult: injectedVerifyResult,
    owner,
    kind,
    expiredOnly,
    ...verifyOpts
  } = options;
  const { registry, refPatterns } = verifyOpts;

  // Use injected result if available, otherwise run verify()
  const verifyResult =
    injectedVerifyResult ??
    verify({
      ...verifyOpts,
      records: scanResult.annotations,
    });

  // Group issues by ref
  const issuesByRef = new Map<string, VerifyIssue[]>();
  for (const issue of verifyResult.issues) {
    const ref = issue.ref;
    if (!issuesByRef.has(ref)) {
      issuesByRef.set(ref, []);
    }
    issuesByRef.get(ref)!.push(issue);
  }

  // Build triage items for each ref with issues
  const items: TriageItem[] = [];
  for (const [ref, issues] of issuesByRef) {
    const registryEntry = registry[ref] ?? undefined;

    // Source locations
    const sourceLocations = scanResult.annotations
      .filter((a) => a.ref === ref)
      .map((a) => ({
        file: a.location.file,
        line: a.location.line,
        rule: a.rule,
      }));

    // URL resolution
    const url = resolveRefUrl(ref, refPatterns);

    const priority = highestPriority(issues);
    const action = determineAction(issues, ref);

    items.push({
      ref,
      priority,
      issues,
      registryEntry,
      sourceLocations,
      url,
      action,
    });
  }

  // Apply filters
  const filtered = items.filter((item) => {
    // owner filter: exclude refs without registry entry or mismatched owner
    if (owner !== undefined) {
      if (!item.registryEntry || item.registryEntry.owner !== owner) {
        return false;
      }
    }
    // kind filter: exclude refs without registry entry or mismatched kind
    if (kind !== undefined) {
      if (!item.registryEntry || item.registryEntry.kind !== kind) {
        return false;
      }
    }
    // expired-only filter: only keep refs with expired issues
    if (expiredOnly) {
      if (!item.issues.some((i) => i.type === 'expired')) {
        return false;
      }
    }
    return true;
  });

  // Sort: priority desc (critical first) → ref asc (alphabetical)
  filtered.sort((a, b) => {
    const pa = priorityRank(a.priority);
    const pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    return a.ref.localeCompare(b.ref);
  });

  // Build summary
  const byPriority: Record<TriagePriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const item of filtered) {
    byPriority[item.priority]++;
  }

  return {
    timestamp: verifyResult.timestamp,
    items: filtered,
    summary: {
      total: filtered.length,
      byPriority,
    },
  };
}

// ── Wizard queue ─────────────────────────────────────────────

/** Urgency bucket for wizard display */
export type WizardUrgency = 'overdue' | 'imminent' | 'upcoming' | 'open';

/** A triage item enriched with urgency context for interactive wizard */
export interface WizardQueueItem {
  /** Original triage item */
  item: TriageItem;
  /** Urgency bucket based on expiration proximity */
  urgency: WizardUrgency;
  /** Days until/since expiration (negative = overdue). null if no expiration. */
  daysToExpiry: number | null;
}

/** Result of building a wizard queue */
export interface WizardQueue {
  /** Ordered queue items (overdue first, then by days-to-expiry ascending) */
  items: WizardQueueItem[];
  /** Summary counts by urgency */
  byUrgency: Record<WizardUrgency, number>;
}

/** Options for building a wizard triage queue */
export interface BuildTriageQueueOptions {
  /** Triage result to convert into a wizard queue */
  triageResult: TriageResult;
  /** Reference date for expiry calculation (defaults to now) */
  now?: Date;
  /** Days threshold for "imminent" urgency (default: 14) */
  imminentDays?: number;
  /** Days threshold for "upcoming" urgency (default: 30) */
  upcomingDays?: number;
}

/**
 * Compute days remaining until expiration.
 * Returns negative values for overdue items.
 * Returns null if no expires date is present.
 */
function computeDaysToExpiry(
  registryEntry: RegistryEntry | undefined,
  now: Date,
): number | null {
  if (!registryEntry?.expires) return null;
  const expiresStr = registryEntry.expires;
  // Handle YYYY-MM format by normalizing to YYYY-MM-01
  const normalized = expiresStr.length === 7 ? `${expiresStr}-01` : expiresStr;
  const expiresDate = new Date(normalized);
  if (Number.isNaN(expiresDate.getTime())) return null;
  const diffMs = expiresDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function classifyUrgency(
  daysToExpiry: number | null,
  imminentDays: number,
  upcomingDays: number,
): WizardUrgency {
  if (daysToExpiry === null) return 'open';
  if (daysToExpiry <= 0) return 'overdue';
  if (daysToExpiry <= imminentDays) return 'imminent';
  if (daysToExpiry <= upcomingDays) return 'upcoming';
  return 'open';
}

/**
 * Build an urgency-ordered queue from a triage result for interactive wizard processing.
 *
 * Pure function — no I/O. Enriches triage items with expiry-based urgency
 * and sorts them for deadline-driven triage sessions:
 *   overdue → imminent → upcoming → open
 * Within each urgency bucket, items sort by days-to-expiry (ascending),
 * then by the original triage priority, then by ref name.
 */
export function buildTriageQueue(
  options: BuildTriageQueueOptions,
): WizardQueue {
  const {
    triageResult,
    now = new Date(),
    imminentDays = 14,
    upcomingDays = 30,
  } = options;

  const URGENCY_ORDER: WizardUrgency[] = [
    'overdue',
    'imminent',
    'upcoming',
    'open',
  ];
  function urgencyRank(u: WizardUrgency): number {
    return URGENCY_ORDER.indexOf(u);
  }

  const queueItems: WizardQueueItem[] = triageResult.items.map((item) => {
    const daysToExpiry = computeDaysToExpiry(item.registryEntry, now);
    const urgency = classifyUrgency(daysToExpiry, imminentDays, upcomingDays);
    return { item, urgency, daysToExpiry };
  });

  // Sort: urgency bucket → days-to-expiry asc (nulls last) → priority → ref
  queueItems.sort((a, b) => {
    const ua = urgencyRank(a.urgency);
    const ub = urgencyRank(b.urgency);
    if (ua !== ub) return ua - ub;

    // Within same urgency: sort by days-to-expiry ascending (null → Infinity)
    const da = a.daysToExpiry ?? Number.POSITIVE_INFINITY;
    const db = b.daysToExpiry ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;

    // Fallback: original triage priority then ref
    const pa = priorityRank(a.item.priority);
    const pb = priorityRank(b.item.priority);
    if (pa !== pb) return pa - pb;

    return a.item.ref.localeCompare(b.item.ref);
  });

  const byUrgency: Record<WizardUrgency, number> = {
    overdue: 0,
    imminent: 0,
    upcoming: 0,
    open: 0,
  };
  for (const qi of queueItems) {
    byUrgency[qi.urgency]++;
  }

  return { items: queueItems, byUrgency };
}

// ── Formatters ───────────────────────────────────────────────

const PRIORITY_EMOJI: Record<TriagePriority, string> = {
  critical: '🔴',
  high: '🟡',
  medium: '🔵',
  low: '⚪',
};

const PRIORITY_LABEL: Record<TriagePriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Format TriageResult as markdown report.
 */
export function formatTriageAsMarkdown(result: TriageResult): string {
  const lines: string[] = [];

  lines.push('# Shiori Triage Report');
  lines.push('');
  lines.push(`**Generated:** ${result.timestamp}`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| Priority | Count |');
  lines.push('|----------|-------|');
  for (const p of PRIORITY_ORDER) {
    lines.push(`| ${p} | ${result.summary.byPriority[p]} |`);
  }
  lines.push('');

  if (result.items.length === 0) {
    lines.push('No action items found.');
    return lines.join('\n');
  }

  lines.push('## Action Items');
  lines.push('');

  // Group by priority
  for (const p of PRIORITY_ORDER) {
    const group = result.items.filter((item) => item.priority === p);
    if (group.length === 0) continue;

    lines.push(`### ${PRIORITY_EMOJI[p]} ${PRIORITY_LABEL[p]}`);
    lines.push('');
    lines.push('| Ref | Issues | Owner | Action |');
    lines.push('|-----|--------|-------|--------|');

    for (const item of group) {
      const issueTypes = [...new Set(item.issues.map((i) => i.type))].join(
        ', ',
      );
      const owner = item.registryEntry?.owner ?? '-';
      lines.push(`| ${item.ref} | ${issueTypes} | ${owner} | ${item.action} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format TriageResult based on output format.
 */
export function formatTriageOutput(
  result: TriageResult,
  format: TriageFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatTriageAsMarkdown(result);
    case 'json':
      return wrapOutputJson(result, {
        command: 'triage',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}
