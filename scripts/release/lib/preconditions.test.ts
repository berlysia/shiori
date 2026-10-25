import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkPublishable,
  checkResume,
  checkVersionApplied,
  parseStatus,
  type PublishInput,
  type ResumeInput,
} from './preconditions.ts';
import { parseVersion, type ValidVersion } from './semver.ts';

function version(text: string): ValidVersion {
  const parsed = parseVersion(text);
  if (!parsed.ok) throw new Error('fixture version');
  return parsed.version;
}
const V = version('0.3.1');

describe('parseStatus', () => {
  const IGNORED = ['@berlysia/shiori-daemon', '@berlysia/shiori-vscode'];
  const status = (releases: object[]) =>
    JSON.stringify({ changesets: [], releases });
  const release = (name: string, type: string, changesets: unknown = []) => ({
    name,
    type,
    oldVersion: '0.1.0',
    changesets,
    newVersion: '0.3.1',
  });
  const shiori = release('@berlysia/shiori', 'minor', ['x']);
  const daemon = (type: string, changesets: unknown = []) =>
    release('@berlysia/shiori-daemon', type, changesets);

  it('reads the one release', () => {
    assert.deepEqual(parseStatus(status([shiori]), IGNORED), {
      kind: 'release',
      version: '0.3.1',
    });
  });
  it('passes shiori minor with the daemon as a changeset-less patch (changesets 2.29.8 after pre exit)', () => {
    assert.deepEqual(parseStatus(status([shiori, daemon('patch')]), IGNORED), {
      kind: 'release',
      version: '0.3.1',
    });
  });
  it('is none when shiori is none and only the daemon is patch', () => {
    assert.deepEqual(
      parseStatus(
        status([release('@berlysia/shiori', 'none'), daemon('patch')]),
        IGNORED,
      ),
      { kind: 'none' },
    );
  });
  it('is none when shiori is missing', () => {
    assert.deepEqual(parseStatus(status([daemon('patch')]), IGNORED), {
      kind: 'none',
    });
  });
  it('fails for a live name outside the ignore list', () => {
    assert.equal(
      parseStatus(
        status([shiori, release('@berlysia/other', 'patch')]),
        IGNORED,
      ).kind,
      'failed',
    );
  });
  it('fails when the daemon has a changeset behind it, or a non-array changesets', () => {
    assert.equal(
      parseStatus(status([shiori, daemon('patch', ['x'])]), IGNORED).kind,
      'failed',
    );
    assert.equal(
      parseStatus(status([shiori, daemon('patch', 'x')]), IGNORED).kind,
      'failed',
    );
  });
  it('fails for a daemon release when the ignore list does not name it', () => {
    assert.equal(
      parseStatus(status([shiori, daemon('patch')]), []).kind,
      'failed',
    );
  });
  it('fails on non-JSON and a missing list', () => {
    assert.equal(parseStatus('[', IGNORED).kind, 'failed');
    assert.equal(parseStatus('{}', IGNORED).kind, 'failed');
    assert.equal(parseStatus(status([{ name: 1 }]), IGNORED).kind, 'failed');
  });
});

describe('checkVersionApplied', () => {
  it('passes a matching stable version outside pre mode', () => {
    assert.deepEqual(
      checkVersionApplied({ expected: V, actual: '0.3.1', preMode: false }),
      [],
    );
  });
  it('fails when the version after `changeset version` differs from status', () => {
    assert.equal(
      checkVersionApplied({ expected: V, actual: '0.3.2', preMode: false })
        .length,
      1,
    );
  });
  it('fails a stable version in pre mode and a prerelease outside it', () => {
    assert.equal(
      checkVersionApplied({ expected: V, actual: '0.3.1', preMode: true })
        .length,
      1,
    );
    const rc = version('0.4.0-rc.0');
    assert.equal(
      checkVersionApplied({
        expected: rc,
        actual: '0.4.0-rc.0',
        preMode: false,
      }).length,
      1,
    );
    assert.deepEqual(
      checkVersionApplied({
        expected: rc,
        actual: '0.4.0-rc.0',
        preMode: true,
      }),
      [],
    );
  });
});

