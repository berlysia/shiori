/**
 * Interactive command navigator for shiori CLI.
 *
 * Maps user goals ("use cases") to recommended commands with
 * contextual help. Designed to reduce the 23-command discovery gap.
 *
 * Pure module — no IO, no process access.
 */

// ── Use-case mapping data ─────────────────────────────────────

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
  },
  {
    id: 'adopt-existing',
    label: 'Track existing lint disable comments',
    category: 'setup',
    commands: ['shiori adopt'],
    explanation:
      'Converts untracked lint disable comments into tracked shiori annotations.',
  },
  {
    id: 'ci-setup',
    label: 'Add governance checks to CI',
    category: 'setup',
    commands: ['shiori init --ci basic'],
    explanation: 'Generates a GitHub Actions workflow for shiori verify.',
    recipes: ['github-actions-composite-action.md', 'github-checks-gate.md'],
  },

  // ── Daily ──
  {
    id: 'quick-check',
    label: 'Verify all annotations are valid',
    category: 'daily',
    commands: ['shiori check'],
    explanation: 'One-shot scan + verify — the primary command for daily use.',
    options: ['--fail-on <types>', '--format json'],
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
  },
  {
    id: 'triage-actions',
    label: 'Prioritized action list by ref',
    category: 'governance',
    commands: ['shiori triage'],
    explanation:
      'Ranks annotations by urgency — expired first, then expiring soon.',
    recipes: ['renovate-triage.md'],
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
  },
  {
    id: 'maturity-check',
    label: 'Assess governance maturity level',
    category: 'diagnostics',
    commands: ['shiori doctor --maturity'],
    explanation:
      'Evaluates your project on a 0-4 maturity scale (Discover → Enforce).',
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
