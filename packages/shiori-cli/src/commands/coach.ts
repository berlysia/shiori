/**
 * Coach command: Generate structured LLM prompts from governance data.
 *
 * Combines triage, weekly-report, and health JSON outputs into
 * copy-pasteable prompts for LLM-driven governance coaching.
 * No LLM API calls — ADR 018 compliant.
 *
 * @see docs/recipes/governance-coach.md for background
 * @see EP-0139
 */

import { assertNever } from '../core/types.ts';

// ── Types ────────────────────────────────────────────────────

export type CoachTemplate =
  | 'triage'
  | 'weekly'
  | 'health'
  | 'combined'
  | 'custom';
export type CoachFormat = 'prompt' | 'json' | 'github-issue';

export const COACH_TEMPLATES = [
  'triage',
  'weekly',
  'health',
  'combined',
] as const satisfies readonly CoachTemplate[];

export const COACH_FORMATS = [
  'prompt',
  'json',
  'github-issue',
] as const satisfies readonly CoachFormat[];

export interface CoachInput {
  triageJson?: string;
  weeklyReportJson?: string;
  healthJson?: string;
  narrativeJson?: string;
}

export interface CoachResult {
  template: CoachTemplate;
  prompt: string;
  /** JSON outputs embedded in the prompt, for machine consumption */
  sources: {
    triage?: string;
    weeklyReport?: string;
    health?: string;
    narrative?: string;
  };
}

// ── Placeholder Constants ────────────────────────────────────

/** Template placeholder tokens for coach prompt generation. */
export const COACH_PLACEHOLDERS = {
  TRIAGE: '{{TRIAGE_JSON}}',
  WEEKLY_REPORT: '{{WEEKLY_REPORT_JSON}}',
  HEALTH: '{{HEALTH_JSON}}',
  NARRATIVE: '{{NARRATIVE}}',
} as const;

// ── Prompt Templates ─────────────────────────────────────────

const TRIAGE_PROMPT = `あなたはソフトウェアガバナンスの専門家です。
以下は shiori（アノテーション追跡ツール）の triage レポート JSON です。

\`\`\`json
{{TRIAGE_JSON}}
\`\`\`

この triage 結果を分析し、以下の形式でガバナンス改善提案を作成してください:

## 分析

- 現在のガバナンス状況を 2-3 文で要約
- critical/high の Issue がある場合、その根本原因を推測

## 今週のアクションプラン

優先度順に 3 件以内のアクションを提案してください:

1. **[優先度]** アクション内容 — 理由と期待効果
   - 実行コマンド: \`shiori ...\`

## 構造的な改善提案

繰り返し発生しているパターンがあれば、プロセスやルールの改善を提案してください。`;

const WEEKLY_PROMPT = `あなたはソフトウェアチームのガバナンスコーチです。
以下は shiori の週次ガバナンスレポート JSON です。

\`\`\`json
{{WEEKLY_REPORT_JSON}}
\`\`\`

このレポートを分析し、チームミーティングで共有できる形式のフィードバックを作成してください:

## 今週のハイライト

- ヘルススコアの変動と要因を 1-2 文で説明
- 良い傾向があれば具体的に称賛

## 注意ポイント

- スコアが下がった原因や、増加しているアノテーションのパターン
- 期限切れ（expired）や期限間近（expiring-soon）への対応状況

## 来週に向けて

- 具体的な改善アクションを 1-2 件提案
- 各アクションに対応する shiori コマンドを添える`;

const HEALTH_PROMPT = `あなたはコードベースの健全性を診断する専門家です。
以下は shiori の health チェック結果です。

\`\`\`json
{{HEALTH_JSON}}
\`\`\`

診断結果を以下の形式で出力してください:

## 診断サマリー

スコアに対する所見を 2-3 文で述べてください。

## 処方箋

改善効果の高い順に 3 件以内:

| 優先度 | 処方 | 期待スコア改善 | コマンド |
| ------ | ---- | -------------- | -------- |
| ...    | ...  | ...            | ...      |

## 予後

現在のペースで改善を続けた場合の 1 ヶ月後のスコア予測と根拠。`;

