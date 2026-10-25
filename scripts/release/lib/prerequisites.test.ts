import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkChangesetConfig,
  checkEnvironment,
  checkOrigin,
  checkRulesets,
  checkTools,
  checkTrust,
  parseRulesetIds,
} from './prerequisites.ts';
import type { RunResult } from './types.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const out = (stdout: string, code = 0, stderrTail = ''): RunResult => ({
  code,
  stdout,
  stderrTail,
});
const kind = (result: { kind: string }): string => result.kind;

describe('checkTrust', () => {
  const entry = JSON.parse(fixture('trust-list.json')) as Record<
    string,
    unknown
  >;
  it('accepts the recorded object', () => {
    assert.equal(kind(checkTrust(out(fixture('trust-list.json')))), 'ok');
  });
  it('accepts the same entry as a one-element array', () => {
    assert.equal(kind(checkTrust(out(JSON.stringify([entry])))), 'ok');
  });
  it('accepts an unknown extra field', () => {
    assert.equal(
      kind(checkTrust(out(JSON.stringify({ ...entry, createdAt: 'x' })))),
      'ok',
    );
  });
  it('rejects two entries (a leftover publish.yml)', () => {
    const old = {
      ...entry,
      file: 'publish.yml',
      permissions: ['createPackage'],
    };
    assert.equal(
      kind(checkTrust(out(JSON.stringify([entry, old])))),
      'mismatch',
    );
  });
  it('rejects createPackage', () => {
    assert.equal(
      kind(
        checkTrust(
          out(JSON.stringify({ ...entry, permissions: ['createPackage'] })),
        ),
      ),
      'mismatch',
    );
  });
  it('rejects extra permissions', () => {
    assert.equal(
      kind(
        checkTrust(
          out(
            JSON.stringify({
              ...entry,
              permissions: ['createStagedPackage', 'createPackage'],
            }),
          ),
        ),
      ),
      'mismatch',
    );
  });
  it('reads a missing permissions field, an empty output and a bad type as unknown shape', () => {
    const { permissions: _drop, ...without } = entry;
    assert.equal(
      kind(checkTrust(out(JSON.stringify(without)))),
      'shape-unknown',
    );
    assert.equal(kind(checkTrust(out(''))), 'shape-unknown');
    assert.equal(kind(checkTrust(out('["x"]'))), 'shape-unknown');
    assert.equal(
      kind(checkTrust(out(JSON.stringify({ ...entry, id: 7 })))),
      'shape-unknown',
    );
    assert.equal(
      kind(
        checkTrust(out(JSON.stringify({ ...entry, permissions: ['a', 1] }))),
      ),
      'shape-unknown',
    );
  });
  it('reports eotp from stderr or from the JSON error', () => {
    assert.equal(kind(checkTrust(out('', 1, 'npm error code EOTP'))), 'eotp');
    assert.equal(kind(checkTrust(out('{"error":{"code":"EOTP"}}', 1))), 'eotp');
  });
  it('reports eotp even with exit code 0 and a correct entry', () => {
    assert.equal(
      kind(checkTrust(out(fixture('trust-list.json'), 0, 'EOTP required'))),
      'eotp',
    );
  });
  it('reports a non-zero exit with non-JSON output as command-failed', () => {
    assert.equal(kind(checkTrust(out('boom', 1))), 'command-failed');
  });
});

describe('checkEnvironment', () => {
  const env = fixture('gh-environment.json');
  const policies = fixture('gh-environment-policies.json');
  it('accepts the recorded environment', () => {
    assert.equal(kind(checkEnvironment(out(env), out(policies))), 'ok');
  });
  it('rejects custom_branch_policies false and a null policy', () => {
    const base = JSON.parse(env) as Record<string, unknown>;
    assert.equal(
      kind(
        checkEnvironment(
          out(
            JSON.stringify({
              ...base,
              deployment_branch_policy: {
                protected_branches: false,
                custom_branch_policies: false,
              },
            }),
          ),
          out(policies),
        ),
      ),
      'mismatch',
    );
    assert.equal(
      kind(
        checkEnvironment(
          out(JSON.stringify({ ...base, deployment_branch_policy: null })),
          out(policies),
        ),
      ),
      'mismatch',
    );
  });
  it('rejects a branch policy on master', () => {
    const list = {
      total_count: 1,
      branch_policies: [{ name: 'master', type: 'branch' }],
    };
    assert.equal(
      kind(checkEnvironment(out(env), out(JSON.stringify(list)))),
      'mismatch',
    );
  });
  it('rejects a second policy', () => {
    const list = {
      branch_policies: [
        { name: 'v*', type: 'tag' },
        { name: 'x*', type: 'tag' },
      ],
    };
    assert.equal(
      kind(checkEnvironment(out(env), out(JSON.stringify(list)))),
      'mismatch',
    );
  });
  it('reads non-JSON as unknown shape and a failed call as command-failed', () => {
    assert.equal(
      kind(checkEnvironment(out('nope'), out(policies))),
      'shape-unknown',
    );
    assert.equal(
      kind(checkEnvironment(out('', 1), out(policies))),
      'command-failed',
    );
  });
});

