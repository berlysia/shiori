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
  formatDoctor,
  formatDoctorText,
} from '../src/commands/doctor.ts';
import type { DoctorResult } from '../src/core/types.ts';

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
      const result = await doctor({ cwd: dir });
      assert.equal(result.checks.length, 4);
      assert.ok(result.summary.pass >= 3); // node-version, config, registry, gitignore
      assert.equal(result.summary.fail, 0);
    } finally {
      await cleanup();
    }
  });

  it('reports issues for uninitialized project', async () => {
    const { dir, cleanup } = await createTempDir('doctor-empty-');
    try {
      const result = await doctor({ cwd: dir });
      assert.equal(result.checks.length, 4);
      // Config should be warn (no config file), registry fail, gitignore warn
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
