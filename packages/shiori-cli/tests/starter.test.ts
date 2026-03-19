import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STARTER_KINDS,
  STARTER_LABELS,
  generateStarter,
} from '../src/templates/starter.ts';

describe('starter templates', () => {
  it('STARTER_KINDS and STARTER_LABELS are in sync', () => {
    for (const kind of STARTER_KINDS) {
      assert.ok(
        kind in STARTER_LABELS,
        `Missing label for starter kind: ${kind}`,
      );
    }
    const labelKeys = Object.keys(STARTER_LABELS);
    assert.equal(labelKeys.length, STARTER_KINDS.length);
  });

  for (const kind of STARTER_KINDS) {
    describe(`${kind} template`, () => {
      it('generates at least one sample file', () => {
        const result = generateStarter(kind);
        assert.ok(result.files.length > 0, 'Should have at least one file');
      });

      it('generates non-empty file content', () => {
        const result = generateStarter(kind);
        for (const file of result.files) {
          assert.ok(file.path.length > 0, 'File path should not be empty');
          assert.ok(
            file.content.length > 0,
            'File content should not be empty',
          );
        }
      });

      it('generates registry entries', () => {
        const result = generateStarter(kind);
        const refs = Object.keys(result.registry);
        assert.ok(refs.length > 0, 'Should have at least one registry entry');
      });

      it('generates scan patterns', () => {
        const result = generateStarter(kind);
        assert.ok(
          result.scanPatterns.length > 0,
          'Should have at least one scan pattern',
        );
      });

      it('sample files contain shiori: annotations matching registry refs', () => {
        const result = generateStarter(kind);
        const refs = Object.keys(result.registry);
        const allContent = result.files.map((f) => f.content).join('\n');
        for (const ref of refs) {
          assert.ok(
            allContent.includes(`shiori: ${ref}`),
            `Sample files should contain "shiori: ${ref}"`,
          );
        }
      });

      it('registry entries have non-placeholder reason', () => {
        const result = generateStarter(kind);
        for (const [ref, entry] of Object.entries(result.registry)) {
          assert.ok(
            !entry.reason.startsWith('TODO:'),
            `Registry entry ${ref} should have a real reason, not a placeholder`,
          );
        }
      });
    });
  }

  it('all four templates produce EXAMPLE-001 ref', () => {
    for (const kind of STARTER_KINDS) {
      const result = generateStarter(kind);
      assert.ok(
        'EXAMPLE-001' in result.registry,
        `${kind} template should produce EXAMPLE-001 ref`,
      );
    }
  });
});
