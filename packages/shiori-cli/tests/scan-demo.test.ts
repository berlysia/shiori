import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDemo,
  formatDemoResult,
  type DemoResult,
} from '../src/commands/scan-demo.ts';

describe('scan-demo: runDemo()', () => {
  it('scans 3 demo files and returns 3 annotations', async () => {
    const result = await runDemo();

    assert.equal(result.scanResult.filesScanned, 3);
    assert.equal(result.scanResult.annotations.length, 3);
  });

  it('includes all 3 demo refs', async () => {
    const result = await runDemo();
    const refs = result.scanResult.annotations.map((a) => a.ref).sort();

    assert.deepEqual(refs, ['DEMO-001', 'DEMO-002', 'DEMO-003']);
  });

  it('detects expired DEMO-001 as verify issue', async () => {
    const result = await runDemo();
    const expiredIssues = result.verifyResult.issues.filter(
      (i) => i.type === 'expired' && i.ref === 'DEMO-001',
    );

    assert.ok(
      expiredIssues.length > 0,
      'DEMO-001 should have an expired issue (expires=2025-12-31)',
    );
  });

  it('produces a health score between 0 and 100', async () => {
    const result = await runDemo();

    assert.ok(result.healthScore >= 0, `score ${result.healthScore} >= 0`);
    assert.ok(result.healthScore <= 100, `score ${result.healthScore} <= 100`);
  });

  it('returns a valid health level', async () => {
    const result = await runDemo();
    const validLevels = ['critical', 'warning', 'healthy'];

    assert.ok(
      validLevels.includes(result.healthLevel),
      `healthLevel "${result.healthLevel}" should be one of ${validLevels.join(', ')}`,
    );
  });

  it('cleans up temp directory after execution', async () => {
    const result = await runDemo();
    const { access } = await import('node:fs/promises');

    // demoDir should not exist after runDemo() returns
    await assert.rejects(
      () => access(result.demoDir),
      'Temp directory should be cleaned up',
    );
  });

  it('includes ESLint annotation with rule', async () => {
    const result = await runDemo();
    const eslint = result.scanResult.annotations.find(
      (a) => a.ref === 'DEMO-001',
    );

    assert.ok(eslint, 'DEMO-001 should exist');
    assert.equal(eslint.rule, 'no-console');
    assert.equal(eslint.expires, '2025-12-31');
  });

  it('includes Stylelint annotation with rule', async () => {
    const result = await runDemo();
    const stylelint = result.scanResult.annotations.find(
      (a) => a.ref === 'DEMO-002',
    );

    assert.ok(stylelint, 'DEMO-002 should exist');
    assert.equal(stylelint.rule, 'color-named');
  });

  it('includes standalone shiori annotation without rule', async () => {
    const result = await runDemo();
    const standalone = result.scanResult.annotations.find(
      (a) => a.ref === 'DEMO-003',
    );

    assert.ok(standalone, 'DEMO-003 should exist');
    assert.equal(standalone.rule, undefined);
  });

  it('produces no candidates (all demo annotations are tracked)', async () => {
    const result = await runDemo();

    assert.equal(result.scanResult.candidates.length, 0);
  });
});

describe('scan-demo: formatDemoResult()', () => {
  // Use a cached result to avoid repeated I/O
  let cachedResult: DemoResult;

  async function getResult(): Promise<DemoResult> {
    if (!cachedResult) {
      cachedResult = await runDemo();
    }
    return cachedResult;
  }

  it('includes header line', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('shiori scan --demo'));
  });

  it('includes Japanese description', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('shiori はソースコード中の'));
  });

  it('includes scan results section', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('Scan Results'));
    assert.ok(output.includes('DEMO-001'));
    assert.ok(output.includes('DEMO-002'));
    assert.ok(output.includes('DEMO-003'));
  });

  it('includes verify issues section for expired entry', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('Verify Issues'));
    assert.ok(output.includes('expired'));
  });

  it('includes health score', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('Health'));
    assert.ok(output.includes('/100'));
  });

  it('includes CTA with next steps', async () => {
    const result = await getResult();
    const output = formatDemoResult(result);

    assert.ok(output.includes('shiori init'));
    assert.ok(output.includes('shiori scan'));
    assert.ok(output.includes('shiori health'));
  });
});
