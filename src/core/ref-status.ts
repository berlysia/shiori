import { execFile } from 'node:child_process';

/**
 * Ref status values returned by an external status command.
 * - 'open': The referenced issue/ticket is still active
 * - 'closed': The referenced issue/ticket has been resolved
 * - 'unknown': The command could not determine the status
 */
export type RefStatus = 'open' | 'closed' | 'unknown';

/** A single line of JSONL output from the ref-status command */
export interface RefStatusEntry {
  ref: string;
  status: RefStatus;
}

/**
 * Runner function type for ref-status external command.
 * Accepts refs via stdin (newline-delimited), returns JSONL on stdout.
 * DI point — inject a mock for testing.
 */
export type RefStatusRunner = (
  command: string,
  refs: string[],
) => Promise<RefStatusEntry[]>;

/** Maximum stdout buffer size for ref-status processes (10 MiB) */
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Parse a single JSONL line into a RefStatusEntry.
 * Returns undefined for lines that don't match the expected shape.
 */
export function parseRefStatusLine(line: string): RefStatusEntry | undefined {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'ref' in parsed &&
      'status' in parsed &&
      typeof (parsed as Record<string, unknown>).ref === 'string' &&
      typeof (parsed as Record<string, unknown>).status === 'string'
    ) {
      const status = (parsed as Record<string, unknown>).status as string;
      if (status === 'open' || status === 'closed' || status === 'unknown') {
        return {
          ref: (parsed as Record<string, unknown>).ref as string,
          status,
        };
      }
    }
  } catch {
    // Malformed JSON line — skip
  }

  return undefined;
}

/**
 * Default ref-status runner using child_process.execFile.
 * Splits the command string into program + args, pipes refs via stdin,
 * and parses JSONL from stdout.
 */
export const defaultRefStatusRunner: RefStatusRunner = (
  command: string,
  refs: string[],
): Promise<RefStatusEntry[]> => {
  return new Promise((resolve, reject) => {
    const parts = command.split(/\s+/);
    const program = parts[0];
    const args = parts.slice(1);

    if (!program) {
      reject(new Error('ref-status-command is empty'));
      return;
    }

    const child = execFile(
      program,
      args,
      { maxBuffer: DEFAULT_MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        const entries: RefStatusEntry[] = [];
        for (const line of stdout.split('\n')) {
          const entry = parseRefStatusLine(line);
          if (entry) {
            entries.push(entry);
          }
        }
        resolve(entries);
      },
    );

    // Write refs to stdin
    child.stdin?.write(refs.join('\n') + '\n');
    child.stdin?.end();
  });
};

/**
 * Collect unique non-empty refs from annotations.
 */
export function collectUniqueRefs(annotations: { ref: string }[]): string[] {
  const seen = new Set<string>();
  for (const a of annotations) {
    if (a.ref !== '') {
      seen.add(a.ref);
    }
  }
  return [...seen];
}

/**
 * Run the ref-status command and build a status map.
 *
 * @param command - The external command string to execute
 * @param refs - Unique refs to check
 * @param options - Optional runner override for DI/testing
 * @returns Map of ref -> RefStatus
 */
export async function resolveRefStatuses(
  command: string,
  refs: string[],
  options?: { runner?: RefStatusRunner },
): Promise<Map<string, RefStatus>> {
  if (refs.length === 0) return new Map();

  const runner = options?.runner ?? defaultRefStatusRunner;
  const entries = await runner(command, refs);

  const result = new Map<string, RefStatus>();
  for (const entry of entries) {
    result.set(entry.ref, entry.status);
  }

  return result;
}
