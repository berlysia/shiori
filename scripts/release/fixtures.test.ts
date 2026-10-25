// Secret scan of the recorded real outputs. They are committed, so a token,
// an email address or a node_id slipping in would be published with the repo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

const FORBIDDEN: readonly [RegExp, string][] = [
  [/npm_/, 'npm_ token prefix'],
  [/ghp_/, 'ghp_ token prefix'],
  [/gho_/, 'gho_ token prefix'],
  [/github_pat_/, 'github_pat_ token prefix'],
  [/[^\s"'@/]+@[^\s"'@/]+\.[A-Za-z]{2,}/, 'email address'],
  [/node_id/, 'node_id'],
];

describe('fixtures', () => {
  const names = readdirSync(FIXTURES).filter((name) => name.endsWith('.json'));

  it('has the five recorded outputs', () => {
    assert.deepEqual(names.sort(), [
      'gh-environment-policies.json',
      'gh-environment.json',
      'gh-ruleset-detail.json',
      'gh-rulesets.json',
      'trust-list.json',
    ]);
  });

  for (const name of names) {
    it(`${name} is valid JSON without secrets`, () => {
      const text = readFileSync(join(FIXTURES, name), 'utf8');
      JSON.parse(text);
      for (const [pattern, label] of FORBIDDEN) {
        assert.equal(pattern.test(text), false, `${name} contains ${label}`);
      }
    });
  }
});
