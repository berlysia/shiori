/**
 * Interactive fix prompt logic (EP-0122).
 *
 * Separated from fix-cli.ts for testability — accepts abstract input/output
 * streams so tests can simulate user responses without a real TTY.
 */

import {
  createInterface,
  type Interface as ReadlineInterface,
} from 'node:readline/promises';
import type { FixAction } from '../core/types.ts';

// ── Types ────────────────────────────────────────────────────

/** Abstracted I/O context for interactive prompts */
export interface InteractiveFixContext {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/** User's choice for a fix action */
export type InteractiveChoice = 'approve' | 'skip' | 'quit';

// ── Internal helpers ─────────────────────────────────────────

function parseChoice(input: string): InteractiveChoice | null {
  const normalized = input.trim().toLowerCase();
  switch (normalized) {
    case 'a':
    case 'approve':
      return 'approve';
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

function writeTo(output: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    output.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ── Prompt ───────────────────────────────────────────────────

/**
 * Prompt the user to approve, skip, or quit for a single fix action.
 *
 * Displays action details and waits for user input:
 * - "a" → approve (execute this action)
 * - "s" → skip (move to next action)
 * - "q" → quit (stop processing all remaining actions)
 *
 * Invalid input triggers a re-prompt.
 *
 * Accepts a pre-created readline interface so the caller can manage the
 * lifecycle (create once, close after all actions are processed).
 */
export async function promptFixAction(
  action: FixAction,
  rl: ReadlineInterface,
  output: NodeJS.WritableStream,
): Promise<InteractiveChoice> {
  // Display action details
  await writeTo(output, `\n  Action: ${action.type}\n`);
  await writeTo(output, `  Detail: ${action.description}\n`);
  await writeTo(output, `  Refs: ${action.refs.length} ref(s)\n\n`);

  // Prompt loop until valid input
  while (true) {
    const answer = await rl.question('  [a]pprove / [s]kip / [q]uit? ');
    const choice = parseChoice(answer);
    if (choice !== null) {
      return choice;
    }
    await writeTo(output, '  Invalid choice. Please enter "a", "s", or "q".\n');
  }
}

/**
 * Create a readline interface for interactive fix prompts.
 * The caller is responsible for closing the interface when done.
 */
export function createFixReadline(
  ctx: InteractiveFixContext,
): ReadlineInterface {
  return createInterface({
    input: ctx.input,
    output: ctx.output,
  });
}
