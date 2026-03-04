import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  doctor,
  checkNodeVersion,
  checkConfig,
  checkRegistry,
  checkGitignore,
  checkRefPatternsConsistency,
  checkScanResultFreshness,
  checkExpiredEntries,
  checkRegistryCompleteness,
  formatDoctor,
  formatDoctorText,
} from '../src/commands/doctor.ts';
import type { ResolvedConfig } from '../src/core/config.ts';
import type { DoctorResult, Registry } from '../src/core/types.ts';

/** Create a partial ResolvedConfig for testing (only the fields under test) */
function partialConfig(partial: Partial<ResolvedConfig>): ResolvedConfig {
  return partial as unknown as ResolvedConfig;
}

async function createTempDir(prefix: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function setupShioriProject(
  dir: string,
  options?: {
    skipConfig?: boolean;
    skipRegistry?: boolean;
    skipGitignore?: boolean;
    configContent?: string;
    registryContent?: string;
    gitignoreContent?: string;
  },
): Promise<void> {
  const configDir = join(dir, '.config', 'shiori');
  await mkdir(configDir, { recursive: true });

  if (!options?.skipConfig) {
    const content = options?.configContent ?? '# shiori config\n';
    await writeFile(join(configDir, 'config.yaml'), content, 'utf-8');
  }

  if (!options?.skipRegistry) {
    const content = options?.registryContent ?? JSON.stringify({}, null, 2);
    await writeFile(join(configDir, 'registry.json'), content, 'utf-8');
  }

  if (!options?.skipGitignore) {
    const content =
      options?.gitignoreContent ?? '.config/shiori/scan-result.json\n';
    await writeFile(join(dir, '.gitignore'), content, 'utf-8');
  }
}

describe('checkNodeVersion', () => {
  it('returns pass for current Node.js version', () => {
    const result = checkNodeVersion();
    // We're running on Node.js >= 22.6.0 (as required by project)
    assert.equal(result.name, 'node-version');
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes(process.version));
  });
});

describe('checkConfig', () => {
  it('returns pass when config file exists and is valid', async () => {
    const { dir, cleanup } = await createTempDir('doctor-config-pass-');
    try {
      await setupShioriProject(dir);
      const result = await checkConfig(dir);
      assert.equal(result.name, 'config');
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('config.yaml'));
    } finally {
      await cleanup();
    }
  });

  it('returns warn when no config file exists', async () => {
    const { dir, cleanup } = await createTempDir('doctor-config-warn-');
    try {
      await setupShioriProject(dir, { skipConfig: true });
      const result = await checkConfig(dir);
      assert.equal(result.status, 'warn');
      assert.ok(result.message.includes('No config file'));
      assert.ok(result.fix);
    } finally {
      await cleanup();
    }
  });

  it('returns fail when config file has invalid syntax', async () => {
    const { dir, cleanup } = await createTempDir('doctor-config-fail-');
    try {
      await setupShioriProject(dir, {
        // Write invalid JSON as config.json (since YAML parser is lenient)
        skipConfig: true,
      });
      const configDir = join(dir, '.config', 'shiori');
      await writeFile(join(configDir, 'config.json'), '{bad json', 'utf-8');
      const result = await checkConfig(dir);
      assert.equal(result.status, 'fail');
      assert.ok(result.fix);
    } finally {
      await cleanup();
    }
  });

  it('respects custom configDir', async () => {
    const { dir, cleanup } = await createTempDir('doctor-config-custom-');
    try {
      const customDir = join(dir, 'custom-config');
      await mkdir(customDir, { recursive: true });
      await writeFile(join(customDir, 'config.yaml'), '# custom\n', 'utf-8');
      const result = await checkConfig(dir, 'custom-config');
      assert.equal(result.status, 'pass');
    } finally {
      await cleanup();
    }
  });
});

