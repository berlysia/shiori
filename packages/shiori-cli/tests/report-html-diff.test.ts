import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  ShioriAnnotation,
  ShioriCandidate,
  ReportResult,
  DeltaResult,
} from '../src/core/types.ts';
import { makeRegistryEntry } from './helpers/registry.ts';
import { report } from '../src/commands/report.ts';
import { formatReportOutput } from '../src/formatters/report-formatter.ts';
import { formatReportAsHtml } from '../src/formatters/report-html-formatter.ts';
import { computeDelta } from '../src/commands/delta.ts';

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

function makeReportResult(): ReportResult {
  return report({
    scanResult: makeScanResult([
      makeAnnotation({ ref: 'TEST-001', rule: 'no-console' }),
      makeAnnotation({ ref: 'TEST-002', rule: 'no-debugger' }),
    ]),
    registry: {
      'TEST-001': makeRegistryEntry({ owner: 'team-a', kind: 'intentional' }),
      'TEST-002': makeRegistryEntry({ owner: 'team-b', kind: 'intentional' }),
    },
    failOn: [],
    warnOn: [],
  });
}

function makeDelta(): DeltaResult {
  const base = makeScanResult([
    makeAnnotation({ ref: 'OLD-001', location: { file: 'old.ts', line: 5 } }),
    makeAnnotation({
      ref: 'KEPT-001',
      location: { file: 'kept.ts', line: 10 },
    }),
  ]);
  const head = makeScanResult([
    makeAnnotation({
      ref: 'KEPT-001',
      location: { file: 'kept.ts', line: 10 },
    }),
    makeAnnotation({
      ref: 'NEW-001',
      location: { file: 'new.ts', line: 3 },
    }),
  ]);
  return computeDelta({ base, head });
}

describe('formatReportOutput with htmlOptions', () => {
  it('passes delta to HTML formatter via formatReportOutput', () => {
    const result = makeReportResult();
    const delta = makeDelta();

    const output = formatReportOutput(result, 'html', { delta });

    // Should contain delta overlay section
    assert.ok(output.includes('Changes'));
    assert.ok(output.includes('delta-badge'));
    assert.ok(output.includes('added'));
    assert.ok(output.includes('removed'));
  });

  it('renders HTML without delta when htmlOptions has no delta', () => {
    const result = makeReportResult();

    const output = formatReportOutput(result, 'html');

    // Should NOT contain delta overlay content (CSS class definitions are always present)
    assert.ok(!output.includes('<div class="delta-summary">'));
    assert.ok(!output.includes('<span class="delta-badge'));
    // But should still be valid HTML
    assert.ok(output.includes('<!DOCTYPE html>'));
    assert.ok(output.includes('Shiori Governance Report'));
  });

  it('ignores htmlOptions for JSON format', () => {
    const result = makeReportResult();
    const delta = makeDelta();

    const output = formatReportOutput(result, 'json', { delta });

    // Should be valid JSON with envelope
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'report');
    const parsed = envelope.data as ReportResult;
    assert.equal(parsed.health.level, result.health.level);
    assert.equal(parsed.totals.annotations, 2);
  });

  it('ignores htmlOptions for markdown format', () => {
    const result = makeReportResult();
    const delta = makeDelta();

    const output = formatReportOutput(result, 'markdown', { delta });

    // Should be Markdown without delta HTML
    assert.ok(output.includes('# Shiori Governance Report'));
    assert.ok(!output.includes('delta-badge'));
  });
});

describe('formatReportAsHtml with delta', () => {
  it('renders delta overlay with summary badges', () => {
    const result = makeReportResult();
    const delta = makeDelta();

    const html = formatReportAsHtml(result, { delta });

    // Summary badges
    assert.ok(html.includes('delta-summary'));
    assert.ok(html.includes('+1 added'));
    assert.ok(html.includes('1 unchanged'));

    // Delta table
    assert.ok(html.includes('delta-table'));
    assert.ok(html.includes('NEW-001'));
    assert.ok(html.includes('OLD-001'));
  });

  it('renders "no changes" message when delta has no changes', () => {
    const result = makeReportResult();
    const scanResult = makeScanResult([
      makeAnnotation({
        ref: 'SAME-001',
        location: { file: 'same.ts', line: 1 },
      }),
    ]);
    const delta = computeDelta({ base: scanResult, head: scanResult });

    const html = formatReportAsHtml(result, { delta });

    assert.ok(html.includes('No changes since last scan'));
  });

  it('renders without delta section when no delta provided', () => {
    const result = makeReportResult();

    const html = formatReportAsHtml(result);

    // Should not contain delta content elements (CSS class definitions are always present in <style>)
    assert.ok(!html.includes('<div class="delta-summary">'));
    assert.ok(!html.includes('<table class="delta-table">'));
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});
