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

import { assertNever, type HealthMaturityStage } from '../core/types.ts';
import type { CoachDiffContext, StageTransition } from '../core/types.ts';
import { isStageAdvancement, formatSigned } from '../core/coach-diff.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';

// ── Types ────────────────────────────────────────────────────

export type CoachTemplate =
  | 'triage'
  | 'weekly'
  | 'health'
  | 'combined'
  | 'custom';
export type CoachFormat =
  | 'prompt'
  | 'json'
  | 'github-issue'
  | 'slack-markdown'
  | 'github-discussion';

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
  'slack-markdown',
  'github-discussion',
] as const satisfies readonly CoachFormat[];

export interface CoachInput {
  triageJson?: string;
  weeklyReportJson?: string;
  healthJson?: string;
  narrativeJson?: string;
  /** Governance maturity stage for stage-aware coaching (EP-0205) */
  maturityStage?: HealthMaturityStage;
  /** Sprint diff context for remediation journey visualization (EP-0207) */
  diffContext?: CoachDiffContext;
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
  /** Stage transition data for structured output (EP-0211) */
  stageTransition?: StageTransition & { advanced: boolean };
}

// ── Placeholder Constants ────────────────────────────────────

/** Template placeholder tokens for coach prompt generation. */
export const COACH_PLACEHOLDERS = {
  TRIAGE: '{{TRIAGE_JSON}}',
  WEEKLY_REPORT: '{{WEEKLY_REPORT_JSON}}',
  HEALTH: '{{HEALTH_JSON}}',
  NARRATIVE: '{{NARRATIVE}}',
  /** Maturity stage name: Foundation / Tracking / Maintained / Autonomous (EP-0205) */
  MATURITY_STAGE: '{{MATURITY_STAGE}}',
  /** Stage-specific coaching guidance block (EP-0205) */
  MATURITY_GUIDANCE: '{{MATURITY_GUIDANCE}}',
  /** One-line diff summary (EP-0207) */
  DIFF_SUMMARY: '{{DIFF_SUMMARY}}',
  /** Conditional diff details block (EP-0207) */
  DIFF_BLOCK: '{{DIFF_BLOCK}}',
  /** Conditional stage transition celebration (EP-0207) */
  STAGE_TRANSITION: '{{STAGE_TRANSITION}}',
} as const;

// ── Maturity-Aware Guidance (EP-0205) ────────────────────────

/**
 * Stage-specific coaching guidance content.
 *
 * Each stage provides contextual direction that prevents the LLM from
 * generating off-target advice (e.g. suggesting CI automation to a
 * Foundation-stage project that hasn't started tracking yet).
 */
export const MATURITY_GUIDANCE_MAP: Record<HealthMaturityStage, string> = {
  Foundation: `## 成熟度ステージ: Foundation（基盤構築フェーズ）

このプロジェクトはガバナンスの初期段階にあります。追跡率（coverage）と衛生度（hygiene）の両方が低い状態です。

### コーチング方針
- **adopt / scan を最優先**: まずは未追跡の lint disable コメントを発見し、shiori アノテーションに変換することに集中してください
- **レジストリの初期セットアップ**: \`shiori init\` → \`shiori adopt\` → \`shiori update\` の基本フローを案内してください
- **追跡率の改善に注力**: 個別の hygiene 問題（expires 未設定など）よりも、まず追跡率を上げることが優先です

### 避けるべきアドバイス
- 週次レポートやトレンド分析の導入（データ蓄積が不十分）
- CI/CD 統合や自動化の提案（基盤が整っていない段階では時期尚早）
- 高度な triage ワークフローの提案`,

  Tracking: `## 成熟度ステージ: Tracking（追跡進行フェーズ）

このプロジェクトはガバナンスの一部が機能していますが、coverage と hygiene のバランスが取れていません。

### コーチング方針
- **弱い軸の改善に集中**: coverage が低ければ adopt を、hygiene が低ければ expires/kind の整備を優先してください
- **triage 習慣の形成**: 定期的な \`shiori triage\` 実行を習慣化する提案をしてください
- **kind 分類の導入**: temporary/intentional の使い分けを案内してください

### 避けるべきアドバイス
- ゼロ Issue 達成や完全自動化の提案（まだ早い段階）
- 高度な自動化（CI パイプライン統合など）の詳細な設定手順`,

  Maintained: `## 成熟度ステージ: Maintained（安定運用フェーズ）

このプロジェクトは coverage・hygiene 共に高水準ですが、まだ改善の余地がある処方箋（prescriptions）が残っています。

### コーチング方針
- **残りの prescriptions の消化**: health レポート内の prescriptions を優先度順に対処する具体的プランを提案してください
- **週次レポートの活用**: \`shiori weekly-report\` を定期運用に組み込み、チーム共有する提案をしてください
- **トレンド監視の導入**: \`shiori trend\` でスコア推移を可視化し、退行を早期検知する仕組みを提案してください

### 避けるべきアドバイス
- 基本的な adopt/scan の説明（すでに十分追跡されている）
- 初歩的な shiori CLI の使い方の案内`,

  Autonomous: `## 成熟度ステージ: Autonomous（自律運用フェーズ）

このプロジェクトは coverage・hygiene 共に高く、未解決の prescriptions もありません。自律的にガバナンスが維持されている優秀な状態です。

### コーチング方針
- **維持・監視の自動化**: CI/CD への shiori verify 統合や、GitHub Actions での定期 health チェックを提案してください
- **組織展開**: 他プロジェクトへのガバナンス手法の横展開を検討する提案をしてください
- **退行防止**: \`shiori delta\` をPRレビューに組み込み、スコア退行を防ぐ仕組みを提案してください

### 避けるべきアドバイス
- 手動ワークフローの詳細な説明（自動化すべき段階）
- 基本的な CLI 操作のステップバイステップ案内`,
};

