import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasChangelogSection,
  requiresChangelogSection,
} from '../scripts/check-changelog.ts';

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.2] - 2026-10-02

### Fixed

- something

## [0.2.0] - 2026-03-23
`;

describe('check-changelog', () => {
  describe('requiresChangelogSection', () => {
    it('requires a section for a stable version', () => {
      assert.equal(requiresChangelogSection('0.2.2'), true);
    });

    it('skips prereleases', () => {
      assert.equal(requiresChangelogSection('0.2.2-rc.1'), false);
      assert.equal(requiresChangelogSection('0.3.0-beta.2'), false);
    });
  });

  describe('hasChangelogSection', () => {
    it('finds a dated version heading', () => {
      assert.equal(hasChangelogSection(CHANGELOG, '0.2.2'), true);
    });

    it('does not match a version that only appears as a prefix', () => {
      assert.equal(hasChangelogSection(CHANGELOG, '0.2.'), false);
      assert.equal(hasChangelogSection(CHANGELOG, '0.2'), false);
    });

    it('reports a missing version', () => {
      assert.equal(hasChangelogSection(CHANGELOG, '0.2.1'), false);
    });

    it('does not treat Unreleased as the version', () => {
      assert.equal(hasChangelogSection(CHANGELOG, 'Unreleased'), false);
    });
  });

  describe('wiring', () => {
    // Both release paths must run the guard: the local release script and the tag-triggered workflow.
    const guardCommand =
      'node --experimental-strip-types packages/shiori-cli/scripts/check-changelog.ts';

    it('runs in the release script after the bump', () => {
      const rootPackageJson = JSON.parse(
        readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
      ) as { scripts: Record<string, string> };
      assert.ok(
        rootPackageJson.scripts['release']?.includes(
          `--execute "${guardCommand}"`,
        ),
      );
    });

    it('runs in the release workflow before packing', () => {
      const workflow = readFileSync(
        new URL('../../../.github/workflows/release.yml', import.meta.url),
        'utf8',
      );
      const guardAt = workflow.indexOf(`run: ${guardCommand}`);
      assert.ok(guardAt > 0);
      assert.ok(guardAt < workflow.indexOf('name: Pack npm tarball'));
    });
  });
});
