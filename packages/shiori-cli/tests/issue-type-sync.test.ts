import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VERIFY_ISSUE_TYPES } from '../src/core/types.ts';

const REPO_ROOT = join(import.meta.dirname, '../../..');

/**
 * Extract issue type names from a Markdown list in the "Detects:" section of README.md.
 * Matches lines like: - **missing-in-registry** — description
 */
async function getReadmeIssueTypes(): Promise<string[]> {
  const raw = await readFile(join(REPO_ROOT, 'README.md'), 'utf-8');
  const pattern = /^- \*\*([a-z-]+)\*\*/gm;
  const types: string[] = [];
  let m: RegExpExecArray | null;

  // Find the "Detects:" section and extract from there
  const detectsIdx = raw.indexOf('Detects:');
  if (detectsIdx === -1) return [];
  const section = raw.slice(detectsIdx);

  while ((m = pattern.exec(section)) !== null) {
    if (m[1] !== undefined) types.push(m[1]);
  }
  return types;
}

/**
 * Extract issue type names from the Severity Mapping table in README.md.
 * Matches rows like: | `missing-in-registry`       | warning          | ...
 */
async function getReadmeSeverityMappingTypes(): Promise<string[]> {
  const raw = await readFile(join(REPO_ROOT, 'README.md'), 'utf-8');
  const headerIdx = raw.indexOf('### Severity Mapping');
  if (headerIdx === -1) return [];

  // Scope to the section between "### Severity Mapping" and the next "###" heading
  const rest = raw.slice(headerIdx);
  const nextHeading = rest.indexOf('\n### ', 1);
  const section = nextHeading !== -1 ? rest.slice(0, nextHeading) : rest;

  const pattern = /^\|\s*`([a-z-]+)`/gm;
  const types: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(section)) !== null) {
    if (m[1] !== undefined) types.push(m[1]);
  }
  return types;
}

/**
 * Extract issue type literals from docs/api.md VerifyIssueType definition.
 * Matches lines like:   | 'missing-in-registry'
 */
async function getApiDocIssueTypes(): Promise<string[]> {
  const raw = await readFile(join(REPO_ROOT, 'docs/api.md'), 'utf-8');
  const typeBlockStart = raw.indexOf('type VerifyIssueType =');
  if (typeBlockStart === -1) return [];

  // Extract the type block until the next semicolon or empty line
  const rest = raw.slice(typeBlockStart);
  const blockEnd = rest.indexOf(';');
  const block = blockEnd !== -1 ? rest.slice(0, blockEnd) : rest;

  const pattern = /\|\s*'([a-z-]+)'/g;
  const types: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(block)) !== null) {
    if (m[1] !== undefined) types.push(m[1]);
  }
  return types;
}

describe('VerifyIssueType synchronization', () => {
  it('VERIFY_ISSUE_TYPES matches README.md Detects section', async () => {
    const readmeTypes = await getReadmeIssueTypes();

    const missing = VERIFY_ISSUE_TYPES.filter((t) => !readmeTypes.includes(t));
    assert.deepEqual(
      missing,
      [],
      `Issue types in VERIFY_ISSUE_TYPES but not in README.md Detects section: ${missing.join(', ')}`,
    );

    const extra = readmeTypes.filter(
      (t) =>
        !VERIFY_ISSUE_TYPES.includes(t as (typeof VERIFY_ISSUE_TYPES)[number]),
    );
    assert.deepEqual(
      extra,
      [],
      `Issue types in README.md Detects section but not in VERIFY_ISSUE_TYPES: ${extra.join(', ')}`,
    );
  });

  it('VERIFY_ISSUE_TYPES matches docs/api.md VerifyIssueType definition', async () => {
    const apiTypes = await getApiDocIssueTypes();

    const missing = VERIFY_ISSUE_TYPES.filter((t) => !apiTypes.includes(t));
    assert.deepEqual(
      missing,
      [],
      `Issue types in VERIFY_ISSUE_TYPES but not in docs/api.md: ${missing.join(', ')}`,
    );

    const extra = apiTypes.filter(
      (t) =>
        !VERIFY_ISSUE_TYPES.includes(t as (typeof VERIFY_ISSUE_TYPES)[number]),
    );
    assert.deepEqual(
      extra,
      [],
      `Issue types in docs/api.md but not in VERIFY_ISSUE_TYPES: ${extra.join(', ')}`,
    );
  });

  it('VERIFY_ISSUE_TYPES matches README.md Severity Mapping table', async () => {
    const severityTypes = await getReadmeSeverityMappingTypes();

    const missing = VERIFY_ISSUE_TYPES.filter(
      (t) => !severityTypes.includes(t),
    );
    assert.deepEqual(
      missing,
      [],
      `Issue types in VERIFY_ISSUE_TYPES but not in README.md Severity Mapping table: ${missing.join(', ')}`,
    );

    const extra = severityTypes.filter(
      (t) =>
        !VERIFY_ISSUE_TYPES.includes(t as (typeof VERIFY_ISSUE_TYPES)[number]),
    );
    assert.deepEqual(
      extra,
      [],
      `Issue types in README.md Severity Mapping table but not in VERIFY_ISSUE_TYPES: ${extra.join(', ')}`,
    );
  });

  it('VERIFY_ISSUE_TYPES has no duplicates', () => {
    const unique = new Set(VERIFY_ISSUE_TYPES);
    assert.equal(
      unique.size,
      VERIFY_ISSUE_TYPES.length,
      `VERIFY_ISSUE_TYPES contains duplicates`,
    );
  });
});
