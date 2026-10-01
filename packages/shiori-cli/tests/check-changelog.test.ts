import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
