/**
 * Maturity-based recipe catalog (EP-0165).
 *
 * Maps governance maturity levels to recommended recipes,
 * enabling users to discover relevant automation at their
 * current adoption stage.
 *
 * Pure module — no IO, no process access.
 */

import type { MaturityLevel } from '../core/types.ts';
import { MATURITY_LEVEL_LABELS } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';

// ── Recipe metadata ──────────────────────────────────────────

/**
 * A recipe entry in the catalog.
 */
export interface RecipeEntry {
  /** Recipe filename (relative to docs/recipes/) */
  filename: string;
  /** Human-readable title */
  title: string;
  /** One-line description */
  description: string;
  /** Category for grouping */
  category: RecipeCategory;
  /** Minimum maturity level to benefit from this recipe */
  minLevel: MaturityLevel;
  /** Maximum maturity level where this recipe is still relevant */
  maxLevel: MaturityLevel;
}

export type RecipeCategory =
  'ci' | 'notification' | 'reporting' | 'automation' | 'editor' | 'monitoring';

const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  ci: 'CI / PR Integration',
  notification: 'Notification',
  reporting: 'Reporting & Dashboards',
  automation: 'Automation',
  editor: 'Editor Integration',
  monitoring: 'Monitoring',
};

/**
 * Complete recipe catalog with maturity level mapping.
 * Each recipe is annotated with the maturity range where it is applicable.
 */
export const RECIPE_CATALOG: readonly RecipeEntry[] = [
  // ── CI / PR Integration ──
  {
    filename: 'github-actions-composite-action.md',
    title: 'GitHub Actions Composite Action',
    description: 'Reusable composite action for shiori CI integration',
    category: 'ci',
    minLevel: 1,
    maxLevel: 4,
  },
  {
    filename: 'github-checks-gate.md',
    title: 'GitHub Checks Gate',
    description: 'PR status check that blocks on governance violations',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'github-actions-delta-pr-comment.md',
    title: 'Delta PR Comment',
    description: 'Post annotation diff as a PR comment',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'github-actions-delta-pr-description.md',
    title: 'Delta PR Description',
    description: 'Embed annotation diff in PR description',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'github-actions-step-summary.md',
    title: 'GitHub Actions Step Summary',
    description: 'Add governance summary to Actions step output',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'github-actions-governance-summary.md',
    title: 'Governance Summary in CI',
    description: 'Post governance summary in CI pipeline',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'code-scanning.md',
    title: 'Code Scanning (SARIF)',
    description: 'Export annotations as SARIF for GitHub Code Scanning',
    category: 'ci',
    minLevel: 2,
    maxLevel: 4,
  },

  // ── Notification ──
  {
    filename: 'slack-notification.md',
    title: 'Slack Notification',
    description: 'Simple text alerts for expiring annotations',
    category: 'notification',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'slack-pulse.md',
    title: 'Slack Governance Pulse',
    description: 'Weekly Block Kit dashboard to Slack',
    category: 'notification',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'health-milestone-notification.md',
    title: 'Health Milestone Notification',
    description: 'Positive feedback when health score reaches a threshold',
    category: 'notification',
    minLevel: 2,
    maxLevel: 4,
  },

  // ── Reporting & Dashboards ──
  {
    filename: 'governance-badge.md',
    title: 'Governance Badge',
    description: 'README badge showing governance score',
    category: 'reporting',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'html-artifacts-dashboard.md',
    title: 'HTML Artifacts Dashboard',
    description: 'Generate HTML governance dashboard as CI artifact',
    category: 'reporting',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'aggregate-html-dashboard.md',
    title: 'Aggregate HTML Dashboard',
    description: 'Multi-repo HTML dashboard with aggregated metrics',
    category: 'reporting',
    minLevel: 4,
    maxLevel: 4,
  },
  {
    filename: 'local-dashboard.md',
    title: 'Local Dashboard',
    description: 'Browser-based local governance dashboard',
    category: 'reporting',
    minLevel: 1,
    maxLevel: 4,
  },
  {
    filename: 'governance-observatory.md',
    title: 'Governance Observatory',
    description: 'Advanced multi-dimensional governance analytics',
    category: 'reporting',
    minLevel: 4,
    maxLevel: 4,
  },

  // ── Automation ──
  {
    filename: 'github-actions-expires-alert.md',
    title: 'Expires Alert',
    description: 'Create GitHub Issues for expiring annotations',
    category: 'automation',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'github-issue-creation.md',
    title: 'Issue Creation',
    description: 'Script-based GitHub Issue creation from violations',
    category: 'automation',
    minLevel: 2,
    maxLevel: 4,
  },
  {
    filename: 'scheduled-governance-orchestrator.md',
    title: 'Scheduled Governance Orchestrator',
    description: 'Cron-based orchestration with auto-issue, dedup, and Slack',
    category: 'automation',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'auto-resolve-on-issue-close.md',
    title: 'Auto-Resolve on Issue Close',
    description: 'Webhook-driven automatic annotation resolution',
    category: 'automation',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'renovate-triage.md',
    title: 'Renovate Triage',
    description: 'Triage dependency-related annotations with Renovate',
    category: 'automation',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'alert-to-ref.md',
    title: 'Alert to Ref',
    description: 'Convert CI alerts into tracked shiori refs',
    category: 'automation',
    minLevel: 2,
    maxLevel: 4,
  },

  // ── Editor Integration ──
  {
    filename: 'vscode-tasks.json.example',
    title: 'VS Code Tasks',
    description: 'VS Code task definitions for shiori commands',
    category: 'editor',
    minLevel: 1,
    maxLevel: 4,
  },
  {
    filename: 'vscode-annotate-task.md',
    title: 'VS Code Annotate Task',
    description: 'Quick annotation insertion from VS Code',
    category: 'editor',
    minLevel: 1,
    maxLevel: 4,
  },
  {
    filename: 'neovim-diagnostic.md',
    title: 'Neovim Diagnostics',
    description: 'Neovim diagnostic integration for shiori annotations',
    category: 'editor',
    minLevel: 1,
    maxLevel: 4,
  },
  {
    filename: 'jetbrains-diagnostic.md',
    title: 'JetBrains Diagnostics',
    description: 'JetBrains IDE integration for shiori annotations',
    category: 'editor',
    minLevel: 1,
    maxLevel: 4,
  },

  // ── Monitoring ──
  {
    filename: 'governance-coach.md',
    title: 'Governance Coach',
    description: 'LLM-powered coaching using governance data',
    category: 'monitoring',
    minLevel: 3,
    maxLevel: 4,
  },
  {
    filename: 'governance-coach-broadcast.md',
    title: 'Coach Broadcast',
    description: 'Auto-post coaching prompts to Slack or GitHub Discussions',
    category: 'monitoring',
    minLevel: 4,
    maxLevel: 4,
  },
  {
    filename: 'pr-onboarding-snippet.md',
    title: 'PR Onboarding Snippet',
    description: 'Onboarding checklist snippet for PR descriptions',
    category: 'monitoring',
    minLevel: 1,
    maxLevel: 4,
  },
] as const;

