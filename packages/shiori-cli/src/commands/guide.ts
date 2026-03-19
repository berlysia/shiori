/**
 * Interactive command navigator for shiori CLI.
 *
 * Maps user goals ("use cases") to recommended commands with
 * contextual help. Designed to reduce the 23-command discovery gap.
 *
 * Pure module — no IO, no process access.
 */

import type {
  DoctorResult,
  HealthLevel,
  MaturityLevel,
  ReportResult,
} from '../core/types.ts';

// ── Use-case mapping data ─────────────────────────────────────

/**
 * Structured error from a specific extraction stage.
 * Allows wizard to degrade gracefully while surfacing
 * what went wrong to callers (JSON output, formatters).
 */
export interface GuideContextError {
  /** Which extraction stage failed */
  stage: 'doctor' | 'config' | 'maturity' | 'scan' | 'report';
  /** Human-readable error message */
  message: string;
}

/**
 * Doctor diagnostics summary embedded in GuideContext.
 * Carries check pass/warn/fail counts so the wizard
 * can boost diagnostic use cases without re-running doctor.
 */
export interface GuideDiagnostics {
  /** Number of passing doctor checks */
  pass: number;
  /** Number of warning doctor checks */
  warn: number;
  /** Number of failing doctor checks */
  fail: number;
}

/**
 * Project context snapshot used for wizard-mode ranking.
 * All fields are optional — missing data simply skips the
 * corresponding condition checks (graceful degradation).
 */
export interface GuideContext {
  /** Governance maturity level (0-4) from doctor --maturity */
  maturity?: MaturityLevel;
  /** Health score (0-100) from report */
  healthScore?: number;
  /** Health level from report */
  healthLevel?: HealthLevel;
  /** Whether the project has expired annotations */
  hasExpiredAnnotations?: boolean;
  /** Whether the project has expiring-soon annotations */
  hasExpiringSoonAnnotations?: boolean;
  /** Number of untracked candidates */
  candidateCount?: number;
  /** Number of tracked annotations */
  annotationCount?: number;
  /** Doctor check summary for diagnostic-aware ranking */
  diagnostics?: GuideDiagnostics;
  /** Whether doctor detected any failing checks */
  hasDoctorFailures?: boolean;
  /** Whether doctor detected any warning checks */
  hasDoctorWarnings?: boolean;
  /** Errors encountered during context extraction (partial context) */
  errors?: GuideContextError[];
}

/**
 * Declarative condition for context-aware use-case scoring.
 * Each condition contributes a boost (positive or negative)
 * when the project context matches the specified criteria.
 */
export interface ContextCondition {
  /** GuideContext field to evaluate */
  field: keyof GuideContext;
  /** Comparison operator */
  op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'truthy' | 'falsy';
  /** Value to compare against (unused for truthy/falsy) */
  value?: number | boolean;
  /** Score boost when condition matches (positive = more relevant) */
  boost: number;
}

export interface UseCase {
  /** Short machine-readable key */
  id: string;
  /** Human-readable label shown in interactive prompt */
  label: string;
  /** Category for grouping */
  category: UseCaseCategory;
  /** Recommended command(s) to run */
  commands: string[];
  /** One-sentence explanation of what the commands do */
  explanation: string;
  /** Commonly useful options for the primary command */
  options?: string[];
  /** Related recipe filenames (relative to docs/recipes/) */
  recipes?: string[];
  /** Declarative conditions for wizard-mode ranking (EP-0100) */
  contextConditions?: ContextCondition[];
}

export type UseCaseCategory =
  | 'setup'
  | 'daily'
  | 'review'
  | 'governance'
  | 'diagnostics';

const CATEGORY_LABELS: Record<UseCaseCategory, string> = {
  setup: 'Setup & Onboarding',
  daily: 'Daily Workflow',
  review: 'Code Review & CI',
  governance: 'Governance & Reporting',
  diagnostics: 'Diagnostics & Troubleshooting',
};

