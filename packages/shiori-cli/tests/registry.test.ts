import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRegistry, saveRegistry } from '../src/core/registry.ts';
import type { Registry } from '../src/core/types.ts';

const sampleRegistry: Registry = {
  'SUP-1001': {
    reason: 'vendor prefix fallback',
    target: 'iOS Safari < 17.4',
    expires: '2026-06-01',
    ticket: 'JIRA-100',
    owner: undefined,
    notes: undefined,
    kind: 'intentional',
  },
  'SUP-1002': {
    reason: 'grid not supported in old browsers',
    target: 'IE 11',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: 'intentional',
  },
};

describe('registry', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-registry-'));
  });

  after(async () => {
    // Best-effort cleanup
    const { readdir } = await import('node:fs/promises');
    try {
      for (const f of await readdir(tmpDir)) {
        await unlink(join(tmpDir, f)).catch(() => {});
      }
    } catch {
      // ignore
    }
  });

  describe('loadRegistry', () => {
    it('loads a JSON file', async () => {
      const filePath = join(tmpDir, 'test.json');
      await writeFile(
        filePath,
        JSON.stringify({
          'REF-1': { reason: 'test', target: 'all' },
        }),
      );
      const { registry, errors } = await loadRegistry(filePath);
      assert.equal(errors.length, 0);
      assert.equal(registry['REF-1']!.reason, 'test');
    });

    it('loads a .yaml file', async () => {
      const filePath = join(tmpDir, 'test.yaml');
      await writeFile(filePath, 'REF-1:\n  reason: test\n  target: all\n');
      const { registry, errors } = await loadRegistry(filePath);
      assert.equal(errors.length, 0);
      assert.equal(registry['REF-1']!.reason, 'test');
    });

    it('loads a .yml file', async () => {
      const filePath = join(tmpDir, 'test.yml');
      await writeFile(filePath, 'REF-1:\n  reason: test\n  target: all\n');
      const { registry, errors } = await loadRegistry(filePath);
      assert.equal(errors.length, 0);
      assert.equal(registry['REF-1']!.reason, 'test');
    });

    it('throws on unsupported extension', async () => {
      const filePath = join(tmpDir, 'test.txt');
      await writeFile(filePath, '{}');
      await assert.rejects(() => loadRegistry(filePath), {
        message: /Unsupported registry file extension "\.txt"/,
      });
    });

    it('validates YAML entries (missing reason)', async () => {
      const filePath = join(tmpDir, 'bad.yaml');
      await writeFile(filePath, 'REF-1:\n  target: all\n');
      const { errors } = await loadRegistry(filePath);
      assert.ok(errors.length > 0);
      assert.ok(errors.some((e) => e.message.includes('reason')));
    });

    it('preserves expires as string in YAML', async () => {
      const filePath = join(tmpDir, 'dates.yaml');
      await writeFile(
        filePath,
        'REF-1:\n  reason: test\n  target: all\n  expires: "2026-06-01"\n',
      );
      const { registry } = await loadRegistry(filePath);
      assert.equal(typeof registry['REF-1']!.expires, 'string');
      assert.equal(registry['REF-1']!.expires, '2026-06-01');
    });
  });

  describe('saveRegistry', () => {
    it('saves as JSON', async () => {
      const filePath = join(tmpDir, 'out.json');
      await saveRegistry(filePath, sampleRegistry);
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      assert.equal(parsed['SUP-1001'].reason, 'vendor prefix fallback');
    });

    it('saves as YAML', async () => {
      const filePath = join(tmpDir, 'out.yaml');
      await saveRegistry(filePath, sampleRegistry);
      const content = await readFile(filePath, 'utf-8');
      // YAML output should not contain null for undefined fields
      assert.ok(!content.includes(': null'));
      assert.ok(content.includes('vendor prefix fallback'));
    });

    it('does not emit null for undefined fields in YAML', async () => {
      const filePath = join(tmpDir, 'no-null.yaml');
      const registry: Registry = {
        'REF-1': {
          reason: 'test',
          target: 'all',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: 'intentional',
        },
      };
      await saveRegistry(filePath, registry);
      const content = await readFile(filePath, 'utf-8');
      assert.ok(
        !content.includes('null'),
        `YAML should not contain null: ${content}`,
      );
    });
  });

  describe('round-trip', () => {
    it('JSON save then load preserves content', async () => {
      const filePath = join(tmpDir, 'roundtrip.json');
      await saveRegistry(filePath, sampleRegistry);
      const { registry } = await loadRegistry(filePath);
      assert.equal(registry['SUP-1001']!.reason, 'vendor prefix fallback');
      assert.equal(registry['SUP-1001']!.expires, '2026-06-01');
      assert.equal(registry['SUP-1001']!.ticket, 'JIRA-100');
      assert.equal(registry['SUP-1002']!.target, 'IE 11');
    });

    it('YAML save then load preserves content', async () => {
      const filePath = join(tmpDir, 'roundtrip.yaml');
      await saveRegistry(filePath, sampleRegistry);
      const { registry } = await loadRegistry(filePath);
      assert.equal(registry['SUP-1001']!.reason, 'vendor prefix fallback');
      assert.equal(registry['SUP-1001']!.expires, '2026-06-01');
      assert.equal(registry['SUP-1001']!.ticket, 'JIRA-100');
      assert.equal(registry['SUP-1002']!.target, 'IE 11');
    });
  });
});
