import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasChangelogItems,
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

  describe('hasChangelogItems', () => {
    it('is false for a heading directly followed by the next section', () => {
      const text =
        '## [Unreleased]\n\n## [0.3.1] - 2026-11-01\n\n## [0.3.0] - 2026-10-25\n\n- a\n';
      assert.equal(hasChangelogItems(text, '0.3.1'), false);
    });

    it('is true when an item follows a subheading', () => {
      const text =
        '## [0.3.1] - 2026-11-01\n\n### Fixed\n\n- x\n\n## [0.3.0] - 2026-10-25\n';
      assert.equal(hasChangelogItems(text, '0.3.1'), true);
    });

    it('is true for a last section that ends with an item', () => {
      assert.equal(
        hasChangelogItems(
          '## [0.3.1] - 2026-11-01\n\n### Fixed\n\n- x\n',
          '0.3.1',
        ),
        true,
      );
    });

    it('is false for a last section that ends with a subheading', () => {
      assert.equal(
        hasChangelogItems('## [0.3.1] - 2026-11-01\n\n### Fixed\n', '0.3.1'),
        false,
      );
    });

    it('is false for "* " items', () => {
      assert.equal(
        hasChangelogItems(
          '## [0.3.1] - 2026-11-01\n\n### Fixed\n\n* x\n',
          '0.3.1',
        ),
        false,
      );
    });

    it('is true for the current CHANGELOG.md and 0.3.0', () => {
      const changelog = readFileSync(
        new URL('../../../CHANGELOG.md', import.meta.url),
        'utf8',
      );
      assert.equal(hasChangelogItems(changelog, '0.3.0'), true);
    });

    it('is not asked about a prerelease: main skips it', () => {
      assert.equal(requiresChangelogSection('0.4.0-rc.0'), false);
    });
  });

  describe('wiring', () => {
    // Both release paths check the section: the local release script (which
    // builds it) and the tag-triggered workflow (which runs this guard).
    const guardCommand =
      'node --experimental-strip-types packages/shiori-cli/scripts/check-changelog.ts';

    it('is checked by the release script itself (stage 3), not by a separate command', () => {
      const rootPackageJson = JSON.parse(
        readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
      ) as { scripts: Record<string, string> };
      assert.equal(
        rootPackageJson.scripts['release'],
        'node --experimental-strip-types scripts/release/release.ts',
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
