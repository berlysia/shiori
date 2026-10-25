import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideEntry,
  pushRetryCommands,
  type EntryObservation,
  type StatusObservation,
} from './entry.ts';
import { parseVersion, type ValidVersion } from './semver.ts';
import type { WorkingChange } from './types.ts';

const parsed = parseVersion('0.3.1');
if (!parsed.ok) throw new Error('fixture version');
const V: ValidVersion = parsed.version;
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const PKG = 'packages/shiori-cli/package.json';

function observation(
  overrides: Partial<EntryObservation> = {},
): EntryObservation {
  return {
    flags: { mode: 'normal' },
    head: HEAD,
    headMessage: 'feat: something',
    workingTree: [],
    version: { kind: 'ok', value: V },
    localTag: undefined,
    originTag: { kind: 'ok', value: undefined },
    npm: {
      kind: 'published',
      versions: ['0.3.0'],
      distTags: { latest: '0.3.0' },
    },
    preMode: false,
    ...overrides,
  };
}
const publishedV = {
  kind: 'published',
  versions: ['0.3.0', '0.3.1'],
  distTags: { latest: '0.3.1' },
} as const;
const release: StatusObservation = { kind: 'release', version: '0.3.2' };
const none: StatusObservation = { kind: 'none' };

function stopOf(decision: ReturnType<typeof decideEntry>) {
  assert.equal(decision.kind, 'stop', JSON.stringify(decision));
  if (decision.kind !== 'stop') throw new Error('unreachable');
  return decision;
}

const pkgText = (version: string, extra: object = {}) =>
  JSON.stringify({ name: 'x', version, ...extra }, null, 2);
const change = (
  path: string,
  state: WorkingChange['state'],
  before?: string,
  after?: string,
): WorkingChange => ({ path, state, before, after });