export const USE_CASES: readonly UseCase[] = [
  // ── Setup ──
  {
    id: 'first-setup',
    label: 'Set up shiori in a new project',
    category: 'setup',
    commands: ['shiori init'],
    explanation:
      'Creates config, scans for annotations, and generates a registry.',
    options: ['--registry <path>', '--provider <name>'],
    recipes: ['pr-onboarding-snippet.md'],
    contextConditions: [{ field: 'maturity', op: 'eq', value: 0, boost: 20 }],
  },
  {
    id: 'adopt-existing',
    label: 'Track existing lint disable comments',
    category: 'setup',
    commands: ['shiori adopt --wizard'],
    explanation:
      'Interactive wizard to selectively adopt untracked lint disable comments into shiori annotations.',
    options: ['--prefix <PREFIX>', '--reason <REASON>', '--kind <KIND>'],
    contextConditions: [
      { field: 'candidateCount', op: 'gt', value: 0, boost: 15 },
      { field: 'maturity', op: 'lte', value: 1, boost: 5 },
    ],
  },
  {
    id: 'ci-setup',
    label: 'Add governance checks to CI',
    category: 'setup',
    commands: ['shiori init --ci basic'],
    explanation: 'Generates a GitHub Actions workflow for shiori verify.',
    recipes: ['github-actions-composite-action.md', 'github-checks-gate.md'],
    contextConditions: [{ field: 'maturity', op: 'eq', value: 1, boost: 15 }],
  },

  // ── Daily ──
  {
    id: 'quick-check',
    label: 'Verify all annotations are valid',
    category: 'daily',
    commands: ['shiori check'],
    explanation: 'One-shot scan + verify — the primary command for daily use.',
    options: ['--fail-on <types>', '--format json'],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 1, boost: 5 }],
  },
  {
    id: 'add-annotation',
    label: 'Add a new annotation to source + registry',
    category: 'daily',
    commands: ['shiori annotate --target <file:line>'],
    explanation:
      'Inserts a shiori annotation comment and creates a registry entry.',
    options: ['--ref <ref>', '--expires <YYYY-MM>', '--format json'],
    recipes: ['vscode-annotate-task.md'],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 1, boost: 3 }],
  },
  {
    id: 'resolve-ref',
    label: 'Remove a resolved/expired annotation',
    category: 'daily',
    commands: ['shiori resolve --ref <ref>'],
    explanation:
      'Removes the annotation from source code and the registry entry.',
    options: ['--closed', '--apply', '--yes'],
    recipes: ['auto-resolve-on-issue-close.md'],
    contextConditions: [
      { field: 'hasExpiredAnnotations', op: 'truthy', boost: 20 },
    ],
  },
  {
    id: 'update-registry',
    label: 'Add new refs found in source to the registry',
    category: 'daily',
    commands: ['shiori update'],
    explanation:
      'Discovers annotations missing from the registry and adds stub entries.',
  },
  {
    id: 'watch-mode',
    label: 'Refresh scan result on each file save',
    category: 'daily',
    commands: ['shiori watch'],
    explanation:
      'Watches source files and re-scans on change — keeps scan-result fresh.',
    options: ['--dashboard', '--open', '--sync-registry'],
    recipes: ['local-dashboard.md'],
  },

  // ── Review ──
  {
    id: 'pr-delta',
    label: 'See what changed in a PR',
    category: 'review',
    commands: ['shiori delta'],
    explanation:
      'Compares scan results between branches to show added/removed annotations.',
    options: ['--base <path>', '--head <path>', '--format markdown'],
    recipes: [
      'github-actions-delta-pr-comment.md',
      'github-actions-delta-pr-description.md',
    ],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 2, boost: 5 }],
  },
  {
    id: 'lookup-ref',
    label: 'Look up details for a specific ref',
    category: 'review',
    commands: ['shiori why --ref <ref>'],
    explanation:
      'Shows registry info, source locations, issues, and URL for one ref.',
    options: ['--json'],
  },
  {
    id: 'jump-to-source',
    label: 'Go to the source location of a ref',
    category: 'review',
    commands: ['shiori jump --ref <ref>'],
    explanation: 'Prints file:line for a ref — pipe to your editor.',
  },
  {
    id: 'find-candidates',
    label: 'List untracked lint disable comments',
    category: 'review',
    commands: ['shiori candidates'],
    explanation:
      'Shows lint disables that could be tracked by shiori but are not yet.',
    options: ['--format json'],
    contextConditions: [
      { field: 'candidateCount', op: 'gt', value: 0, boost: 10 },
    ],
  },

  // ── Governance ──
  {
    id: 'health-check',
    label: 'Quick governance health summary',
    category: 'governance',
    commands: ['shiori health'],
    explanation: 'Scores your project on tracking ratio, expiry, and coverage.',
    options: ['--fail-on <types>', '--fail-on-level <level>'],
    recipes: ['governance-badge.md'],
    contextConditions: [
      { field: 'healthScore', op: 'lt', value: 80, boost: 10 },
      { field: 'maturity', op: 'gte', value: 1, boost: 3 },
    ],
  },
  {
    id: 'triage-actions',
    label: 'Prioritized action list by ref',
    category: 'governance',
    commands: ['shiori triage'],
    explanation:
      'Ranks annotations by urgency — expired first, then expiring soon.',
    recipes: ['renovate-triage.md'],
    contextConditions: [
      { field: 'hasExpiredAnnotations', op: 'truthy', boost: 15 },
      { field: 'hasExpiringSoonAnnotations', op: 'truthy', boost: 10 },
    ],
  },
  {
    id: 'generate-report',
    label: 'Generate a governance report',
    category: 'governance',
    commands: ['shiori report'],
    explanation: 'Produces a Markdown or JSON governance health report.',
    options: [
      '--format html|markdown|badge',
      '--diff-base <path>',
      '--provenance',
      '--chronicle',
      '-o <file>',
    ],
    recipes: [
      'html-artifacts-dashboard.md',
      'governance-badge.md',
      'code-scanning.md',
    ],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 2, boost: 5 }],
  },
  {
    id: 'weekly-report',
    label: 'Generate a periodic governance report',
    category: 'governance',
    commands: ['shiori weekly-report'],
    explanation:
      'Summarizes governance changes over a time period for team review.',
    options: ['--format html|markdown|json', '--preset <name>', '-o <file>'],
    recipes: ['slack-notification.md'],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 3, boost: 5 }],
  },
  {
    id: 'trend-analysis',
    label: 'Compare governance scores over time',
    category: 'governance',
    commands: ['shiori trend'],
    explanation:
      'Shows how tracking ratio and annotation count evolved across snapshots.',
    options: ['--history <dir>', '--format markdown|csv|spark'],
    recipes: ['scheduled-governance-orchestrator.md'],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 3, boost: 5 }],
  },
  {
    id: 'multi-repo',
    label: 'Aggregate summaries across multiple repos',
    category: 'governance',
    commands: ['shiori aggregate'],
    explanation:
      'Combines governance summaries from multiple repositories into one view.',
    options: [
      '--files <glob>',
      '--format html|markdown',
      '--fail-on-level <level>',
      '-o <file>',
    ],
    recipes: ['aggregate-html-dashboard.md'],
    contextConditions: [{ field: 'maturity', op: 'gte', value: 4, boost: 3 }],
  },

  // ── Diagnostics ──
  {
    id: 'diagnose',
    label: 'Diagnose shiori setup issues',
    category: 'diagnostics',
    commands: ['shiori doctor'],
    explanation:
      'Checks config, registry, Node version, gitignore, and scan freshness.',
    options: ['--format json', '--fix'],
    contextConditions: [
      { field: 'healthScore', op: 'lt', value: 50, boost: 15 },
      { field: 'hasDoctorFailures', op: 'truthy', boost: 15 },
    ],
  },
  {
    id: 'maturity-check',
    label: 'Assess governance maturity level',
    category: 'diagnostics',
    commands: ['shiori doctor --maturity'],
    explanation:
      'Evaluates your project on a 0-4 maturity scale (Discover → Enforce).',
    contextConditions: [{ field: 'maturity', op: 'lte', value: 2, boost: 5 }],
  },
  {
    id: 'view-journal',
    label: 'Browse CLI operation history',
    category: 'diagnostics',
    commands: ['shiori journal'],
    explanation: 'Shows a log of past shiori CLI operations and their results.',
    options: ['--last <n>', '--format json'],
  },
  {
    id: 'full-docs',
    label: 'Show full documentation',
    category: 'diagnostics',
    commands: ['shiori docs'],
    explanation: 'Displays the complete shiori CLI reference documentation.',
  },
] as const;

