/**
 * Interactive triage wizard (EP-0157).
 *
 * Separated from triage-cli.ts for testability — accepts abstract input/output
 * streams so tests can simulate user responses without a real TTY.
 *
 * Follows the InteractiveFixContext pattern from fix-interactive.ts.
 */

import {
  createInterface,
  type Interface as ReadlineInterface,
} from 'node:readline/promises';
import type {
  WizardQueue,
  WizardQueueItem,
  WizardUrgency,
  TriagePriority,
} from './triage.ts';

// ── Types ────────────────────────────────────────────────────

/** Abstracted I/O context for interactive wizard prompts */
export interface InteractiveTriageContext {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/** User's choice for a wizard triage item */
export type WizardChoice = 'act' | 'skip' | 'defer' | 'quit';

/** Result of processing a single wizard item */
export interface WizardItemResult {
  ref: string;
  choice: WizardChoice;
}

/** Result of a complete wizard session */
export interface WizardSessionResult {
  /** Items processed (user made a decision) */
  processed: WizardItemResult[];
  /** Items remaining (user quit before reaching them) */
  remaining: number;
  /** Total items in the queue */
  total: number;
}

// ── Display constants ────────────────────────────────────────

const URGENCY_EMOJI: Record<WizardUrgency, string> = {
  overdue: '\u001b[31m\u25cf\u001b[0m', // red circle
  imminent: '\u001b[33m\u25cf\u001b[0m', // yellow circle
  upcoming: '\u001b[36m\u25cf\u001b[0m', // cyan circle
  open: '\u001b[37m\u25cb\u001b[0m', // white circle outline
};

const URGENCY_LABEL: Record<WizardUrgency, string> = {
  overdue: 'OVERDUE',
  imminent: 'IMMINENT',
  upcoming: 'UPCOMING',
  open: 'OPEN',
};

const PRIORITY_EMOJI: Record<TriagePriority, string> = {
  critical: '\u001b[31m!\u001b[0m',
  high: '\u001b[33m!\u001b[0m',
  medium: '\u001b[36m-\u001b[0m',
  low: '\u001b[37m-\u001b[0m',
};

// ── Internal helpers ─────────────────────────────────────────

function parseChoice(input: string): WizardChoice | null {
  const normalized = input.trim().toLowerCase();
  switch (normalized) {
    case 'a':
    case 'act':
      return 'act';
    case 's':
    case 'skip':
      return 'skip';
    case 'd':
    case 'defer':
      return 'defer';
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

function formatDaysToExpiry(days: number | null): string {
  if (days === null) return 'no expiry';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'expires today';
  return `${days}d remaining`;
}

// ── Display functions ────────────────────────────────────────

async function displayQueueSummary(
  queue: WizardQueue,
  output: NodeJS.WritableStream,
): Promise<void> {
  const total = queue.items.length;
  await writeTo(
    output,
    '\n  \u250c\u2500 Triage Wizard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n',
  );
  await writeTo(output, `  \u2502 ${total} item(s) to review\n`);
  if (queue.byUrgency.overdue > 0) {
    await writeTo(
      output,
      `  \u2502 ${URGENCY_EMOJI.overdue} ${queue.byUrgency.overdue} overdue\n`,
    );
  }
  if (queue.byUrgency.imminent > 0) {
    await writeTo(
      output,
      `  \u2502 ${URGENCY_EMOJI.imminent} ${queue.byUrgency.imminent} imminent\n`,
    );
  }
  if (queue.byUrgency.upcoming > 0) {
    await writeTo(
      output,
      `  \u2502 ${URGENCY_EMOJI.upcoming} ${queue.byUrgency.upcoming} upcoming\n`,
    );
  }
  if (queue.byUrgency.open > 0) {
    await writeTo(
      output,
      `  \u2502 ${URGENCY_EMOJI.open} ${queue.byUrgency.open} open\n`,
    );
  }
  await writeTo(
    output,
    '  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n',
  );
}

async function displayItem(
  queueItem: WizardQueueItem,
  index: number,
  total: number,
  output: NodeJS.WritableStream,
): Promise<void> {
  const { item, urgency, daysToExpiry } = queueItem;
  const expiryText = formatDaysToExpiry(daysToExpiry);
  const issueTypes = [...new Set(item.issues.map((i) => i.type))].join(', ');
  const owner = item.registryEntry?.owner ?? '-';

  await writeTo(
    output,
    `  [${index + 1}/${total}] ${URGENCY_EMOJI[urgency]} ${URGENCY_LABEL[urgency]}  ${PRIORITY_EMOJI[item.priority]} ${item.ref}\n`,
  );
  await writeTo(output, `  Expiry:  ${expiryText}\n`);
  await writeTo(output, `  Issues:  ${issueTypes}\n`);
  await writeTo(output, `  Owner:   ${owner}\n`);
  if (item.url) {
    await writeTo(output, `  URL:     ${item.url}\n`);
  }
  await writeTo(output, `  Action:  ${item.action}\n`);

  // Source locations (compact: show first 3)
  const locs = item.sourceLocations;
  if (locs.length > 0) {
    const shown = locs.slice(0, 3);
    const locStrs = shown.map((l) => `${l.file}:${l.line}`);
    const suffix = locs.length > 3 ? ` (+${locs.length - 3} more)` : '';
    await writeTo(output, `  Sources: ${locStrs.join(', ')}${suffix}\n`);
  }
  await writeTo(output, '\n');
}

// ── Prompt ───────────────────────────────────────────────────

/**
 * Prompt the user to act, skip, defer, or quit for a single triage item.
 *
 * Accepts a pre-created readline interface so the caller can manage the
 * lifecycle (create once, close after all items are processed).
 */
export async function promptTriageAction(
  queueItem: WizardQueueItem,
  index: number,
  total: number,
  rl: ReadlineInterface,
  output: NodeJS.WritableStream,
): Promise<WizardChoice> {
  await displayItem(queueItem, index, total, output);

  while (true) {
    const answer = await rl.question('  [a]ct / [s]kip / [d]efer / [q]uit? ');
    const choice = parseChoice(answer);
    if (choice !== null) {
      return choice;
    }
    await writeTo(
      output,
      '  Invalid choice. Please enter "a", "s", "d", or "q".\n',
    );
  }
}

/**
 * Create a readline interface for interactive triage prompts.
 * The caller is responsible for closing the interface when done.
 */
export function createTriageReadline(
  ctx: InteractiveTriageContext,
): ReadlineInterface {
  return createInterface({
    input: ctx.input,
    output: ctx.output,
  });
}

// ── Session ──────────────────────────────────────────────────

/**
 * Run a complete interactive triage wizard session.
 *
 * Iterates through the wizard queue, displaying each item and prompting
 * the user for a decision. Returns the session result with all decisions.
 *
 * Accepts abstract I/O streams for testability.
 */
export async function wizardTriageSession(
  queue: WizardQueue,
  ctx: InteractiveTriageContext,
): Promise<WizardSessionResult> {
  const rl = createTriageReadline(ctx);
  const processed: WizardItemResult[] = [];
  const total = queue.items.length;

  try {
    if (total === 0) {
      await writeTo(ctx.output, '\n  No items to triage. All clear!\n\n');
      return { processed: [], remaining: 0, total: 0 };
    }

    await displayQueueSummary(queue, ctx.output);

    for (let i = 0; i < total; i++) {
      const queueItem = queue.items[i]!;
      const choice = await promptTriageAction(
        queueItem,
        i,
        total,
        rl,
        ctx.output,
      );

      processed.push({ ref: queueItem.item.ref, choice });

      if (choice === 'quit') {
        const remaining = total - i - 1;
        await writeTo(
          ctx.output,
          `\n  Wizard stopped. ${processed.length} processed, ${remaining} remaining.\n\n`,
        );
        return { processed, remaining, total };
      }

      // Brief feedback per choice
      switch (choice) {
        case 'act':
          await writeTo(
            ctx.output,
            `  \u2192 Marked for action: ${queueItem.item.action}\n\n`,
          );
          break;
        case 'skip':
          await writeTo(ctx.output, '  \u2192 Skipped\n\n');
          break;
        case 'defer':
          await writeTo(ctx.output, '  \u2192 Deferred to next session\n\n');
          break;
      }
    }

    await writeTo(
      ctx.output,
      `\n  Wizard complete. ${processed.length}/${total} items reviewed.\n\n`,
    );
    return { processed, remaining: 0, total };
  } finally {
    rl.close();
  }
}