describe('checkRegistry', () => {
  it('returns pass when registry exists and is valid', async () => {
    const { dir, cleanup } = await createTempDir('doctor-reg-pass-');
    try {
      await setupShioriProject(dir, {
        registryContent: JSON.stringify(
          { 'TEST-001': { reason: 'test', target: 'a.ts' } },
          null,
          2,
        ),
      });
      const result = await checkRegistry(dir);
      assert.equal(result.name, 'registry');
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('1 entries'));
    } finally {
      await cleanup();
    }
  });

  it('returns fail when registry file is missing', async () => {
    const { dir, cleanup } = await createTempDir('doctor-reg-missing-');
    try {
      await setupShioriProject(dir, { skipRegistry: true });
      const result = await checkRegistry(dir);
      assert.equal(result.status, 'fail');
      assert.ok(result.message.includes('not found'));
      assert.ok(result.fix?.includes('shiori init'));
    } finally {
      await cleanup();
    }
  });

  it('returns fail when registry has invalid JSON', async () => {
    const { dir, cleanup } = await createTempDir('doctor-reg-invalid-');
    try {
      await setupShioriProject(dir, {
        registryContent: '{bad json',
      });
      const result = await checkRegistry(dir);
      assert.equal(result.status, 'fail');
    } finally {
      await cleanup();
    }
  });
});

describe('checkGitignore', () => {
  it('returns pass when scan-result.json is in .gitignore', async () => {
    const { dir, cleanup } = await createTempDir('doctor-gi-pass-');
    try {
      await setupShioriProject(dir);
      const result = await checkGitignore(dir);
      assert.equal(result.name, 'gitignore');
      assert.equal(result.status, 'pass');
    } finally {
      await cleanup();
    }
  });

  it('returns warn when scan-result.json is not in .gitignore', async () => {
    const { dir, cleanup } = await createTempDir('doctor-gi-miss-');
    try {
      await setupShioriProject(dir, {
        gitignoreContent: 'node_modules\ndist\n',
      });
      const result = await checkGitignore(dir);
      assert.equal(result.status, 'warn');
      assert.ok(result.fix);
    } finally {
      await cleanup();
    }
  });

  it('returns warn when .gitignore does not exist', async () => {
    const { dir, cleanup } = await createTempDir('doctor-gi-none-');
    try {
      await setupShioriProject(dir, { skipGitignore: true });
      const result = await checkGitignore(dir);
      assert.equal(result.status, 'warn');
      assert.ok(result.fix);
    } finally {
      await cleanup();
    }
  });
});

describe('doctor', () => {
  it('returns all checks passing for a fully set up project', async () => {
    const { dir, cleanup } = await createTempDir('doctor-full-');
    try {
      await setupShioriProject(dir);
      // Create scan-result.json for freshness check
      const scanResultPath = join(dir, '.config', 'shiori', 'scan-result.json');
      await writeFile(scanResultPath, '[]', 'utf-8');
      const result = await doctor({ cwd: dir });
      // node-version, config, registry, ref-patterns, expired-entries, registry-completeness, gitignore, scan-result
      assert.equal(result.checks.length, 8);
      assert.ok(result.summary.pass >= 4); // node-version, config, registry, ref-patterns at minimum
      assert.equal(result.summary.fail, 0);
    } finally {
      await cleanup();
    }
  });

  it('reports issues for uninitialized project', async () => {
    const { dir, cleanup } = await createTempDir('doctor-empty-');
    try {
      const result = await doctor({ cwd: dir });
      // node-version, config, registry (no ref-patterns when registry fails), gitignore, scan-result
      assert.ok(result.checks.length >= 4);
      // Config should be warn (no config file), registry fail, gitignore warn, scan-result warn
      assert.ok(result.summary.fail >= 1);
    } finally {
      await cleanup();
    }
  });
});

