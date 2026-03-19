import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCiWorkflow,
  CI_TEMPLATE_KINDS,
  CI_TEMPLATE_LABELS,
  CI_TEMPLATE_PATHS,
} from '../src/commands/init-ci-templates.ts';

describe('CI_TEMPLATE_KINDS', () => {
  it('contains all expected kinds', () => {
    assert.deepEqual(
      [...CI_TEMPLATE_KINDS],
      [
        'basic',
        'sarif',
        'delta-pr-comment',
        'checks-gate',
        'badge',
        'badge-gist',
      ],
    );
  });

  it('has labels for all kinds', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      assert.ok(CI_TEMPLATE_LABELS[kind], `Missing label for kind: ${kind}`);
    }
  });

  it('has paths for all kinds', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      assert.ok(CI_TEMPLATE_PATHS[kind], `Missing path for kind: ${kind}`);
    }
  });
});

describe('generateCiWorkflow', () => {
  it('generates valid YAML for basic template', () => {
    const yaml = generateCiWorkflow('basic');

    assert.ok(yaml.includes('name: shiori'));
    assert.ok(yaml.includes('on:'));
    assert.ok(yaml.includes('push:'));
    assert.ok(yaml.includes('pull_request:'));
    assert.ok(yaml.includes('shiori check'));
    assert.ok(yaml.includes('--fail-on expired,missing-in-registry'));
    assert.ok(yaml.includes('actions/checkout@v4'));
    assert.ok(yaml.includes('pnpm install --frozen-lockfile'));
  });

  it('generates valid YAML for sarif template', () => {
    const yaml = generateCiWorkflow('sarif');

    assert.ok(yaml.includes('name: shiori'));
    assert.ok(yaml.includes('security-events: write'));
    assert.ok(yaml.includes('shiori verify --format sarif'));
    assert.ok(yaml.includes('codeql-action/upload-sarif'));
    assert.ok(yaml.includes('category: shiori'));
  });

  it('generates valid YAML for delta-pr-comment template', () => {
    const yaml = generateCiWorkflow('delta-pr-comment');

    assert.ok(yaml.includes('name: shiori'));
    assert.ok(yaml.includes('save-baseline:'));
    assert.ok(yaml.includes('pr-delta:'));
    assert.ok(yaml.includes('pull-requests: write'));
    assert.ok(yaml.includes('shiori delta'));
    assert.ok(yaml.includes('--base-fallback-empty'));
    assert.ok(yaml.includes('--max-increase 0'));
    assert.ok(yaml.includes('peter-evans/create-or-update-comment@v4'));
    assert.ok(yaml.includes('shiori-delta'));
    assert.ok(yaml.includes('upload-artifact@v4'));
    assert.ok(yaml.includes('actions/github-script@v7'));
    assert.ok(yaml.includes('actions: read'));
  });

  it('includes onboarding section in delta-pr-comment template', () => {
    const yaml = generateCiWorkflow('delta-pr-comment');

    assert.ok(yaml.includes('Append onboarding section'));
    assert.ok(yaml.includes('shiori について'));
    assert.ok(yaml.includes('pnpm add -D shiori'));
    assert.ok(yaml.includes('pnpm shiori init'));
    assert.ok(yaml.includes('pnpm shiori candidates'));
    assert.ok(yaml.includes('pnpm shiori adopt'));
    assert.ok(yaml.includes('pnpm shiori check'));
    assert.ok(yaml.includes('pr-onboarding-snippet.md'));
  });

  it('places onboarding step before PR comment posting in delta-pr-comment', () => {
    const yaml = generateCiWorkflow('delta-pr-comment');

    const onboardingIndex = yaml.indexOf('Append onboarding section');
    const postCommentIndex = yaml.indexOf('Post delta as PR comment');

    assert.ok(onboardingIndex > 0, 'Onboarding section not found');
    assert.ok(postCommentIndex > 0, 'Post comment step not found');
    assert.ok(
      onboardingIndex < postCommentIndex,
      'Onboarding section should appear before PR comment posting',
    );
  });

  it('generates valid YAML for checks-gate template', () => {
    const yaml = generateCiWorkflow('checks-gate');

    assert.ok(yaml.includes('name: shiori governance'));
    assert.ok(yaml.includes('on:'));
    assert.ok(yaml.includes('push:'));
    assert.ok(yaml.includes('pull_request:'));
    assert.ok(yaml.includes('shiori check'));
    assert.ok(yaml.includes('--fail-on expired,missing-in-registry'));
    assert.ok(yaml.includes('actions/checkout@v4'));
    assert.ok(yaml.includes('pnpm install --frozen-lockfile'));
  });

  it('checks-gate template uses distinct workflow name for status checks', () => {
    const yaml = generateCiWorkflow('checks-gate');

    // Workflow name should be distinct from 'basic' template for status check identification
    assert.ok(yaml.includes('name: shiori governance'));
    assert.ok(yaml.includes('jobs:\n  check:'));
  });

  it('generates valid YAML for badge template', () => {
    const yaml = generateCiWorkflow('badge');

    assert.ok(yaml.includes('name: shiori badge'));
    assert.ok(yaml.includes('on:'));
    assert.ok(yaml.includes('push:'));
    assert.ok(yaml.includes('workflow_dispatch:'));
    assert.ok(yaml.includes('shiori report --format badge'));
    assert.ok(yaml.includes('actions/checkout@v4'));
    assert.ok(yaml.includes('pnpm install --frozen-lockfile'));
    assert.ok(yaml.includes('upload-artifact@v4'));
    assert.ok(yaml.includes('shiori-badge'));
  });

  it('badge template outputs to separate workflow file', () => {
    assert.equal(
      CI_TEMPLATE_PATHS['badge'],
      '.github/workflows/shiori-badge.yml',
    );
  });

  it('badge template includes Gist upload as commented-out step', () => {
    const yaml = generateCiWorkflow('badge');

    assert.ok(yaml.includes('# - name: Upload badge to Gist'));
    assert.ok(yaml.includes('actions-deploy-gist@v1'));
    assert.ok(yaml.includes('GIST_TOKEN'));
    assert.ok(yaml.includes('GIST_ID'));
  });

  it('badge template outputs shields.io JSON (not SVG)', () => {
    const yaml = generateCiWorkflow('badge');

    assert.ok(
      yaml.includes('shiori-badge.json'),
      'Badge output should use .json extension',
    );
    assert.ok(
      !yaml.includes('shiori-badge.svg'),
      'Badge output should NOT use .svg extension',
    );
  });

  it('badge template uses pnpm shiori command', () => {
    const yaml = generateCiWorkflow('badge');

    assert.ok(yaml.includes('pnpm shiori report'));
    // Should NOT use node dist/ directly
    assert.ok(!yaml.includes('node dist/'));
  });

  it('includes generator comment for all templates', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      const yaml = generateCiWorkflow(kind);
      assert.ok(
        yaml.includes(`Generated by: shiori init --ci ${kind}`),
        `Missing generator comment for kind: ${kind}`,
      );
    }
  });

  it('includes Node.js 22 for all templates', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      const yaml = generateCiWorkflow(kind);
      assert.ok(
        yaml.includes("node-version: '22'"),
        `Missing Node.js 22 for kind: ${kind}`,
      );
    }
  });

  it('includes pnpm setup for all templates', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      const yaml = generateCiWorkflow(kind);
      assert.ok(
        yaml.includes('pnpm/action-setup@v4'),
        `Missing pnpm setup for kind: ${kind}`,
      );
    }
  });

  it('all templates output non-empty strings', () => {
    for (const kind of CI_TEMPLATE_KINDS) {
      const yaml = generateCiWorkflow(kind);
      assert.ok(yaml.length > 0, `Empty output for kind: ${kind}`);
    }
  });

  it('generates valid YAML for badge-gist template', () => {
    const yaml = generateCiWorkflow('badge-gist');

    assert.ok(yaml.includes('name: shiori badge'));
    assert.ok(yaml.includes('on:'));
    assert.ok(yaml.includes('push:'));
    assert.ok(yaml.includes('workflow_dispatch:'));
    assert.ok(yaml.includes('shiori report --format badge'));
    assert.ok(yaml.includes('actions/checkout@v4'));
    assert.ok(yaml.includes('pnpm install --frozen-lockfile'));
    assert.ok(yaml.includes('upload-artifact@v4'));
    assert.ok(yaml.includes('shiori-badge'));
  });

  it('badge-gist template includes active Gist upload step', () => {
    const yaml = generateCiWorkflow('badge-gist');

    // Gist upload should be active (not commented out)
    assert.ok(yaml.includes('- name: Upload badge to Gist'));
    assert.ok(yaml.includes('actions-deploy-gist@v1'));
    assert.ok(yaml.includes('GIST_TOKEN'));
    assert.ok(yaml.includes('GIST_ID'));
    // Should NOT be commented
    assert.ok(
      !yaml.includes('# - name: Upload badge to Gist'),
      'Gist upload step should not be commented out in badge-gist template',
    );
  });

  it('badge-gist template outputs to same path as badge template', () => {
    assert.equal(CI_TEMPLATE_PATHS['badge-gist'], CI_TEMPLATE_PATHS['badge']);
  });

  it('badge-gist template outputs shields.io JSON', () => {
    const yaml = generateCiWorkflow('badge-gist');

    assert.ok(
      yaml.includes('shiori-badge.json'),
      'Badge output should use .json extension',
    );
  });

  it('badge-gist template includes prerequisite documentation', () => {
    const yaml = generateCiWorkflow('badge-gist');

    assert.ok(yaml.includes('Prerequisites:'));
    assert.ok(yaml.includes('Create a GitHub Gist'));
    assert.ok(yaml.includes('Create a PAT with gist scope'));
  });
});