const COMBINED_PROMPT = `あなたはソフトウェアガバナンスの専門家です。
以下は shiori（アノテーション追跡ツール）の複数のレポートです。

## Triage レポート
\`\`\`json
{{TRIAGE_JSON}}
\`\`\`

## 週次レポート
\`\`\`json
{{WEEKLY_REPORT_JSON}}
\`\`\`

## ガバナンス変動ナラティブ
\`\`\`json
{{NARRATIVE}}
\`\`\`

これらのレポートを総合的に分析し、以下を出力してください:
1. 現状の要約（2-3文、ナラティブの変動傾向を加味）
2. 今週の最優先アクション（1件、shiori コマンド付き）
3. 中期的な改善提案（1件）`;

// ── Core Logic ───────────────────────────────────────────────

/** Get a built-in prompt template. Only valid for built-in templates (not "custom"). */
function getTemplate(template: Exclude<CoachTemplate, 'custom'>): string {
  switch (template) {
    case 'triage':
      return TRIAGE_PROMPT;
    case 'weekly':
      return WEEKLY_PROMPT;
    case 'health':
      return HEALTH_PROMPT;
    case 'combined':
      return COMBINED_PROMPT;
    default:
      return assertNever(template);
  }
}

/** Replace placeholder tokens in a template string with governance JSON data. */
function replacePlaceholders(
  templateStr: string,
  input: CoachInput,
): { prompt: string; sources: CoachResult['sources'] } {
  let prompt = templateStr;
  const sources: CoachResult['sources'] = {};

  if (input.triageJson != null) {
    prompt = prompt.replaceAll(COACH_PLACEHOLDERS.TRIAGE, input.triageJson);
    sources.triage = input.triageJson;
  }
  if (input.weeklyReportJson != null) {
    prompt = prompt.replaceAll(
      COACH_PLACEHOLDERS.WEEKLY_REPORT,
      input.weeklyReportJson,
    );
    sources.weeklyReport = input.weeklyReportJson;
  }
  if (input.healthJson != null) {
    prompt = prompt.replaceAll(COACH_PLACEHOLDERS.HEALTH, input.healthJson);
    sources.health = input.healthJson;
  }
  if (input.narrativeJson != null) {
    prompt = prompt.replaceAll(
      COACH_PLACEHOLDERS.NARRATIVE,
      input.narrativeJson,
    );
    sources.narrative = input.narrativeJson;
  }

  return { prompt, sources };
}

/**
 * Build a structured LLM prompt from governance data.
 * Pure function — no I/O, no LLM calls.
 */
export function buildCoachPrompt(
  template: Exclude<CoachTemplate, 'custom'>,
  input: CoachInput,
): CoachResult {
  const { prompt, sources } = replacePlaceholders(getTemplate(template), input);
  return { template, prompt, sources };
}

/**
 * Build a prompt from a user-supplied template string.
 */
export function buildCoachPromptFromCustomTemplate(
  templateContent: string,
  input: CoachInput,
): CoachResult {
  const { prompt, sources } = replacePlaceholders(templateContent, input);
  return { template: 'custom', prompt, sources };
}

// ── Formatters ───────────────────────────────────────────────

/**
 * Format CoachResult for output.
 */
export function formatCoachOutput(
  result: CoachResult,
  format: CoachFormat,
): string {
  switch (format) {
    case 'prompt':
      return result.prompt;
    case 'json':
      return JSON.stringify(result, null, 2);
    case 'github-issue':
      return formatAsGitHubIssue(result);
    default:
      return assertNever(format);
  }
}

function formatAsGitHubIssue(result: CoachResult): string {
  const lines: string[] = [];

  lines.push('## 🧑‍🏫 Governance Coach Prompt');
  lines.push('');
  lines.push(
    '> Copy the prompt below and paste it into your preferred LLM for governance coaching advice.',
  );
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Prompt (click to expand)</summary>');
  lines.push('');
  lines.push(result.prompt);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push(
    `Template: \`${result.template}\` | Generated by: \`shiori coach\``,
  );

  return lines.join('\n');
}
