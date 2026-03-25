import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoachPrompt,
  buildCoachPromptFromCustomTemplate,
  formatCoachOutput,
  COACH_TEMPLATES,
  COACH_FORMATS,
  COACH_PLACEHOLDERS,
} from '../src/commands/coach.ts';

describe('buildCoachPrompt', () => {
  it('builds triage prompt with JSON embedded', () => {
    const triageJson = '{"items":[],"summary":{"total":0}}';
    const result = buildCoachPrompt('triage', { triageJson });

    assert.equal(result.template, 'triage');
    assert.ok(result.prompt.includes(triageJson));
    assert.ok(result.prompt.includes('ガバナンスの専門家'));
    assert.ok(!result.prompt.includes('{{TRIAGE_JSON}}'));
    assert.deepEqual(result.sources.triage, triageJson);
  });

  it('builds weekly prompt with JSON embedded', () => {
    const weeklyReportJson = '{"health":{"score":85}}';
    const result = buildCoachPrompt('weekly', { weeklyReportJson });

    assert.equal(result.template, 'weekly');
    assert.ok(result.prompt.includes(weeklyReportJson));
    assert.ok(result.prompt.includes('ガバナンスコーチ'));
    assert.ok(!result.prompt.includes('{{WEEKLY_REPORT_JSON}}'));
    assert.deepEqual(result.sources.weeklyReport, weeklyReportJson);
  });

  it('builds health prompt with JSON embedded', () => {
    const healthJson = '{"health":{"score":72,"level":"warning"}}';
    const result = buildCoachPrompt('health', { healthJson });

    assert.equal(result.template, 'health');
    assert.ok(result.prompt.includes(healthJson));
    assert.ok(result.prompt.includes('健全性を診断'));
    assert.ok(!result.prompt.includes('{{HEALTH_JSON}}'));
    assert.deepEqual(result.sources.health, healthJson);
  });

  it('builds combined prompt with triage, weekly, and health JSON', () => {
    const triageJson = '{"items":[]}';
    const weeklyReportJson = '{"health":{"score":90}}';
    const healthJson = '{"health":{"score":72,"level":"warning"}}';
    const result = buildCoachPrompt('combined', {
      triageJson,
      weeklyReportJson,
      healthJson,
    });

    assert.equal(result.template, 'combined');
    assert.ok(result.prompt.includes(triageJson));
    assert.ok(result.prompt.includes(weeklyReportJson));
    assert.ok(result.prompt.includes(healthJson));
    assert.ok(!result.prompt.includes('{{TRIAGE_JSON}}'));
    assert.ok(!result.prompt.includes('{{WEEKLY_REPORT_JSON}}'));
    assert.ok(!result.prompt.includes('{{HEALTH_JSON}}'));
    assert.deepEqual(result.sources.health, healthJson);
  });

  it('leaves unreplaced placeholders when data is missing', () => {
    // triage template expects triageJson, but none provided
    const result = buildCoachPrompt('triage', {});

    assert.ok(result.prompt.includes('{{TRIAGE_JSON}}'));
    assert.equal(result.sources.triage, undefined);
  });

  it('replaces placeholder even when value is empty string', () => {
    const result = buildCoachPrompt('triage', { triageJson: '' });

    assert.ok(!result.prompt.includes('{{TRIAGE_JSON}}'));
    assert.equal(result.sources.triage, '');
  });
});

describe('buildCoachPromptFromCustomTemplate', () => {
  it('replaces placeholders in custom template', () => {
    const templateContent = 'Analyze: {{TRIAGE_JSON}} and {{HEALTH_JSON}}';
    const triageJson = '{"data":"triage"}';
    const healthJson = '{"data":"health"}';

    const result = buildCoachPromptFromCustomTemplate(templateContent, {
      triageJson,
      healthJson,
    });

    assert.ok(result.prompt.includes('"data":"triage"'));
    assert.ok(result.prompt.includes('"data":"health"'));
    assert.ok(!result.prompt.includes('{{TRIAGE_JSON}}'));
    assert.ok(!result.prompt.includes('{{HEALTH_JSON}}'));
    assert.equal(result.template, 'custom');
  });
});

