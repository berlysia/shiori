// Parsers for what git and npm print. They only turn text into values; a text
// that does not have the expected shape becomes a failure, never a guess.
import type { NpmState } from './entry.ts';
import type { ChangeEntry, ChangeState, Observed, RunResult } from './types.ts';

// Strongest first: the single state kept when the index and the work tree
// disagree (for example "AM" is an added file that was edited afterwards).
const STATE_PRECEDENCE: readonly ChangeState[] = [
  'D',
  'A',
  'R',
  'C',
  'T',
  'U',
  'M',
];

function collapse(x: string, y: string): ChangeState {
  if (x === '?' && y === '?') return '??';
  for (const state of STATE_PRECEDENCE) {
    if (x === state || y === state) return state;
  }
  // an unknown letter must not look like a clean change
  return 'U';
}

// `git status --porcelain=v1 -z --untracked-files=all`: "XY path\0", and for
// a rename or copy "XY new\0old\0". Paths are not quoted in -z output.
export function parsePorcelain(output: string): ChangeEntry[] {
  const parts = output.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    const x = part[0] ?? '';
    const y = part[1] ?? '';
    entries.push({ path: part.slice(3), state: collapse(x, y) });
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') index += 1;
  }
  return entries;
}

// `git diff --name-status --no-renames -z`: "S\0path\0". A letter followed by
// a score (R100) cannot appear with --no-renames, so it is not accepted.
export function parseNameStatus(output: string): Observed<ChangeEntry[]> {
  const parts = output.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  if (parts.length % 2 !== 0) {
    return {
      kind: 'error',
      error: 'name-status output has an odd number of fields',
    };
  }
  const entries: ChangeEntry[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const letter = parts[index] ?? '';
    if (!/^[MADTU]$/.test(letter)) {
      return {
        kind: 'error',
        error: 'name-status output has an unexpected status letter',
      };
    }
    entries.push({
      path: parts[index + 1] ?? '',
      state: letter as ChangeState,
    });
  }
  return { kind: 'ok', value: entries };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isE404(result: RunResult): boolean {
  if (result.stderrTail.includes('E404')) return true;
  const parsed = parseJson(result.stdout);
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null)
    return false;
  const error = (parsed.value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'E404'
  );
}

function failed(error: string): NpmState {
  return { kind: 'failed', error };
}

// `npm view @berlysia/shiori versions --json` and `dist-tags --json`. Only
// E404 means "never published"; any other failure leaves the question open.
export function parseNpmView(
  versions: RunResult,
  distTags: RunResult,
): NpmState {
  if (versions.code !== 0) {
    return isE404(versions)
      ? { kind: 'unpublished' }
      : failed(`npm view versions exited with ${versions.code}`);
  }
  const versionsJson = parseJson(versions.stdout);
  // one published version prints as a plain string, not a one-element array
  const list: unknown =
    versionsJson.ok && typeof versionsJson.value === 'string'
      ? [versionsJson.value]
      : versionsJson.ok
        ? versionsJson.value
        : undefined;
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
    return failed('npm view versions did not print a list of versions');
  }
  if (distTags.code !== 0)
    return failed(`npm view dist-tags exited with ${distTags.code}`);
  const tagsJson = parseJson(distTags.stdout);
  // npm 12.2.0 wraps the object in a one-element array; any other array is not
  // a dist-tags answer
  const tagsValue: unknown =
    tagsJson.ok && Array.isArray(tagsJson.value) && tagsJson.value.length === 1
      ? tagsJson.value[0]
      : tagsJson.ok
        ? tagsJson.value
        : undefined;
  if (
    typeof tagsValue !== 'object' ||
    tagsValue === null ||
    Array.isArray(tagsValue)
  ) {
    return failed('npm view dist-tags did not print an object');
  }
  const tags: Record<string, string> = {};
  for (const [name, value] of Object.entries(tagsValue)) {
    if (typeof value !== 'string')
      return failed('npm view dist-tags has a non-string value');
    tags[name] = value;
  }
  return { kind: 'published', versions: list as string[], distTags: tags };
}

// The first line that a CLI marked as an error, with colour codes removed, for
// a stop message. The output stays external text: the caller still sends it
// through the terminal exit, which removes the remaining control characters.
export function firstErrorLine(text: string): string | undefined {
  for (const raw of text.split('\n')) {
    // eslint-disable-next-line no-control-regex -- strips SGR colour codes only
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (/\berror\b/i.test(line)) return line.slice(0, 200);
  }
  return undefined;
}

const SHA = /^[0-9a-f]{40}$/;

// `git ls-remote origin refs/tags/<tag> refs/tags/<tag>^{}`: the peeled line
// (`^{}`) is the commit of an annotated tag; without it the plain line is the
// commit of a lightweight tag. No line at all means the tag is absent.
export function parseLsRemote(
  output: string,
  tag: string,
): Observed<string | undefined> {
  let plain: string | undefined;
  let peeled: string | undefined;
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const match = /^([0-9a-f]{40})\t(\S+)$/.exec(line);
    if (match === null || match[1] === undefined) {
      return {
        kind: 'error',
        error: 'git ls-remote printed an unexpected line',
      };
    }
    if (match[2] === `refs/tags/${tag}`) plain = match[1];
    else if (match[2] === `refs/tags/${tag}^{}`) peeled = match[1];
    else
      return {
        kind: 'error',
        error: 'git ls-remote printed an unexpected ref',
      };
  }
  return { kind: 'ok', value: peeled ?? plain };
}

export function parseCommitSha(output: string): string | undefined {
  const sha = output.trim();
  return SHA.test(sha) ? sha : undefined;
}
