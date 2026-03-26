/**
 * Interactive context common base (EP-0184).
 *
 * Shared I/O abstraction for interactive prompts across commands.
 * Extracted from fix-interactive.ts and triage-interactive.ts.
 */

import {
  createInterface,
  type Interface as ReadlineInterface,
} from 'node:readline/promises';

// ── Types ────────────────────────────────────────────────────

/**
 * Abstracted I/O context for interactive prompts.
 *
 * Commands that need interactive user input should accept this interface
 * instead of coupling to process.stdin/stdout directly. This enables
 * testability via PassThrough streams.
 */
export interface InteractiveContext {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

// ── Utilities ────────────────────────────────────────────────

/**
 * Promise-based write to a writable stream.
 * Resolves when the write completes, rejects on error.
 */
export function writeTo(
  output: NodeJS.WritableStream,
  text: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    output.write(text, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Create a readline interface from an interactive context.
 * The caller is responsible for closing the returned interface.
 */
export function createReadlineInterface(
  ctx: InteractiveContext,
): ReadlineInterface {
  return createInterface({
    input: ctx.input,
    output: ctx.output,
  });
}