describe('formatCoachOutput', () => {
  const mockResult = buildCoachPrompt('triage', {
    triageJson: '{"items":[]}',
  });

  it('returns raw prompt text for "prompt" format', () => {
    const output = formatCoachOutput(mockResult, 'prompt');

    assert.equal(output, mockResult.prompt);
  });

  it('returns valid JSON for "json" format', () => {
    const output = formatCoachOutput(mockResult, 'json');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'coach');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data as { template: string; prompt: string };

    assert.equal(parsed.template, 'triage');
    assert.ok(typeof parsed.prompt === 'string');
  });

  it('returns GitHub issue format with collapsible details', () => {
    const output = formatCoachOutput(mockResult, 'github-issue');

    assert.ok(output.includes('Governance Coach Prompt'));
    assert.ok(output.includes('<details>'));
    assert.ok(output.includes('</details>'));
    assert.ok(output.includes('shiori coach'));
  });
});

describe('COACH_TEMPLATES and COACH_FORMATS', () => {
  it('has expected templates', () => {
    assert.deepEqual(
      [...COACH_TEMPLATES],
      ['triage', 'weekly', 'health', 'combined'],
    );
  });

  it('has expected formats', () => {
    assert.deepEqual([...COACH_FORMATS], ['prompt', 'json', 'github-issue']);
  });
});

describe('COACH_PLACEHOLDERS', () => {
  it('has expected placeholder tokens', () => {
    assert.equal(COACH_PLACEHOLDERS.TRIAGE, '{{TRIAGE_JSON}}');
    assert.equal(COACH_PLACEHOLDERS.WEEKLY_REPORT, '{{WEEKLY_REPORT_JSON}}');
    assert.equal(COACH_PLACEHOLDERS.HEALTH, '{{HEALTH_JSON}}');
    assert.equal(COACH_PLACEHOLDERS.NARRATIVE, '{{NARRATIVE}}');
  });

  it('built-in templates use only defined placeholders', () => {
    const placeholderValues = Object.values(COACH_PLACEHOLDERS);
    const placeholderPattern = /\{\{[A-Z_]+\}\}/g;

    for (const tmpl of COACH_TEMPLATES) {
      const result = buildCoachPrompt(tmpl, {});
      const found = result.prompt.match(placeholderPattern) ?? [];
      for (const token of found) {
        assert.ok(
          placeholderValues.includes(
            token as (typeof placeholderValues)[number],
          ),
          `Template "${tmpl}" uses unknown placeholder: ${token}`,
        );
      }
    }
  });
});

describe('narrative + coach integration (EP-0151)', () => {
  const narrativeJson =
    '{"headline":"Governance health improved","healthSummary":"Score +5"}';

  it('replaces {{NARRATIVE}} in combined template', () => {
    const result = buildCoachPrompt('combined', {
      triageJson: '{"items":[]}',
      weeklyReportJson: '{"health":{"score":90}}',
      narrativeJson,
    });

    assert.ok(result.prompt.includes(narrativeJson));
    assert.ok(!result.prompt.includes('{{NARRATIVE}}'));
    assert.equal(result.sources.narrative, narrativeJson);
  });

  it('leaves {{NARRATIVE}} unreplaced when narrativeJson is not provided', () => {
    const result = buildCoachPrompt('combined', {
      triageJson: '{"items":[]}',
      weeklyReportJson: '{"health":{"score":90}}',
    });

    assert.ok(result.prompt.includes('{{NARRATIVE}}'));
    assert.equal(result.sources.narrative, undefined);
  });

  it('replaces {{NARRATIVE}} in custom template', () => {
    const templateContent =
      'Narrative: {{NARRATIVE}} | Triage: {{TRIAGE_JSON}}';
    const result = buildCoachPromptFromCustomTemplate(templateContent, {
      triageJson: '{"data":"triage"}',
      narrativeJson,
    });

    assert.ok(result.prompt.includes(narrativeJson));
    assert.ok(!result.prompt.includes('{{NARRATIVE}}'));
    assert.equal(result.sources.narrative, narrativeJson);
  });

  it('narrative source is included in JSON output format', () => {
    const result = buildCoachPrompt('combined', {
      triageJson: '{"items":[]}',
      weeklyReportJson: '{"report":{}}',
      narrativeJson,
    });
    const output = formatCoachOutput(result, 'json');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'coach');
    const parsed = envelope.data as {
      sources: { narrative?: string };
    };

    assert.equal(parsed.sources.narrative, narrativeJson);
  });

  it('non-combined templates work without narrative placeholder in template', () => {
    // triage template doesn't have {{NARRATIVE}} — narrativeJson is ignored but stored in sources
    const result = buildCoachPrompt('triage', {
      triageJson: '{"items":[]}',
      narrativeJson,
    });

    // narrative not in prompt (no placeholder in triage template)
    assert.ok(!result.prompt.includes(narrativeJson));
    // but still tracked in sources
    assert.equal(result.sources.narrative, narrativeJson);
  });
});