// ── Guide logic ───────────────────────────────────────────────

export interface GuideResult {
  /** Selected use case (undefined in dump mode) */
  useCase?: UseCase;
  /** All use cases grouped by category (for dump / interactive list) */
  grouped: GroupedUseCases;
}

export type GroupedUseCases = Array<{
  category: UseCaseCategory;
  categoryLabel: string;
  useCases: UseCase[];
}>;

/**
 * Group all use cases by category.
 */
export function groupUseCases(): GroupedUseCases {
  const categoryOrder: UseCaseCategory[] = [
    'setup',
    'daily',
    'review',
    'governance',
    'diagnostics',
  ];

  return categoryOrder
    .map((cat) => ({
      category: cat,
      categoryLabel: CATEGORY_LABELS[cat],
      useCases: USE_CASES.filter((uc) => uc.category === cat),
    }))
    .filter((g) => g.useCases.length > 0);
}

/**
 * Find a use case by its id.
 */
export function findUseCase(id: string): UseCase | undefined {
  return USE_CASES.find((uc) => uc.id === id);
}

/**
 * Format a single use case as human-readable text.
 * Includes recommended options and related recipes when available.
 */
export function formatUseCase(useCase: UseCase): string {
  const lines: string[] = [];
  lines.push(`  ${useCase.label}`);
  lines.push(`  ${useCase.explanation}`);
  lines.push('');
  for (const cmd of useCase.commands) {
    lines.push(`  $ ${cmd}`);
  }
  if (useCase.options && useCase.options.length > 0) {
    lines.push('');
    lines.push('  Options:');
    for (const opt of useCase.options) {
      lines.push(`    ${opt}`);
    }
  }
  if (useCase.recipes && useCase.recipes.length > 0) {
    lines.push('');
    lines.push('  Recipes:');
    for (const recipe of useCase.recipes) {
      lines.push(`    docs/recipes/${recipe}`);
    }
  }
  return lines.join('\n');
}