describe('formatDoctorText', () => {
  it('formats result as text with status icons', () => {
    const result: DoctorResult = {
      checks: [
        {
          name: 'node-version',
          label: 'Node.js version',
          status: 'pass',
          message: 'v22.6.0 (>= 22.6.0)',
        },
        {
          name: 'config',
          label: 'Configuration',
          status: 'warn',
          message: 'No config file found',
          fix: 'Run "shiori init"',
        },
        {
          name: 'registry',
          label: 'Registry',
          status: 'fail',
          message: 'Not found',
          fix: 'Run "shiori init"',
        },
      ],
      summary: { pass: 1, warn: 1, fail: 1 },
    };

    const output = formatDoctorText(result, false);
    assert.ok(output.includes('✓'));
    assert.ok(output.includes('!'));
    assert.ok(output.includes('✗'));
    assert.ok(output.includes('Node.js version'));
    assert.ok(output.includes('1 passed'));
    assert.ok(output.includes('1 warning(s)'));
    assert.ok(output.includes('1 failed'));
    // Should NOT show fix when showFix is false
    assert.ok(!output.includes('→'));
  });

  it('shows fix suggestions when showFix is true', () => {
    const result: DoctorResult = {
      checks: [
        {
          name: 'config',
          label: 'Configuration',
          status: 'warn',
          message: 'No config file',
          fix: 'Run "shiori init"',
        },
      ],
      summary: { pass: 0, warn: 1, fail: 0 },
    };

    const output = formatDoctorText(result, true);
    assert.ok(output.includes('→ Run "shiori init"'));
  });
});

describe('formatDoctor', () => {
  it('formats as JSON', () => {
    const result: DoctorResult = {
      checks: [
        {
          name: 'test',
          label: 'Test',
          status: 'pass',
          message: 'OK',
        },
      ],
      summary: { pass: 1, warn: 0, fail: 0 },
    };

    const output = formatDoctor(result, 'json', false);
    const parsed = JSON.parse(output);
    assert.equal(parsed.checks.length, 1);
    assert.equal(parsed.checks[0].status, 'pass');
    assert.equal(parsed.summary.pass, 1);
  });

  it('formats as text', () => {
    const result: DoctorResult = {
      checks: [
        {
          name: 'test',
          label: 'Test',
          status: 'pass',
          message: 'OK',
        },
      ],
      summary: { pass: 1, warn: 0, fail: 0 },
    };

    const output = formatDoctor(result, 'text', false);
    assert.ok(output.includes('shiori doctor:'));
    assert.ok(output.includes('✓'));
  });
});

describe('checkRefPatternsConsistency', () => {
  it('returns pass when no refPatterns configured', () => {
    const config = partialConfig({ refPatterns: undefined });
    const result = checkRefPatternsConsistency(config, ['DEV-001']);
    assert.equal(result.name, 'ref-patterns');
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('skipped'));
  });

  it('returns pass when refPatterns is empty array', () => {
    const config = partialConfig({ refPatterns: [] });
    const result = checkRefPatternsConsistency(config, ['DEV-001']);
    assert.equal(result.status, 'pass');
  });

  it('returns pass when all refs match patterns', () => {
    const config = partialConfig({
      refPatterns: [{ match: 'DEV-{id}' }, { match: 'ADR-{id}' }],
    });
    const result = checkRefPatternsConsistency(config, [
      'DEV-001',
      'DEV-002',
      'ADR-003',
    ]);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('3 ref(s) match'));
  });

  it('returns warn when some refs do not match patterns', () => {
    const config = partialConfig({
      refPatterns: [{ match: 'DEV-{id}' }],
    });
    const result = checkRefPatternsConsistency(config, [
      'DEV-001',
      'UNKNOWN-X',
      'RANDOM',
    ]);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('2 ref(s) do not match'));
    assert.ok(result.message.includes('UNKNOWN-X'));
    assert.ok(result.fix);
  });

  it('returns pass when registry is empty with patterns configured', () => {
    const config = partialConfig({
      refPatterns: [{ match: 'DEV-{id}' }],
    });
    const result = checkRefPatternsConsistency(config, []);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('registry is empty'));
  });

  it('truncates examples when many unmatched refs', () => {
    const config = partialConfig({
      refPatterns: [{ match: 'DEV-{id}' }],
    });
    const refs = ['A-1', 'B-2', 'C-3', 'D-4', 'E-5'];
    const result = checkRefPatternsConsistency(config, refs);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('5 total'));
    // Only first 3 shown
    assert.ok(result.message.includes('A-1'));
    assert.ok(result.message.includes('C-3'));
    assert.ok(!result.message.includes('D-4'));
  });

  it('returns pass with undefined config', () => {
    const result = checkRefPatternsConsistency(undefined, ['DEV-001']);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('skipped'));
  });
});

