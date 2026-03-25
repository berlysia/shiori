import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  wizardTriageSession,
  type InteractiveTriageContext,
  type WizardSessionResult,
} from '../src/commands/triage-interactive.ts';
import type {
  WizardQueue,
  WizardQueueItem,
  TriageItem,
} from '../src/commands/triage.ts';
import type { RegistryEntry } from '../src/core/types.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeRegistryEntry(
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'test.ts',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

function makeTriageItem(
  ref: string,
  overrides: Partial<TriageItem> = {},
): TriageItem {
  return {
    ref,
    priority: 'medium',
    issues: [
      {
        type: 'missing-in-registry',
        severity: 'warning',
        ref,
        message: `test issue for ${ref}`,
        file: 'src/a.ts',
        line: 1,
      },
    ],
    registryEntry: undefined,
    sourceLocations: [{ file: 'src/a.ts', line: 1 }],
    url: undefined,
    action: 'shiori update',
    ...overrides,
  };
}

function makeQueueItem(
  ref: string,
  urgency: 'overdue' | 'imminent' | 'upcoming' | 'open' = 'open',
  daysToExpiry: number | null = null,
  overrides: Partial<TriageItem> = {},
): WizardQueueItem {
  return {
    item: makeTriageItem(ref, overrides),
    urgency,
    daysToExpiry,
  };
}

function makeQueue(items: WizardQueueItem[]): WizardQueue {
  const byUrgency = { overdue: 0, imminent: 0, upcoming: 0, open: 0 };
  for (const qi of items) {
    byUrgency[qi.urgency]++;
  }
  return { items, byUrgency };
}

/**
 * Create a mock I/O context for testing interactive prompts.
 * Feeds user responses line by line.
 */
function createMockContext(responses: string[]): {
  ctx: InteractiveTriageContext;
  getOutput: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputBuf = '';

  output.on('data', (chunk: Buffer) => {
    outputBuf += chunk.toString();
  });

  // Feed responses asynchronously (after prompt is displayed)
  let responseIndex = 0;
  const feedNextResponse = (): void => {
    if (responseIndex < responses.length) {
      const response = responses[responseIndex]!;
      responseIndex++;
      // Schedule slightly delayed write to ensure readline is ready
      setImmediate(() => {
        input.write(response + '\n');
      });
    }
  };

  // Feed a response whenever output contains a question prompt
  output.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('[a]ct')) {
      feedNextResponse();
    }
  });

  return {
    ctx: { input, output },
    getOutput: () => outputBuf,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('wizardTriageSession', () => {
  it('returns empty result for empty queue', async () => {
    const { ctx, getOutput } = createMockContext([]);
    const queue = makeQueue([]);

    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed.length, 0);
    assert.equal(result.remaining, 0);
    assert.equal(result.total, 0);
    assert.ok(getOutput().includes('No items to triage'));
  });

  it('processes all items when user acts on each', async () => {
    const queue = makeQueue([
      makeQueueItem('REF-001', 'overdue', -10),
      makeQueueItem('REF-002', 'open'),
    ]);

    const { ctx } = createMockContext(['a', 'a']);
    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed.length, 2);
    assert.equal(result.remaining, 0);
    assert.equal(result.total, 2);
    assert.equal(result.processed[0]!.ref, 'REF-001');
    assert.equal(result.processed[0]!.choice, 'act');
    assert.equal(result.processed[1]!.ref, 'REF-002');
    assert.equal(result.processed[1]!.choice, 'act');
  });

  it('stops early when user quits', async () => {
    const queue = makeQueue([
      makeQueueItem('REF-001', 'overdue', -10),
      makeQueueItem('REF-002', 'imminent', 5),
      makeQueueItem('REF-003', 'open'),
    ]);

    const { ctx } = createMockContext(['a', 'q']);
    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed.length, 2);
    assert.equal(result.remaining, 1);
    assert.equal(result.total, 3);
    assert.equal(result.processed[0]!.choice, 'act');
    assert.equal(result.processed[1]!.choice, 'quit');
  });

  it('records skip and defer choices', async () => {
    const queue = makeQueue([
      makeQueueItem('REF-001'),
      makeQueueItem('REF-002'),
      makeQueueItem('REF-003'),
    ]);

    const { ctx } = createMockContext(['s', 'd', 'a']);
    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed[0]!.choice, 'skip');
    assert.equal(result.processed[1]!.choice, 'defer');
    assert.equal(result.processed[2]!.choice, 'act');
  });

  it('accepts full-word choices', async () => {
    const queue = makeQueue([
      makeQueueItem('REF-001'),
      makeQueueItem('REF-002'),
    ]);

    const { ctx } = createMockContext(['act', 'skip']);
    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed[0]!.choice, 'act');
    assert.equal(result.processed[1]!.choice, 'skip');
  });

  it('displays queue summary header', async () => {
    const queue = makeQueue([
      makeQueueItem('REF-001', 'overdue', -5),
      makeQueueItem('REF-002', 'open'),
    ]);

    const { ctx, getOutput } = createMockContext(['a', 'a']);
    await wizardTriageSession(queue, ctx);

    const output = getOutput();
    assert.ok(output.includes('Triage Wizard'));
    assert.ok(output.includes('2 item(s) to review'));
    assert.ok(output.includes('1 overdue'));
    assert.ok(output.includes('1 open'));
  });

  it('displays item details during prompts', async () => {
    const queue = makeQueue([
      makeQueueItem('EXP-001', 'overdue', -14, {
        priority: 'critical',
        registryEntry: makeRegistryEntry({ owner: 'team-a' }),
        url: 'https://jira.example.com/EXP-001',
      }),
    ]);

    const { ctx, getOutput } = createMockContext(['a']);
    await wizardTriageSession(queue, ctx);

    const output = getOutput();
    assert.ok(output.includes('EXP-001'));
    assert.ok(output.includes('OVERDUE'));
    assert.ok(output.includes('14d overdue'));
    assert.ok(output.includes('team-a'));
    assert.ok(output.includes('https://jira.example.com/EXP-001'));
  });

  it('handles invalid input by re-prompting', async () => {
    const queue = makeQueue([makeQueueItem('REF-001')]);

    // Invalid input 'x' should be ignored; next valid 'a' should be accepted
    const { ctx, getOutput } = createMockContext(['x', 'a']);

    // Override the response feeding to handle re-prompts
    // The default createMockContext feeds on [a]ct prompt detection which works
    const result = await wizardTriageSession(queue, ctx);

    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0]!.choice, 'act');
    const output = getOutput();
    assert.ok(output.includes('Invalid choice'));
  });
});
