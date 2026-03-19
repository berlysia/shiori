import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { constants } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(import.meta.dirname, '../..');
const ACTION_DIR = resolve(ROOT, 'actions/shiori-action');
const ACTION_YML = resolve(ACTION_DIR, 'action.yml');
const SCRIPTS_DIR = resolve(ACTION_DIR, 'scripts');

/**
 * Expected modes that the composite action supports.
 * Each mode should have at least one step with a matching prefix in its name.
 */
const EXPECTED_MODES = [
  'baseline',
  'pr-comment',
  'pr-description',
  'checks-gate',
  'badge',
  'sarif',
] as const;

/**
 * Helper scripts that should exist in actions/shiori-action/scripts/.
 */
const EXPECTED_SCRIPTS = [
  'download-baseline.sh',
  'post-pr-comment.sh',
  'update-pr-description.sh',
  'upload-gist.sh',
];

interface ActionYml {
  name: string;
  description: string;
  inputs: Record<
    string,
    { description: string; required?: boolean; default?: string }
  >;
  outputs: Record<string, { description: string; value?: string }>;
  runs: {
    using: string;
    steps: Array<{
      name?: string;
      if?: string;
      shell?: string;
      run?: string;
      uses?: string;
      id?: string;
    }>;
  };
}

async function loadActionYml(): Promise<ActionYml> {
  const raw = await readFile(ACTION_YML, 'utf-8');
  return parseYaml(raw) as ActionYml;
}

describe('actions/shiori-action/action.yml', () => {
  it('exists and is valid YAML', async () => {
    await access(ACTION_YML, constants.R_OK);
    const action = await loadActionYml();
    assert.ok(action, 'action.yml should parse as valid YAML');
  });

  it('uses composite runner', async () => {
    const action = await loadActionYml();
    assert.equal(
      action.runs.using,
      'composite',
      'runs.using should be "composite"',
    );
  });

  it('has required metadata fields', async () => {
    const action = await loadActionYml();
    assert.ok(action.name, 'name is required');
    assert.ok(action.description, 'description is required');
  });

  it('has mode input marked as required', async () => {
    const action = await loadActionYml();
    assert.ok(action.inputs.mode, 'mode input should exist');
    assert.equal(
      action.inputs.mode.required,
      true,
      'mode input should be required',
    );
  });

  it('every input has a description', async () => {
    const action = await loadActionYml();
    for (const [name, input] of Object.entries(action.inputs)) {
      assert.ok(
        input.description && input.description.trim().length > 0,
        `input "${name}" should have a non-empty description`,
      );
    }
  });

  it('every output has a description', async () => {
    const action = await loadActionYml();
    for (const [name, output] of Object.entries(action.outputs)) {
      assert.ok(
        output.description && output.description.trim().length > 0,
        `output "${name}" should have a non-empty description`,
      );
    }
  });

  it('every shell step specifies shell explicitly', async () => {
    const action = await loadActionYml();
    for (const step of action.runs.steps) {
      // Steps using `uses:` do not need a shell
      if (step.uses) continue;
      if (step.run) {
        assert.ok(
          step.shell,
          `step "${step.name ?? '(unnamed)'}" has a run command but no shell specified`,
        );
      }
    }
  });

  it('has steps for every expected mode', async () => {
    const action = await loadActionYml();
    for (const mode of EXPECTED_MODES) {
      const hasStep = action.runs.steps.some(
        (step) => step.name && step.name.startsWith(`${mode}:`),
      );
      assert.ok(hasStep, `should have at least one step for mode "${mode}"`);
    }
  });

  it('mode-specific steps have correct conditional guards', async () => {
    const action = await loadActionYml();
    for (const step of action.runs.steps) {
      if (!step.name) continue;
      // Find which mode this step belongs to by checking the name prefix
      const matchedMode = EXPECTED_MODES.find((m) =>
        step.name!.startsWith(`${m}:`),
      );
      if (!matchedMode) continue;

      // The step should have an `if` condition that checks the mode
      assert.ok(
        step.if && step.if.includes(matchedMode),
        `step "${step.name}" should have an if condition referencing mode "${matchedMode}"`,
      );
    }
  });

  it('references helper scripts with github.action_path', async () => {
    const action = await loadActionYml();
    const scriptSteps = action.runs.steps.filter(
      (step) => step.run && step.run.includes('/scripts/'),
    );
    for (const step of scriptSteps) {
      assert.ok(
        step.run!.includes('github.action_path'),
        `step "${step.name ?? '(unnamed)'}" should reference scripts via github.action_path`,
      );
    }
  });
});

describe('actions/shiori-action/scripts/', () => {
  for (const script of EXPECTED_SCRIPTS) {
    it(`${script} exists`, async () => {
      const scriptPath = join(SCRIPTS_DIR, script);
      await access(scriptPath, constants.R_OK);
    });

    it(`${script} starts with a shebang line`, async () => {
      const scriptPath = join(SCRIPTS_DIR, script);
      const content = await readFile(scriptPath, 'utf-8');
      assert.ok(
        content.startsWith('#!/'),
        `${script} should start with a shebang line`,
      );
    });

    it(`${script} uses set -euo pipefail`, async () => {
      const scriptPath = join(SCRIPTS_DIR, script);
      const content = await readFile(scriptPath, 'utf-8');
      assert.ok(
        content.includes('set -euo pipefail'),
        `${script} should use strict mode (set -euo pipefail)`,
      );
    });
  }
});