// ── Recipe filtering & recommendation ────────────────────────

/**
 * Recommended recipe result for a given maturity level.
 */
export interface RecipeRecommendation {
  /** Current maturity level */
  level: MaturityLevel;
  /** Human-readable label for the level */
  levelLabel: string;
  /** Recipes recommended for the current level */
  current: RecipeEntry[];
  /** Recipes that become available at the next level */
  next: RecipeEntry[];
}

/**
 * Filter recipes applicable to a given maturity level.
 */
export function filterRecipesByLevel(level: MaturityLevel): RecipeEntry[] {
  return RECIPE_CATALOG.filter(
    (r) => r.minLevel <= level && r.maxLevel >= level,
  );
}

/**
 * Get recipes that become newly available at a given level
 * (i.e., their minLevel equals the specified level).
 */
export function newRecipesAtLevel(level: MaturityLevel): RecipeEntry[] {
  return RECIPE_CATALOG.filter((r) => r.minLevel === level);
}

/**
 * Compute recipe recommendations for a maturity level.
 */
export function recommendRecipes(level: MaturityLevel): RecipeRecommendation {
  const current = filterRecipesByLevel(level);
  const nextLevel = Math.min(level + 1, 4) as MaturityLevel;
  const next = level < 4 ? newRecipesAtLevel(nextLevel) : [];

  return {
    level,
    levelLabel: MATURITY_LEVEL_LABELS[level],
    current,
    next,
  };
}

// ── Formatters ───────────────────────────────────────────────

/** Group recipes by category for display. */
export interface GroupedRecipes {
  category: RecipeCategory;
  categoryLabel: string;
  recipes: RecipeEntry[];
}

function groupByCategory(recipes: RecipeEntry[]): GroupedRecipes[] {
  const categoryOrder: RecipeCategory[] = [
    'ci',
    'notification',
    'reporting',
    'automation',
    'editor',
    'monitoring',
  ];

  return categoryOrder
    .map((cat) => ({
      category: cat,
      categoryLabel: CATEGORY_LABELS[cat],
      recipes: recipes.filter((r) => r.category === cat),
    }))
    .filter((g) => g.recipes.length > 0);
}

/**
 * Format recipe recommendation as human-readable text.
 */
export function formatRecipeRecommendation(rec: RecipeRecommendation): string {
  const lines: string[] = [];
  lines.push(`shiori recipes — Level ${rec.level}: ${rec.levelLabel}`);
  lines.push('');

  if (rec.current.length === 0) {
    lines.push(
      '  No recipes available at this level. Run "shiori init" to get started.',
    );
    lines.push('');
  } else {
    const grouped = groupByCategory(rec.current);
    for (const group of grouped) {
      lines.push(`${group.categoryLabel}:`);
      for (const r of group.recipes) {
        lines.push(`  ${r.title}`);
        lines.push(`    ${r.description}`);
        lines.push(`    → docs/recipes/${r.filename}`);
      }
      lines.push('');
    }
  }

  if (rec.next.length > 0) {
    const nextLevel = Math.min(rec.level + 1, 4) as MaturityLevel;
    lines.push(
      `Unlock at Level ${nextLevel} (${MATURITY_LEVEL_LABELS[nextLevel]}):`,
    );
    for (const r of rec.next) {
      lines.push(`  ${r.title} — ${r.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format full catalog as human-readable text (all levels).
 */
export function formatFullCatalog(): string {
  const lines: string[] = [];
  lines.push('shiori recipes — Full Catalog');
  lines.push('');

  for (let lvl = 0; lvl <= 4; lvl++) {
    const level = lvl as MaturityLevel;
    const newRecipes = newRecipesAtLevel(level);
    if (newRecipes.length > 0) {
      lines.push(`Level ${level}: ${MATURITY_LEVEL_LABELS[level]}`);
      for (const r of newRecipes) {
        lines.push(`  ${r.title} — ${r.description}`);
        lines.push(`    → docs/recipes/${r.filename}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format recipe recommendation as JSON with ADR 028 envelope.
 */
export function formatRecipeRecommendationJson(
  rec: RecipeRecommendation,
): string {
  return wrapOutputJson(rec, { command: 'recipes', schemaVersion: 1 });
}