/**
 * Generate the maturity stage name for placeholder replacement.
 * Returns empty string when stage is unknown (backward compatibility).
 */
export function resolveMaturityStageName(
  stage: HealthMaturityStage | undefined,
): string {
  return stage ?? '';
}

/**
 * Generate stage-specific guidance content for placeholder replacement.
 * Returns empty string when stage is unknown (backward compatibility).
 */
export function resolveMaturityGuidance(
  stage: HealthMaturityStage | undefined,
): string {
  if (stage == null) return '';
  return MATURITY_GUIDANCE_MAP[stage];
}

// ── Diff Block Generation (EP-0207) ──────────────────────────

/**
 * Generate the diff details block for template injection.
 * Returns empty string when no diff data is available.
 */
export function resolveDiffBlock(
  diffContext: CoachDiffContext | undefined,
): string {
  if (diffContext?.deltas == null || diffContext.previous == null) return '';

  const d = diffContext.deltas;
  return `## 📊 前回からの変化

| 指標 | 前回 | 今回 | 変化 |
| ---- | ---- | ---- | ---- |
| 健康スコア | ${diffContext.previous.healthScore} | ${diffContext.current.healthScore} | ${formatSigned(d.healthScore)} |
| カバレッジ | ${diffContext.previous.coverage} | ${diffContext.current.coverage} | ${formatSigned(d.coverage)} |
| 衛生度 | ${diffContext.previous.hygiene} | ${diffContext.current.hygiene} | ${formatSigned(d.hygiene)} |
| 期限切れ | ${diffContext.previous.expiredRefs} | ${diffContext.current.expiredRefs} | ${formatSigned(d.expiredRefs)} |

この変化を踏まえて、改善のモメンタムを維持するためのアドバイスを含めてください。`;
}

// ── Stage Transition Celebration (EP-0211) ────────────────────

/**
 * Stage-specific celebration messages for advancement.
 * Each message acknowledges the concrete achievement and its significance.
 */
export const STAGE_CELEBRATION_MAP: Record<HealthMaturityStage, string> = {
  Foundation:
    'プロジェクトはまだ Foundation ステージです。最初のステップとして追跡を始めましょう。',
  Tracking:
    'アノテーションの追跡が始まりました！ガバナンスの第一歩を踏み出した重要なマイルストーンです。ここから可視化と改善のサイクルが回り始めます。',
  Maintained:
    'カバレッジと衛生度の両方が高水準に到達しました！チームの継続的な取り組みが安定した運用体制として結実しています。',
  Autonomous:
    'すべての指標が高水準で、未解決の処方箋もゼロ。ガバナンスが自律的に維持される理想的な状態に到達しました！',
};

/**
 * Next-stage roadmap: what to achieve to reach the next stage.
 * Autonomous has no "next" — instead provides maintenance guidance.
 */
