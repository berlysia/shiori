import type { RefStatusEntry } from '../ref-status.ts';
import { defaultRefStatusRunner, type RefStatusRunner } from '../ref-status.ts';
import type { RefStatusProvider } from './types.ts';

/**
 * Ref status provider that delegates to an external command.
 * Wraps the existing RefStatusRunner pattern for backward compatibility.
 */
export class CommandRefStatusProvider implements RefStatusProvider {
  readonly name = 'command';

  private readonly command: string;
  private readonly runner: RefStatusRunner;

  constructor(command: string, runner?: RefStatusRunner) {
    this.command = command;
    this.runner = runner ?? defaultRefStatusRunner;
  }

  async resolve(refs: string[]): Promise<RefStatusEntry[]> {
    if (refs.length === 0) return [];
    return this.runner(this.command, refs);
  }
}
