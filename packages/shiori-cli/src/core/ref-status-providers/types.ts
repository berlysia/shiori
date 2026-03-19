import type { RefStatusEntry } from '../ref-status.ts';

/**
 * Abstraction for ref status resolution providers.
 * Each provider knows how to check the status of tracking references
 * (e.g., external commands, GitHub Issues API).
 */
export interface RefStatusProvider {
  /** Provider name for logging and diagnostics */
  readonly name: string;

  /**
   * Resolve statuses for the given refs.
   * Implementations should gracefully handle unknown refs by returning
   * status 'unknown' or omitting them from results.
   */
  resolve(refs: string[]): Promise<RefStatusEntry[]>;
}