describe('rulesets', () => {
  const detail = fixture('gh-ruleset-detail.json');
  const branchRuleset = JSON.stringify({
    id: 25818366,
    name: 'master',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [],
    bypass_actors: [],
  });
  const change = (edit: (value: Record<string, unknown>) => void): string => {
    const value = JSON.parse(detail) as Record<string, unknown>;
    edit(value);
    return JSON.stringify(value);
  };

  it('reads ids from the recorded list', () => {
    assert.deepEqual(parseRulesetIds(out(fixture('gh-rulesets.json'))), {
      kind: 'ok',
      ids: [25818366, 24324650],
    });
  });
  it('accepts the recorded tag ruleset next to a branch ruleset', () => {
    assert.equal(kind(checkRulesets([out(branchRuleset), out(detail)])), 'ok');
  });
  it('rejects a user in bypass_actors', () => {
    const edited = change((v) => {
      v['bypass_actors'] = [
        { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
        { actor_id: 1, actor_type: 'User', bypass_mode: 'always' },
      ];
    });
    assert.equal(kind(checkRulesets([out(edited)])), 'mismatch');
  });
  it('rejects bypass_mode pull_request', () => {
    const edited = change((v) => {
      v['bypass_actors'] = [
        {
          actor_id: 5,
          actor_type: 'RepositoryRole',
          bypass_mode: 'pull_request',
        },
      ];
    });
    assert.equal(kind(checkRulesets([out(edited)])), 'mismatch');
  });
  it('rejects an exclude of refs/tags/v*', () => {
    const edited = change((v) => {
      v['conditions'] = {
        ref_name: { include: ['refs/tags/v*'], exclude: ['refs/tags/v*'] },
      };
    });
    assert.equal(kind(checkRulesets([out(edited)])), 'mismatch');
  });
  it('rejects a disabled ruleset and zero rulesets', () => {
    assert.equal(
      kind(
        checkRulesets([
          out(
            change((v) => {
              v['enforcement'] = 'disabled';
            }),
          ),
        ]),
      ),
      'mismatch',
    );
    assert.equal(kind(checkRulesets([])), 'mismatch');
  });
  it('distinguishes a failed call from an unreadable detail', () => {
    assert.equal(
      kind(checkRulesets([out(detail), out('', 1)])),
      'command-failed',
    );
    assert.equal(
      kind(checkRulesets([out(detail), out('nope')])),
      'shape-unknown',
    );
  });
});

describe('checkChangesetConfig', () => {
  const real = readFileSync(
    new URL('../../../.changeset/config.json', import.meta.url),
    'utf8',
  );
  it('accepts the real config', () => {
    assert.equal(kind(checkChangesetConfig(real)), 'ok');
  });
  it('rejects a module path as changelog', () => {
    const edited = JSON.stringify({ ...JSON.parse(real), changelog: './x.js' });
    assert.deepEqual(checkChangesetConfig(edited), {
      kind: 'mismatch',
      fields: ['changelog'],
    });
  });
  it('rejects an unknown key and non-JSON', () => {
    assert.equal(
      kind(
        checkChangesetConfig(JSON.stringify({ ...JSON.parse(real), extra: 1 })),
      ),
      'mismatch',
    );
    assert.equal(kind(checkChangesetConfig('{')), 'shape-unknown');
  });
});

describe('checkOrigin', () => {
  const url = (value: string) => out(`${value}\n`);
  it('accepts https and ssh forms of the repository', () => {
    assert.equal(
      kind(
        checkOrigin(
          url('https://github.com/berlysia/shiori.git'),
          url('git@github.com:berlysia/shiori'),
        ),
      ),
      'ok',
    );
  });
  it('rejects another repository and a different push URL', () => {
    assert.equal(
      kind(
        checkOrigin(
          url('https://github.com/someone/shiori.git'),
          url('https://github.com/someone/shiori.git'),
        ),
      ),
      'mismatch',
    );
    const result = checkOrigin(
      url('https://github.com/berlysia/shiori'),
      url('https://github.com/evil/shiori'),
    );
    assert.deepEqual(result, { kind: 'mismatch', fields: ['origin push URL'] });
  });
});

describe('checkTools', () => {
  const gh = out(
    'gh version 2.102.0 (2026-10-01)\nhttps://github.com/cli/cli\n',
  );
  const registry = out('https://registry.npmjs.org/\n');
  it('accepts npm 12.2.0', () => {
    assert.equal(kind(checkTools(out('12.2.0\n'), gh, registry)), 'ok');
  });
  it('rejects npm 12.1.0 and 13.0.0, and reads "abc" as unknown shape', () => {
    assert.equal(kind(checkTools(out('12.1.0'), gh, registry)), 'mismatch');
    assert.equal(kind(checkTools(out('13.0.0'), gh, registry)), 'mismatch');
    assert.equal(kind(checkTools(out('abc'), gh, registry)), 'shape-unknown');
  });
  it('rejects gh 2.44.0 and another registry', () => {
    assert.equal(
      kind(checkTools(out('12.2.0'), out('gh version 2.44.0 (x)'), registry)),
      'mismatch',
    );
    assert.equal(
      kind(checkTools(out('12.2.0'), gh, out('https://example.com/'))),
      'mismatch',
    );
  });
});