describe('checkScanResultFreshness', () => {
  it('returns pass when scan-result.json is fresh', async () => {
    const { dir, cleanup } = await createTempDir('doctor-scan-fresh-');
    try {
      await setupShioriProject(dir);
      const scanResultPath = join(dir, '.config', 'shiori', 'scan-result.json');
      await writeFile(scanResultPath, '[]', 'utf-8');
      const result = await checkScanResultFreshness(dir, undefined);
      assert.equal(result.name, 'scan-result');
      assert.equal(result.status, 'pass');
      assert.ok(result.message.includes('up to date'));
    } finally {
      await cleanup();
    }
  });

  it('returns warn when scan-result.json is missing', async () => {
    const { dir, cleanup } = await createTempDir('doctor-scan-missing-');
    try {
      const result = await checkScanResultFreshness(dir, undefined);
      assert.equal(result.status, 'warn');
      assert.ok(result.message.includes('not found'));
      assert.ok(result.fix?.includes('shiori scan'));
    } finally {
      await cleanup();
    }
  });

  it('uses config scanResult path when provided', async () => {
    const { dir, cleanup } = await createTempDir('doctor-scan-custom-');
    try {
      const customPath = 'custom/scan.json';
      const fullPath = join(dir, customPath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, '[]', 'utf-8');
      const config = partialConfig({
        paths: { scanResult: customPath, registry: undefined },
      });
      const result = await checkScanResultFreshness(dir, config);
      assert.equal(result.status, 'pass');
    } finally {
      await cleanup();
    }
  });
});

describe('checkExpiredEntries', () => {
  const now = new Date('2026-03-04T00:00:00Z');

  it('returns pass when no entries exist', () => {
    const registry: Registry = {};
    const result = checkExpiredEntries(registry, now);
    assert.equal(result.name, 'expired-entries');
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('No registry entries'));
  });

  it('returns pass when no entries are expired', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'test',
        target: 'all',
        expires: '2027-06',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = checkExpiredEntries(registry, now);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('No expired entries'));
  });

  it('returns warn when entries are expired', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'test',
        target: 'all',
        expires: '2025-01-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'DEV-002': {
        reason: 'test2',
        target: 'all',
        expires: '2025-06-15',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = checkExpiredEntries(registry, now);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('2 expired'));
    assert.ok(result.message.includes('DEV-001'));
    assert.ok(result.fix?.includes('resolve'));
  });

  it('ignores entries without expires', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'test',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = checkExpiredEntries(registry, now);
    assert.equal(result.status, 'pass');
  });

  it('truncates examples when many expired entries', () => {
    const registry: Registry = {};
    for (let i = 1; i <= 5; i++) {
      registry[`EXP-${String(i).padStart(3, '0')}`] = {
        reason: 'test',
        target: 'all',
        expires: '2024-01-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      };
    }
    const result = checkExpiredEntries(registry, now);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('5 total'));
  });
});

describe('checkRegistryCompleteness', () => {
  it('returns pass when no entries exist', () => {
    const registry: Registry = {};
    const result = checkRegistryCompleteness(registry);
    assert.equal(result.name, 'registry-completeness');
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('No registry entries'));
  });

  it('returns pass when all entries have reasons', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'vendor prefix fallback',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = checkRegistryCompleteness(registry);
    assert.equal(result.status, 'pass');
    assert.ok(result.message.includes('All 1 entries have reasons'));
  });

  it('returns warn when entries have placeholder reasons', () => {
    const registry: Registry = {
      'DEV-001': {
        reason: 'TODO: fill in reason',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
      'DEV-002': {
        reason: 'real reason',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      },
    };
    const result = checkRegistryCompleteness(registry);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('1 entry/entries have placeholder'));
    assert.ok(result.message.includes('DEV-001'));
    assert.ok(result.fix?.includes('Fill in reasons'));
  });

  it('truncates examples when many incomplete entries', () => {
    const registry: Registry = {};
    for (let i = 1; i <= 5; i++) {
      registry[`INC-${String(i).padStart(3, '0')}`] = {
        reason: 'TODO: fill in reason',
        target: 'all',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      };
    }
    const result = checkRegistryCompleteness(registry);
    assert.equal(result.status, 'warn');
    assert.ok(result.message.includes('5 total'));
  });
});