export const NEXT_STAGE_ROADMAP: Record<HealthMaturityStage, string> = {
  Foundation: `### 🗺️ 次のステージ（Tracking）への道筋

- **到達条件**: カバレッジまたは衛生度のいずれかを 70 以上にする
- **推奨アクション**:
  1. \`shiori adopt\` で未追跡の lint disable コメントを発見
  2. \`shiori update\` でレジストリに登録
  3. \`shiori health\` で進捗を確認`,

  Tracking: `### 🗺️ 次のステージ（Maintained）への道筋

- **到達条件**: カバレッジと衛生度の両方を 70 以上にする
- **推奨アクション**:
  1. \`shiori triage\` で弱い軸の課題を特定
  2. \`shiori doctor\` でメタデータ不備を修正
  3. \`shiori health\` で両軸のバランスを確認`,

  Maintained: `### 🗺️ 次のステージ（Autonomous）への道筋

- **到達条件**: すべての処方箋（prescriptions）を解消する
- **推奨アクション**:
  1. \`shiori health\` で残りの処方箋を確認
  2. 優先度順に処方箋を消化
  3. \`shiori check --fail-on expired,missing-in-registry\` を CI に組み込む`,

  Autonomous: `### 🛡️ Autonomous ステージの維持

- **維持のポイント**: 退行を防ぎ、自律運用を継続する
- **推奨アクション**:
  1. \`shiori delta\` を PR レビューに組み込み退行を検知
  2. \`shiori trend\` でスコア推移を定期モニタリング
  3. 他プロジェクトへのガバナンス手法の横展開を検討`,
};

/**
 * Generate the stage transition celebration block for template injection.
 * Returns empty string when no stage transition occurred.
 *
 * Advancement: stage-specific celebration + next-stage roadmap (EP-0211).
 * Regression: warning with analysis guidance.
 */
export function resolveStageTransition(
  diffContext: CoachDiffContext | undefined,
): string {
  if (diffContext?.stageTransition == null) return '';

  const { from, to } = diffContext.stageTransition;
  const advanced = isStageAdvancement(diffContext.stageTransition);

  if (advanced) {
    const celebration = STAGE_CELEBRATION_MAP[to];
    const roadmap = NEXT_STAGE_ROADMAP[to];

    return `## 🎉 ステージ昇格おめでとうございます！

**${from}** → **${to}** へステージが昇格しました！

${celebration}

この成果をチームで共有し、次のステージに向けたモチベーションにしてください。

${roadmap}`;
  }

  return `## ⚠️ ステージ変化の検出

**${from}** → **${to}** へステージが変化しました。

この変化の原因を分析し、改善アクションを提案してください。`;
}

/**
 * Extract structured stage transition data for JSON output (EP-0211).
 * Returns undefined when no stage transition occurred.
 */
function extractStageTransitionData(
  diffContext: CoachDiffContext | undefined,
): CoachResult['stageTransition'] {
  if (diffContext?.stageTransition == null) return undefined;
  return {
    ...diffContext.stageTransition,
    advanced: isStageAdvancement(diffContext.stageTransition),
  };
}

// ── Prompt Templates ─────────────────────────────────────────

