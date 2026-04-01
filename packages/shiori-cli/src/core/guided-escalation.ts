/**
 * Guided Escalation: maturityStage-based next step suggestions (EP-0216).
 *
 * Provides stage-aware command recommendations for badge/health stderr output.
 * Helps users navigate from "What score do I have?" to "What should I do next?"
 * by suggesting 2-3 concrete CLI commands based on their governance maturity stage.
 *
 * Pure functions — no I/O.
 */

import type { HealthMaturityStage } from './types.ts';
import type { HealthNextStep } from './types.ts';

/**
 * Stage-specific recommended commands.
 * Each stage provides 2-3 commands that represent the most impactful next actions,
 * ordered by priority. Commands are intentionally few to minimize cognitive load.
 */
const STAGE_RECOMMENDATIONS: Record<HealthMaturityStage, HealthNextStep[]> = {
  Foundation: [
    {
      message: 'まず未追跡の lint disable コメントを発見する',
      command: 'shiori adopt',
    },
    {
      message: 'レジストリに登録して追跡を開始する',
      command: 'shiori update',
    },
    {
      message: '進捗を確認する',
      command: 'shiori health',
    },
  ],
  Tracking: [
    {
      message: '弱い軸の課題を特定して優先順位をつける',
      command: 'shiori triage',
    },
    {
      message: 'メタデータ不備を修正する',
      command: 'shiori doctor',
    },
    {
      message: '改善後の状態を確認する',
      command: 'shiori health',
    },
  ],
  Maintained: [
    {
      message: '残りの処方箋を確認して対処する',
      command: 'shiori health --fix --preview',
    },
    {
      message: 'コーチングプロンプトでチーム共有する',
      command: 'shiori coach --template health',
    },
  ],
  Autonomous: [
    {
      message: 'CI に組み込んで退行を防止する',
      command: 'shiori check --fail-on expired,missing-in-registry',
    },
    {
      message: 'スコア推移をモニタリングする',
      command: 'shiori health --trend',
    },
  ],
};

/**
 * Get stage-specific next step recommendations.
 * Returns an ordered list of recommended CLI commands for the given maturity stage.
 */
export function getStageRecommendations(
  stage: HealthMaturityStage,
): HealthNextStep[] {
  return STAGE_RECOMMENDATIONS[stage];
}

/**
 * Format next step recommendations as a multi-line string for stderr output.
 * Returns empty string when stage is undefined (backward compatibility).
 *
 * Output format:
 * ```
 * 💡 Next steps:
 *   1. まず未追跡の lint disable コメントを発見する
 *      → shiori adopt
 *   2. レジストリに登録して追跡を開始する
 *      → shiori update
 * ```
 */
export function formatGuidedEscalation(
  stage: HealthMaturityStage | undefined,
): string {
  if (stage == null) return '';

  const steps = getStageRecommendations(stage);
  const lines: string[] = ['💡 Next steps:'];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    lines.push(`  ${i + 1}. ${step.message}`);
    lines.push(`     → ${step.command}`);
  }

  return lines.join('\n');
}
