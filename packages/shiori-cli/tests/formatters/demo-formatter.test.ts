import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDemo, type DemoResult } from '../../src/commands/scan-demo.ts';
import {
  formatDemoResultAsMarkdown,
  formatDemoResultAsGitHubSummary,
} from '../../src/formatters/demo-formatter.ts';
import { formatDemoOutput } from '../../src/formatters/index.ts';

// Cache demo result to avoid repeated I/O across tests
let cachedResult: DemoResult;

async function getResult(): Promise<DemoResult> {
  if (!cachedResult) {
    cachedResult = await runDemo();
  }
  return cachedResult;
}

describe('formatDemoResultAsMarkdown()', () => {
  it('produces valid markdown with h1 header', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.startsWith('# shiori scan --demo'));
  });

  it('includes Japanese description', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('shiori はソースコード中の'));
  });

  it('includes scan results table', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('## Scan Results'));
    assert.ok(md.includes('| Files scanned |'));
    assert.ok(md.includes('| Annotations |'));
  });

  it('includes annotation details with all demo refs', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('DEMO-001'));
    assert.ok(md.includes('DEMO-002'));
    assert.ok(md.includes('DEMO-003'));
  });

  it('includes verify issues section', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('## Verify Issues'));
    assert.ok(md.includes('`expired`'));
  });

  it('includes health score', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('## Health'));
    assert.ok(md.includes('/100'));
  });

  it('includes next steps with CTA', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('## Next Steps'));
    assert.ok(md.includes('shiori init'));
    assert.ok(md.includes('shiori scan'));
    assert.ok(md.includes('shiori health'));
  });

  it('includes Getting Started link', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('getting-started.md'));
  });

  it('includes rule name for lint annotations', async () => {
    const result = await getResult();
    const md = formatDemoResultAsMarkdown(result);

    assert.ok(md.includes('`no-console`'));
    assert.ok(md.includes('`color-named`'));
  });
});

describe('formatDemoResultAsGitHubSummary()', () => {
  it('starts with h3 header containing health score', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('### '));
    assert.ok(summary.includes('Shiori Demo:'));
    assert.ok(summary.includes('/100'));
  });

  it('includes blockquote description', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('> `shiori scan --demo`'));
  });

  it('includes overview table', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('| Files scanned |'));
    assert.ok(summary.includes('| Annotations |'));
    assert.ok(summary.includes('| Verify errors |'));
  });

  it('includes collapsible annotation details', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('<details>'));
    assert.ok(summary.includes('Annotations'));
    assert.ok(summary.includes('</details>'));
  });

  it('includes collapsible verify issues', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('Verify Issues'));
  });

  it('includes next steps CTA', async () => {
    const result = await getResult();
    const summary = formatDemoResultAsGitHubSummary(result);

    assert.ok(summary.includes('`shiori init`'));
    assert.ok(summary.includes('`shiori scan`'));
    assert.ok(summary.includes('`shiori health`'));
  });
});

describe('formatDemoOutput() dispatcher', () => {
  it('dispatches to markdown formatter', async () => {
    const result = await getResult();
    const output = formatDemoOutput({
      format: 'markdown',
      demoResult: result,
    });

    assert.ok(output.startsWith('# shiori scan --demo'));
  });

  it('dispatches to github-summary formatter', async () => {
    const result = await getResult();
    const output = formatDemoOutput({
      format: 'github-summary',
      demoResult: result,
    });

    assert.ok(output.includes('Shiori Demo:'));
    assert.ok(output.includes('<details>'));
  });

  it('dispatches to json formatter with mode="demo" in meta', async () => {
    const result = await getResult();
    const output = formatDemoOutput({ format: 'json', demoResult: result });
    const parsed = JSON.parse(output);

    assert.equal(parsed.meta.command, 'scan');
    assert.equal(parsed.meta.schemaVersion, 1);
    assert.equal(parsed.meta.mode, 'demo');
    assert.ok(parsed.data.scanResult);
    assert.ok(parsed.data.verifyResult);
    assert.equal(typeof parsed.data.healthScore, 'number');
    assert.ok(
      ['healthy', 'warning', 'critical'].includes(parsed.data.healthLevel),
    );
  });
});