const TRIAGE_PROMPT = `あなたはソフトウェアガバナンスの専門家です。
以下は shiori（アノテーション追跡ツール）の triage レポート JSON です。

進捗サマリー: {{DIFF_SUMMARY}}
現在の成熟度ステージ: {{MATURITY_STAGE}}

\`\`\`json
{{TRIAGE_JSON}}
\`\`\`

{{MATURITY_GUIDANCE}}

{{STAGE_TRANSITION}}

{{DIFF_BLOCK}}

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

進捗サマリー: {{DIFF_SUMMARY}}
現在の成熟度ステージ: {{MATURITY_STAGE}}

\`\`\`json
{{WEEKLY_REPORT_JSON}}
\`\`\`

{{MATURITY_GUIDANCE}}

{{STAGE_TRANSITION}}

{{DIFF_BLOCK}}

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

進捗サマリー: {{DIFF_SUMMARY}}
現在の成熟度ステージ: {{MATURITY_STAGE}}

\`\`\`json
{{HEALTH_JSON}}
\`\`\`

{{MATURITY_GUIDANCE}}

{{STAGE_TRANSITION}}

{{DIFF_BLOCK}}

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

進捗サマリー: {{DIFF_SUMMARY}}
現在の成熟度ステージ: {{MATURITY_STAGE}}

## Triage レポート
\`\`\`json
{{TRIAGE_JSON}}
\`\`\`

## 週次レポート
\`\`\`json
{{WEEKLY_REPORT_JSON}}
\`\`\`

## Health レポート
\`\`\`json
{{HEALTH_JSON}}
\`\`\`

## ガバナンス変動ナラティブ
\`\`\`json
{{NARRATIVE}}
\`\`\`

{{MATURITY_GUIDANCE}}

{{STAGE_TRANSITION}}

{{DIFF_BLOCK}}

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
): {
  prompt: string;
  sources: CoachResult['sources'];
  stageTransition: CoachResult['stageTransition'];
} {
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

  // Maturity-aware placeholders (EP-0205): always replace to avoid
  // leaving raw {{MATURITY_*}} tokens in the output prompt.
  prompt = prompt.replaceAll(
    COACH_PLACEHOLDERS.MATURITY_STAGE,
    resolveMaturityStageName(input.maturityStage),
  );
  prompt = prompt.replaceAll(
    COACH_PLACEHOLDERS.MATURITY_GUIDANCE,
    resolveMaturityGuidance(input.maturityStage),
  );

  // Diff-aware placeholders (EP-0207): always replace to avoid
  // leaving raw {{DIFF_*}} tokens in the output prompt.
  prompt = prompt.replaceAll(
    COACH_PLACEHOLDERS.DIFF_SUMMARY,
    input.diffContext?.diffSummaryOneLiner ?? '',
  );
  prompt = prompt.replaceAll(
    COACH_PLACEHOLDERS.DIFF_BLOCK,
    resolveDiffBlock(input.diffContext),
  );
  prompt = prompt.replaceAll(
    COACH_PLACEHOLDERS.STAGE_TRANSITION,
    resolveStageTransition(input.diffContext),
  );

  // Extract stage transition data for structured JSON output (EP-0211)
  const stageTransition = extractStageTransitionData(input.diffContext);

  return { prompt, sources, stageTransition };
}

/**
 * Build a structured LLM prompt from governance data.
 * Pure function — no I/O, no LLM calls.
 */
export function buildCoachPrompt(
  template: Exclude<CoachTemplate, 'custom'>,
  input: CoachInput,
): CoachResult {
  const { prompt, sources, stageTransition } = replacePlaceholders(
    getTemplate(template),
    input,
  );
  return { template, prompt, sources, stageTransition };
}

/**
 * Build a prompt from a user-supplied template string.
 */
export function buildCoachPromptFromCustomTemplate(
  templateContent: string,
  input: CoachInput,
): CoachResult {
  const { prompt, sources, stageTransition } = replacePlaceholders(
    templateContent,
    input,
  );
  return { template: 'custom', prompt, sources, stageTransition };
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
      return wrapOutputJson(result, { command: 'coach', schemaVersion: 1 });
    case 'github-issue':
      return formatAsGitHubIssue(result);
    case 'slack-markdown':
      return formatAsSlackMarkdown(result);
    case 'github-discussion':
      return formatAsGitHubDiscussion(result);
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

/**
 * Format CoachResult as Slack-compatible Markdown (EP-0212).
 *
 * Uses Slack mrkdwn conventions: *bold*, `code`, block quotes with >.
 * Designed for pasting into Slack channels or webhook payloads as plain text.
 */
function formatAsSlackMarkdown(result: CoachResult): string {
  const lines: string[] = [];

  lines.push(':teacher: *Governance Coach Prompt*');
  lines.push('');
  lines.push(
    `> Template: \`${result.template}\` | Generated by: \`shiori coach\``,
  );

  if (result.stageTransition != null) {
    const { from, to, advanced } = result.stageTransition;
    if (advanced) {
      lines.push('');
      lines.push(`:tada: *Stage Up: ${from} → ${to}*`);
    } else {
      lines.push('');
      lines.push(`:warning: *Stage Change: ${from} → ${to}*`);
    }
  }

  lines.push('');
  lines.push('```');
  lines.push(result.prompt);
  lines.push('```');

  return lines.join('\n');
}

/**
 * Format CoachResult as GitHub Discussion Markdown (EP-0212).
 *
 * Structured for GitHub Discussions with a discussion-friendly layout:
 * categorized header, expandable prompt, and metadata footer.
 */
function formatAsGitHubDiscussion(result: CoachResult): string {
  const lines: string[] = [];

  lines.push('## 🧑‍🏫 Governance Coach — Discussion');
  lines.push('');
  lines.push(
    'Share this governance coaching prompt with your team. Paste the prompt into your preferred LLM and discuss the recommendations together.',
  );

  if (result.stageTransition != null) {
    const { from, to, advanced } = result.stageTransition;
    if (advanced) {
      lines.push('');
      lines.push(`### 🎉 Stage Advancement: ${from} → ${to}`);
      lines.push('');
      lines.push(
        'Congratulations! The team has reached a new governance maturity stage. Review the coaching prompt below for next steps.',
      );
    } else {
      lines.push('');
      lines.push(`### ⚠️ Stage Change: ${from} → ${to}`);
      lines.push('');
      lines.push(
        'A stage transition was detected. Review the coaching prompt below to identify improvement actions.',
      );
    }
  }

  lines.push('');
  lines.push('<details>');
  lines.push('<summary>📋 Coaching Prompt (click to expand)</summary>');
  lines.push('');
  lines.push(result.prompt);
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    `📌 Template: \`${result.template}\` | Generated by: \`shiori coach\``,
  );
  lines.push('');
  lines.push(
    '💬 *How to use*: Copy the prompt above, paste it into an LLM, and share the resulting advice in this discussion thread.',
  );

  return lines.join('\n');
}