describe('checkPublishable', () => {
  const changelog =
    '## [Unreleased]\n\n## [0.3.1] - 2026-11-01\n\n### Fixed\n\n- x\n\n## [0.3.0] - 2026-10-25\n';
  const base: PublishInput = {
    version: V,
    changelog,
    npm: {
      kind: 'published',
      versions: ['0.3.0'],
      distTags: { latest: '0.3.0' },
    },
    localTag: undefined,
    originTag: undefined,
  };
  it('passes a publishable stable release', () => {
    assert.deepEqual(checkPublishable(base), []);
  });
  it('fails when the version is published', () => {
    assert.equal(
      checkPublishable({
        ...base,
        npm: {
          kind: 'published',
          versions: ['0.3.0', '0.3.1'],
          distTags: { latest: '0.3.0' },
        },
      }).length,
      1,
    );
  });
  it('fails a stable version that is not newer than latest', () => {
    const same = version('0.3.0');
    const reasons = checkPublishable({
      ...base,
      version: same,
      changelog: changelog.replace('0.3.1', '0.3.0'),
      npm: { kind: 'published', versions: [], distTags: { latest: '0.3.0' } },
    });
    assert.equal(reasons.length, 1);
  });
  it('fails when a tag exists locally or on origin', () => {
    assert.equal(checkPublishable({ ...base, localTag: 'a' }).length, 1);
    assert.equal(checkPublishable({ ...base, originTag: 'a' }).length, 1);
  });
  it('fails without a section and with an empty one', () => {
    assert.equal(
      checkPublishable({ ...base, changelog: '## [Unreleased]\n' }).length,
      1,
    );
    assert.equal(
      checkPublishable({
        ...base,
        changelog: '## [0.3.1] - 2026-11-01\n\n## [0.3.0] - 2026-10-25\n',
      }).length,
      1,
    );
  });
  it('does not ask a prerelease for a section or a newer latest', () => {
    const rc = version('0.3.1-rc.0');
    assert.deepEqual(
      checkPublishable({ ...base, version: rc, changelog: '' }),
      [],
    );
  });
});

describe('checkResume', () => {
  const sha = 'a'.repeat(40);
  const pkg = (v: string, extra: object = {}) =>
    JSON.stringify({ name: 'x', version: v, ...extra }, null, 2);
  const ver = (v: string, other = 'a') =>
    `export const VERSION = '${v}';\nexport const O = '${other}';\n`;
  const log = '# C\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-01\n\n- a\n';
  const grown =
    '# C\n\n## [Unreleased]\n\n## [0.3.1] - 2026-11-01\n\n### Fixed\n\n- x\n\n## [0.3.0] - 2026-10-01\n\n- a\n';
  const good: ResumeInput = {
    version: V,
    headMessage: 'chore: release v0.3.1',
    headParent: sha,
    originMaster: sha,
    headPackageVersion: '0.3.1',
    headChanges: [
      { path: 'packages/shiori-cli/package.json', state: 'M' },
      { path: 'packages/shiori-cli/src/core/version.ts', state: 'M' },
      { path: 'CHANGELOG.md', state: 'M' },
      { path: '.changeset/a-b.md', state: 'D' },
    ],
    packageJson: { before: pkg('0.3.0'), after: pkg('0.3.1') },
    versionTs: { before: ver('0.3.0'), after: ver('0.3.1') },
    changelog: { before: log, after: grown },
  };
  it('passes the commit stage 5 would make', () => {
    assert.deepEqual(checkResume(good), []);
  });
  it('fails when the parent is not origin/master', () => {
    assert.equal(
      checkResume({ ...good, headParent: 'b'.repeat(40) }).length,
      1,
    );
  });
  it('fails when the message version and package.json version differ', () => {
    assert.ok(
      checkResume({ ...good, headPackageVersion: '0.3.2' }).length >= 1,
    );
    assert.ok(
      checkResume({ ...good, headMessage: 'chore: release v0.3.2' }).length >=
        1,
    );
  });
  it('fails when package.json scripts.postinstall was added', () => {
    const reasons = checkResume({
      ...good,
      packageJson: {
        before: pkg('0.3.0'),
        after: pkg('0.3.1', { scripts: { postinstall: 'x' } }),
      },
    });
    assert.ok(reasons.some((r) => r.includes('package.json changed in more')));
  });
  it('fails when another line of version.ts changed', () => {
    const reasons = checkResume({
      ...good,
      versionTs: { before: ver('0.3.0'), after: ver('0.3.1', 'b') },
    });
    assert.ok(reasons.some((r) => r.includes('version.ts')));
  });
  it('fails when the commit touches a file outside the allow list', () => {
    const reasons = checkResume({
      ...good,
      headChanges: [
        ...good.headChanges,
        { path: '.github/workflows/release.yml', state: 'M' },
      ],
    });
    assert.ok(reasons.some((r) => r.includes('outside the allow list')));
  });
  it('fails when CHANGELOG.md edits an older section', () => {
    const reasons = checkResume({
      ...good,
      changelog: { before: log, after: grown.replace('- a', '- b') },
    });
    assert.ok(reasons.some((r) => r.includes('CHANGELOG.md')));
  });
});
