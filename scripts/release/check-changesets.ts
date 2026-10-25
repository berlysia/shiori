// Checks every pending changeset and CHANGELOG.md's `## [Unreleased]` block.
// CI runs it to report problems early; the release command runs the same
// check as its gate.
//
// An entrypoint, not a lib module: it reads files and writes to stderr
// directly.
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANGESET_MAX_BYTES,
  checkUnreleased,
  parseChangeset,
} from './lib/changeset.ts';
import { sanitizeForTerminal } from './lib/sanitize.ts';

export interface CheckOutcome {
  // `<file>:<line>: <reason>` entries, not yet sanitized
  readonly violations: string[];
  // a reason the check could not run; set instead of violations
  readonly fatal?: string;
}

export function checkRepository(root: string): CheckOutcome {
  const changesetDir = join(root, '.changeset');
  let names: string[];
  try {
    names = readdirSync(changesetDir).sort();
  } catch {
    return { violations: [], fatal: '.changeset/ could not be read' };
  }

  const violations: string[] = [];
  for (const name of names) {
    // Only *.md is a changeset. README.md, config.json and pre.json are not.
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const file = `.changeset/${name}`;
    const path = join(changesetDir, name);
    // lstat, not stat: a symlink must not make the check read outside the repo
    if (!lstatSync(path).isFile()) {
      violations.push(`${file}:1: not a regular file`);
      continue;
    }
    if (statSync(path).size > CHANGESET_MAX_BYTES) {
      violations.push(`${file}:1: larger than ${CHANGESET_MAX_BYTES} bytes`);
      continue;
    }
    const parsed = parseChangeset(
      name.slice(0, -'.md'.length),
      readFileSync(path, 'utf8'),
    );
    if (!parsed.ok) {
      for (const error of parsed.errors) {
        violations.push(`${file}:${error.line}: ${error.reason}`);
      }
    }
  }

  let changelog: string;
  try {
    changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  } catch {
    return { violations, fatal: 'CHANGELOG.md could not be read' };
  }
  const unreleased = checkUnreleased(changelog);
  if (!unreleased.ok) {
    for (const error of unreleased.errors) {
      violations.push(`CHANGELOG.md:${error.line}: ${error.reason}`);
    }
  }
  return { violations };
}

function main(): void {
  const root =
    process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url));
  let outcome: CheckOutcome;
  try {
    outcome = checkRepository(root);
  } catch {
    outcome = { violations: [], fatal: 'the check failed unexpectedly' };
  }
  const lines = [...outcome.violations];
  if (outcome.fatal !== undefined) lines.push(outcome.fatal);
  if (lines.length === 0) return;
  // process.exitCode, not process.exit(): exit may cut off a pending stderr write
  process.stderr.write(`${sanitizeForTerminal(lines.join('\n'))}\n`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
