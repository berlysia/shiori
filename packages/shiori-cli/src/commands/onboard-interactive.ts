/**
 * Interactive onboard wizard (EP-0187).
 *
 * Follows the wizardTriageSession pattern from triage-interactive.ts:
 * accepts abstract input/output streams for testability.
 *
 * Uses the shared InteractiveContext base from core/ (EP-0184).
 */

import type { InteractiveContext } from '../core/interactive-context.ts';
import {
  writeTo,
  createReadlineInterface,
} from '../core/interactive-context.ts';
import type { OnboardStep } from './onboard.ts';

// ── Types ────────────────────────────────────────────────────

/** Abstracted I/O context for interactive onboard prompts */
export type InteractiveOnboardContext = InteractiveContext;

/** User's choice for an onboard step */
export type OnboardChoice = 'run' | 'skip' | 'quit';

/** Result of processing a single onboard step */
export interface OnboardStepResult {
  step: OnboardStep;
  choice: OnboardChoice;
}

/** Result of a complete onboard interactive session */
export interface OnboardSessionResult {
  /** Steps processed (user made a decision) */
  processed: OnboardStepResult[];
  /** Steps remaining (user quit before reaching them) */
  remaining: number;
  /** Total steps in the session */
  total: number;
}

/** Options for the wizard onboard session */
export interface WizardOnboardOptions {
  /** Health score at the start of the session */
  beforeScore: number;
  /** Team name for display */
  teamName?: string;
}

// ── Internal helpers ─────────────────────────────────────────

function parseChoice(input: string): OnboardChoice | null {
  const normalized = input.trim().toLowerCase();
  switch (normalized) {
    case 'r':
    case 'run':
      return 'run';
    case 's':
    case 'skip':
      return 'skip';
    case 'q':
    case 'quit':
      return 'quit';
    default:
      return null;
  }
}

// ── Session ─────────────────────────────────────────────────

/**
 * Run an interactive onboard wizard session.
 *
 * For each step, the user can:
 * - [r]un: print the command for execution
 * - [s]kip: skip this step
 * - [q]uit: exit the wizard
 *
 * @param steps - Onboard steps to process
 * @param ctx - I/O context (input/output streams)
 * @param options - Session options (score, team name)
 */
export async function wizardOnboardSession(
  steps: OnboardStep[],
  ctx: InteractiveOnboardContext,
  options: WizardOnboardOptions,
): Promise<OnboardSessionResult> {
  const rl = createReadlineInterface(ctx);
  const processed: OnboardStepResult[] = [];

  try {
    // Display session header
    const header = options.teamName
      ? `\nOnboard wizard for "${options.teamName}":`
      : '\nOnboard wizard:';
    await writeTo(ctx.output, `${header}\n`);
    await writeTo(ctx.output, `Health score: ${options.beforeScore}/100\n`);
    await writeTo(ctx.output, `${steps.length} step(s) to review\n\n`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const remaining = steps.length - i;

      // Display step
      await writeTo(
        ctx.output,
        `─── Step ${step.stepNumber}/${steps.length} (${remaining} remaining) ───\n`,
      );
      await writeTo(ctx.output, `  ${step.reason}\n`);
      await writeTo(ctx.output, `  $ ${step.command}\n\n`);

      // Prompt for choice
      let choice: OnboardChoice | null = null;
      while (choice === null) {
        const answer = await rl.question('[r]un / [s]kip / [q]uit: ');
        choice = parseChoice(answer);
        if (choice === null) {
          await writeTo(
            ctx.output,
            'Invalid choice. Enter r(un), s(kip), or q(uit).\n',
          );
        }
      }

      processed.push({ step, choice });

      if (choice === 'quit') {
        const skipped = steps.length - i - 1;
        await writeTo(ctx.output, `\nQuit. ${skipped} step(s) skipped.\n`);
        return {
          processed,
          remaining: skipped,
          total: steps.length,
        };
      }

      if (choice === 'run') {
        await writeTo(ctx.output, `→ Run: ${step.command}\n\n`);
      } else {
        await writeTo(ctx.output, `→ Skipped.\n\n`);
      }
    }

    return {
      processed,
      remaining: 0,
      total: steps.length,
    };
  } finally {
    rl.close();
  }
}