describe('decideEntry', () => {
  it('row 0: an npm view failure other than E404 stops', () => {
    const decision = stopOf(
      decideEntry(observation({ npm: { kind: 'failed', error: 'E500' } })),
    );
    assert.equal(decision.row, 0);
  });
  it('row 0: an unreadable version or ls-remote failure stops', () => {
    assert.equal(
      stopOf(
        decideEntry(observation({ version: { kind: 'error', error: 'x' } })),
      ).row,
      0,
    );
    assert.equal(
      stopOf(
        decideEntry(observation({ originTag: { kind: 'error', error: 'x' } })),
      ).row,
      0,
    );
  });

  it('row 1: leftovers of a version bump only get the reset command and a warning', () => {
    const decision = stopOf(
      decideEntry(
        observation({
          workingTree: [
            change(PKG, 'M', pkgText('0.3.0'), pkgText('0.3.1')),
            change(
              'packages/shiori-cli/src/core/version.ts',
              'M',
              "export const VERSION = '0.3.0';\n",
              "export const VERSION = '0.3.1';\n",
            ),
          ],
        }),
      ),
    );
    assert.equal(decision.row, 1);
    assert.ok(
      decision.commands.some((c) => c.includes('git reset --hard HEAD')),
    );
    assert.match(decision.reason, /discards ALL uncommitted changes/);
  });
  it('row 1: an unrelated untracked changeset withholds the destructive command', () => {
    const decision = stopOf(
      decideEntry(
        observation({
          workingTree: [
            change(PKG, 'M', pkgText('0.3.0'), pkgText('0.3.1')),
            change('.changeset/mine.md', '??', undefined, 'x'),
          ],
        }),
      ),
    );
    assert.equal(decision.row, 1);
    const text = [...decision.commands, decision.reason].join('\n');
    assert.doesNotMatch(text, /git reset|git clean/);
    assert.match(text, /commit or stash/);
  });
  it('row 1: a hand-written dependency in package.json withholds the destructive command', () => {
    const decision = stopOf(
      decideEntry(
        observation({
          workingTree: [
            change(
              PKG,
              'M',
              pkgText('0.3.0'),
              pkgText('0.3.0', { dependencies: { a: '1' } }),
            ),
          ],
        }),
      ),
    );
    assert.doesNotMatch(decision.commands.join('\n'), /git reset|git clean/);
  });
  it('priority: a dirty tree beats a local-only tag', () => {
    const decision = stopOf(
      decideEntry(
        observation({
          localTag: HEAD,
          workingTree: [change('notes.txt', '??', undefined, 'x')],
        }),
      ),
    );
    assert.equal(decision.row, 1);
  });

  it('row 2: origin tag at HEAD, unpublished -> after-push', () => {
    assert.deepEqual(
      decideEntry(observation({ originTag: { kind: 'ok', value: HEAD } })),
      { kind: 'after-push' },
    );
  });

  describe('row 3', () => {
    const published = observation({
      originTag: { kind: 'ok', value: HEAD },
      npm: publishedV,
    });
    it('asks for status first', () => {
      assert.deepEqual(decideEntry(published), { kind: 'need-status' });
    });
    it('check-only when status shows no release', () => {
      assert.deepEqual(decideEntry(published, none), { kind: 'check-only' });
    });
    it('front (row 8) when status shows a release', () => {
      assert.deepEqual(decideEntry(published, release), {
        kind: 'front',
        row: 8,
      });
    });
    it('front (row 7) with --pre', () => {
      assert.deepEqual(
        decideEntry({ ...published, flags: { mode: 'pre', tag: 'rc' } }),
        { kind: 'front', row: 7 },
      );
    });
  });

  it('row 4: origin tag at another commit, unpublished', () => {
    const decision = stopOf(
      decideEntry(observation({ originTag: { kind: 'ok', value: OTHER } })),
    );
    assert.equal(decision.row, 4);
    assert.ok(decision.commands.includes('git switch --detach v0.3.1'));
  });

  it('row 5: local tag only', () => {
    const decision = stopOf(decideEntry(observation({ localTag: HEAD })));
    assert.equal(decision.row, 5);
    assert.equal(decision.commands.length, 2);
    assert.ok(decision.commands[0]?.includes('git rev-parse v0.3.1^{commit}'));
    assert.ok(
      decision.commands[0]?.includes(
        'git push --atomic origin refs/heads/master:refs/heads/master refs/tags/v0.3.1:refs/tags/v0.3.1',
      ),
    );
    assert.deepEqual(decision.commands, pushRetryCommands(V));
  });

  describe('row 6', () => {
    const resumable = observation({ headMessage: 'chore: release v0.3.1' });
    it('resumes at the tag', () => {
      assert.deepEqual(decideEntry(resumable), { kind: 'resume-tag' });
    });
    it('stops when flags are given', () => {
      const decision = stopOf(
        decideEntry({ ...resumable, flags: { mode: 'pre', tag: 'rc' } }),
      );
      assert.equal(decision.row, 6);
    });
    it('is not row 6 when origin has the tag', () => {
      const decision = decideEntry({
        ...resumable,
        originTag: { kind: 'ok', value: OTHER },
      });
      assert.equal(stopOf(decision).row, 4);
      assert.deepEqual(
        decideEntry({ ...resumable, originTag: { kind: 'ok', value: HEAD } }),
        { kind: 'after-push' },
      );
    });
    it('is not row 6 when published', () => {
      assert.deepEqual(decideEntry({ ...resumable, npm: publishedV }), {
        kind: 'need-status',
      });
    });
  });

  describe('row 7', () => {
    it('--exit-pre in pre mode goes to the front half', () => {
      assert.deepEqual(
        decideEntry(
          observation({ flags: { mode: 'exit-pre' }, preMode: true }),
        ),
        { kind: 'front', row: 7 },
      );
    });
    it('--exit-pre without pre mode also goes to the front half (stage 2 stops it)', () => {
      assert.deepEqual(
        decideEntry(observation({ flags: { mode: 'exit-pre' } })),
        { kind: 'front', row: 7 },
      );
    });
  });

  it('row 8: status shows a release', () => {
    assert.deepEqual(decideEntry(observation(), release), {
      kind: 'front',
      row: 8,
    });
    assert.deepEqual(decideEntry(observation()), { kind: 'need-status' });
  });
  it('row 9: pre mode and no release in status', () => {
    assert.equal(
      stopOf(decideEntry(observation({ preMode: true }), none)).row,
      9,
    );
  });
  it('row 10: nothing to release', () => {
    assert.equal(stopOf(decideEntry(observation(), none)).row, 10);
  });
  it('row 11: status failed', () => {
    assert.equal(
      stopOf(decideEntry(observation(), { kind: 'failed', error: 'x' })).row,
      11,
    );
  });
});
