// The text printed when the release stops: why, what to run next (never run
// for the person), and where docs/releasing.md explains it.
import { sanitizeForTerminal } from './sanitize.ts';

// Headings in docs/releasing.md. A test of the document checks that each of
// them exists there.
export const SECTIONS = {
  everyRelease: 'Every release',
  resume: 'Resuming an interrupted release',
  verifyByHand: 'Verify trust and protections by hand',
  waitForRelease: 'Wait for the Release workflow',
  checksBeforeApproval: 'Checks before approval',
  postRelease: 'Post-release checks',
} as const;

export interface StopInfo {
  // 'entry' for the entry decision, a stage number for the front half
  readonly at: 'entry' | number;
  readonly reason: string;
  // the row of the entry table; absent for a stage stop
  readonly row?: number;
  // shown as `try:` lines, one command each
  readonly commands: readonly string[];
  readonly section: string;
  // extra lines such as a short git status; shown indented
  readonly detail?: readonly string[];
}

// Row 10 means there is nothing to release, which is not a failure. Every
// other stop is a failure (a declined y/N is handled by the caller, as 0).
export function exitCodeOfRow(row: number | undefined): 0 | 1 {
  return row === 10 ? 0 : 1;
}

export function formatStopReport(info: StopInfo): string[] {
  const where = info.at === 'entry' ? 'entry' : `stage ${info.at}`;
  const row = info.row === undefined ? '' : ` (row ${info.row})`;
  const lines = [`release stopped at ${where}: ${info.reason}${row}`];
  for (const line of info.detail ?? []) lines.push(`  ${line}`);
  for (const command of info.commands) lines.push(`try: ${command}`);
  lines.push(`see: docs/releasing.md "${info.section}"`);
  return lines.map(sanitizeForTerminal);
}