/**
 * Format all use cases grouped by category — for pipe/dump output.
 * Shows commands and recipe count for each use case.
 */
export function formatAllUseCases(grouped: GroupedUseCases): string {
  const lines: string[] = [];
  lines.push('shiori guide — Command Navigator');
  lines.push('');

  for (const group of grouped) {
    lines.push(`${group.categoryLabel}:`);
    for (const uc of group.useCases) {
      const cmds = uc.commands.join(', ');
      const recipeCount =
        uc.recipes && uc.recipes.length > 0
          ? ` (${uc.recipes.length} recipe${uc.recipes.length > 1 ? 's' : ''})`
          : '';
      lines.push(`  ${uc.label}`);
      lines.push(`    \u2192 ${cmds}${recipeCount}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format grouped use cases as JSON — for pipe/scripting.
 */
export function formatUseCasesJson(grouped: GroupedUseCases): string {
  return JSON.stringify(grouped, null, 2);
}

// ── Wizard logic (EP-0100) ──────────────────────────────────

/** Scored use case for wizard ranking */
export interface ScoredUseCase {
  useCase: UseCase;
  score: number;
}

/** Wizard result returned by rankUseCasesByContext */
export interface WizardResult {
  /** Top-N recommended use cases with scores */
  recommendations: ScoredUseCase[];
  /** Project context used for ranking */
  context: GuideContext;
}

/**
 * Evaluate a single ContextCondition against a GuideContext.
 * Returns true if the condition matches.
 */
export function evaluateCondition(
  condition: ContextCondition,
  context: GuideContext,
): boolean {
  const fieldValue = context[condition.field];

  // Field not present in context — condition does not match
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  switch (condition.op) {
    case 'truthy':
      return Boolean(fieldValue);
    case 'falsy':
      return !fieldValue;
    case 'eq':
      return fieldValue === condition.value;
    case 'neq':
      return fieldValue !== condition.value;
    case 'lt':
      return (
        typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue < condition.value
      );
    case 'lte':
      return (
        typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue <= condition.value
      );
    case 'gt':
      return (
        typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue > condition.value
      );
    case 'gte':
      return (
        typeof fieldValue === 'number' &&
        typeof condition.value === 'number' &&
        fieldValue >= condition.value
      );
    default:
      return false;
  }
}

/**
 * Score a single use case against the project context.
 * Returns the sum of boosts from matching conditions (0 if none).
 */
export function scoreUseCase(useCase: UseCase, context: GuideContext): number {
  if (!useCase.contextConditions || useCase.contextConditions.length === 0) {
    return 0;
  }
  let total = 0;
  for (const condition of useCase.contextConditions) {
    if (evaluateCondition(condition, context)) {
      total += condition.boost;
    }
  }
  return total;
}

/**
 * Rank use cases by context relevance and return top N recommendations.
 * Pure function — no IO.
 *
 * Scoring: sum of matching contextCondition boosts.
 * Tie-breaking: preserve USE_CASES insertion order (stable sort).
 */
export function rankUseCasesByContext(
  context: GuideContext,
  topN: number = 3,
): WizardResult {
  const scored: ScoredUseCase[] = USE_CASES.map((uc) => ({
    useCase: uc,
    score: scoreUseCase(uc, context),
  }));

  // Stable sort: higher score first; ties preserve original order
  scored.sort((a, b) => b.score - a.score);

  return {
    recommendations: scored.slice(0, topN),
    context,
  };
}

/**
 * Format wizard recommendations as human-readable text.
 */
export function formatWizardResult(result: WizardResult): string {
  const lines: string[] = [];
  lines.push('shiori guide --wizard — Recommended Actions');
  lines.push('');

  // Context summary
  const ctx = result.context;
  const contextParts: string[] = [];
  if (ctx.maturity !== undefined) {
    contextParts.push(`Maturity: Level ${ctx.maturity}`);
  }
  if (ctx.healthScore !== undefined) {
    contextParts.push(`Health: ${ctx.healthScore}/100`);
  }
  if (ctx.hasExpiredAnnotations) {
    contextParts.push('Expired annotations detected');
  }
  if (ctx.hasExpiringSoonAnnotations) {
    contextParts.push('Expiring-soon annotations detected');
  }
  if (ctx.candidateCount !== undefined && ctx.candidateCount > 0) {
    contextParts.push(`${ctx.candidateCount} untracked candidate(s)`);
  }
  if (ctx.diagnostics && ctx.diagnostics.fail > 0) {
    contextParts.push(`Doctor: ${ctx.diagnostics.fail} issue(s)`);
  }

  if (contextParts.length > 0) {
    lines.push(`Project context: ${contextParts.join(' | ')}`);
    lines.push('');
  }

  // Errors (partial context warnings)
  if (ctx.errors && ctx.errors.length > 0) {
    for (const err of ctx.errors) {
      lines.push(`  ! ${err.stage}: ${err.message}`);
    }
    lines.push('');
  }

  // Recommendations
  for (const [i, rec] of result.recommendations.entries()) {
    lines.push(`${i + 1}. ${rec.useCase.label} (score: ${rec.score})`);
    lines.push(`   ${rec.useCase.explanation}`);
    for (const cmd of rec.useCase.commands) {
      lines.push(`   $ ${cmd}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format wizard result as JSON — for pipe/scripting.
 */
export function formatWizardResultJson(result: WizardResult): string {
  return JSON.stringify(
    {
      context: result.context,
      recommendations: result.recommendations.map((r) => ({
        id: r.useCase.id,
        label: r.useCase.label,
        category: r.useCase.category,
        commands: r.useCase.commands,
        explanation: r.useCase.explanation,
        score: r.score,
      })),
    },
    null,
    2,
  );
}

// ── DoctorResult → GuideContext mapper (Phase 2) ─────────────

/**
 * Input for the two-stage GuideContext mapper.
 * DoctorResult provides diagnostics + maturity; ReportResult provides
 * health, annotations, and candidates. Both are optional for graceful
 * degradation — the mapper produces a partial GuideContext from
 * whatever data is available.
 */
export interface GuideContextInput {
  /** Doctor diagnostic result (stage 1) */
  doctorResult?: DoctorResult;
  /** Report result with health + verify data (stage 2) */
  reportResult?: ReportResult;
}

/**
 * Map DoctorResult + ReportResult → GuideContext.
 *
 * Pure function — no IO. Designed to replace the inline field
 * extraction that was previously embedded in extractGuideContext().
 *
 * Stage 1 (DoctorResult): maturity level + diagnostic check summary.
 * Stage 2 (ReportResult): health score, annotation/candidate counts,
 *   expired/expiring-soon flags.
 */
export function mapDoctorToGuideContext(
  input: GuideContextInput,
): GuideContext {
  const context: GuideContext = {};

  // ── Stage 1: DoctorResult → maturity + diagnostics ──
  if (input.doctorResult) {
    const dr = input.doctorResult;

    // Maturity (only present when doctor ran with --maturity)
    if (dr.maturity) {
      context.maturity = dr.maturity.level;
    }

    // Diagnostics summary
    context.diagnostics = {
      pass: dr.summary.pass,
      warn: dr.summary.warn,
      fail: dr.summary.fail,
    };
    context.hasDoctorFailures = dr.summary.fail > 0;
    context.hasDoctorWarnings = dr.summary.warn > 0;
  }

  // ── Stage 2: ReportResult → health + annotations ──
  if (input.reportResult) {
    const rr = input.reportResult;

    context.healthScore = rr.health.score;
    context.healthLevel = rr.health.level;
    context.annotationCount = rr.totals.annotations;
    context.candidateCount = rr.totals.candidates;

    // Expired/expiring-soon flags from verify byType
    context.hasExpiredAnnotations =
      (rr.verifyResult.summary.byType['expired'] ?? 0) > 0;
    context.hasExpiringSoonAnnotations =
      (rr.verifyResult.summary.byType['expiring-soon'] ?? 0) > 0;
  }

  return context;
}
