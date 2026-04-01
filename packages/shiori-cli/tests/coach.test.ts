import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoachPrompt,
  buildCoachPromptFromCustomTemplate,
  formatCoachOutput,
  COACH_TEMPLATES,
  COACH_FORMATS,
  COACH_PLACEHOLDERS,
  MATURITY_GUIDANCE_MAP,
  STAGE_CELEBRATION_MAP,
  NEXT_STAGE_ROADMAP,
  resolveMaturityStageName,
  resolveMaturityGuidance,
  resolveDiffBlock,
  resolveStageTransition,
} from '../src/commands/coach.ts';
import type {
  CoachDiffContext,
  HealthMaturityStage,
} from '../src/core/types.ts';

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

// ── Maturity-Aware Coach Templates (EP-0205) ─────────────────

describe('resolveMaturityStageName', () => {
  it('returns stage name when provided', () => {
    assert.equal(resolveMaturityStageName('Foundation'), 'Foundation');
    assert.equal(resolveMaturityStageName('Tracking'), 'Tracking');
    assert.equal(resolveMaturityStageName('Maintained'), 'Maintained');
    assert.equal(resolveMaturityStageName('Autonomous'), 'Autonomous');
  });

  it('returns empty string when undefined (backward compatibility)', () => {
    assert.equal(resolveMaturityStageName(undefined), '');
  });
});

describe('resolveMaturityGuidance', () => {
  it('returns stage-specific guidance for each stage', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    for (const stage of stages) {
      const guidance = resolveMaturityGuidance(stage);
      assert.ok(guidance.length > 0, `${stage} should have non-empty guidance`);
      assert.equal(
        guidance,
        MATURITY_GUIDANCE_MAP[stage],
        `${stage} guidance should match map`,
      );
    }
  });

  it('returns empty string when undefined (backward compatibility)', () => {
    assert.equal(resolveMaturityGuidance(undefined), '');
  });
});

describe('MATURITY_GUIDANCE_MAP', () => {
  it('has guidance for all four stages', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    for (const stage of stages) {
      assert.ok(
        stage in MATURITY_GUIDANCE_MAP,
        `Missing guidance for ${stage}`,
      );
      assert.ok(
        MATURITY_GUIDANCE_MAP[stage].length > 0,
        `${stage} guidance should not be empty`,
      );
    }
  });

  it('Foundation guidance focuses on adopt/scan', () => {
    const guidance = MATURITY_GUIDANCE_MAP.Foundation;
    assert.ok(guidance.includes('adopt'));
    assert.ok(guidance.includes('scan'));
    assert.ok(guidance.includes('Foundation'));
  });

  it('Tracking guidance focuses on hygiene metrics', () => {
    const guidance = MATURITY_GUIDANCE_MAP.Tracking;
    assert.ok(guidance.includes('triage'));
    assert.ok(guidance.includes('Tracking'));
  });

  it('Maintained guidance focuses on prescriptions remediation', () => {
    const guidance = MATURITY_GUIDANCE_MAP.Maintained;
    assert.ok(guidance.includes('prescriptions'));
    assert.ok(guidance.includes('Maintained'));
  });

  it('Autonomous guidance focuses on CI/CD automation', () => {
    const guidance = MATURITY_GUIDANCE_MAP.Autonomous;
    assert.ok(guidance.includes('CI/CD'));
    assert.ok(guidance.includes('Autonomous'));
  });
});

describe('maturity-aware coach templates (EP-0205)', () => {
  it('replaces {{MATURITY_STAGE}} in all built-in templates', () => {
    for (const tmpl of COACH_TEMPLATES) {
      const result = buildCoachPrompt(tmpl, {
        maturityStage: 'Foundation',
      });
      assert.ok(
        result.prompt.includes('Foundation'),
        `Template "${tmpl}" should contain maturity stage name`,
      );
      assert.ok(
        !result.prompt.includes('{{MATURITY_STAGE}}'),
        `Template "${tmpl}" should not have unreplaced {{MATURITY_STAGE}}`,
      );
    }
  });

  it('replaces {{MATURITY_GUIDANCE}} in all built-in templates', () => {
    for (const tmpl of COACH_TEMPLATES) {
      const result = buildCoachPrompt(tmpl, {
        maturityStage: 'Autonomous',
      });
      assert.ok(
        !result.prompt.includes('{{MATURITY_GUIDANCE}}'),
        `Template "${tmpl}" should not have unreplaced {{MATURITY_GUIDANCE}}`,
      );
      assert.ok(
        result.prompt.includes('Autonomous'),
        `Template "${tmpl}" should contain Autonomous guidance`,
      );
    }
  });

  it('shows different guidance for Foundation vs Autonomous (AC-4)', () => {
    const foundation = buildCoachPrompt('health', {
      healthJson: '{"health":{"score":30}}',
      maturityStage: 'Foundation',
    });
    const autonomous = buildCoachPrompt('health', {
      healthJson: '{"health":{"score":95}}',
      maturityStage: 'Autonomous',
    });

    // Foundation guidance focuses on adoption workflow
    assert.ok(foundation.prompt.includes('基盤構築フェーズ'));
    assert.ok(foundation.prompt.includes('adopt'));
    assert.ok(foundation.prompt.includes('scan'));

    // Autonomous guidance focuses on automation and org-wide deployment
    assert.ok(autonomous.prompt.includes('自律運用フェーズ'));
    assert.ok(autonomous.prompt.includes('退行防止'));
    assert.ok(autonomous.prompt.includes('組織展開'));

    // The two prompts should differ
    assert.notEqual(foundation.prompt, autonomous.prompt);
  });

  it('handles missing maturityStage gracefully (backward compatibility, AC-7)', () => {
    const result = buildCoachPrompt('triage', {
      triageJson: '{"items":[]}',
    });

    // Should not contain raw placeholders
    assert.ok(!result.prompt.includes('{{MATURITY_STAGE}}'));
    assert.ok(!result.prompt.includes('{{MATURITY_GUIDANCE}}'));
  });

  it('custom templates can use maturity placeholders (AC-6)', () => {
    const templateContent =
      'Stage: {{MATURITY_STAGE}} | Guidance: {{MATURITY_GUIDANCE}} | Data: {{HEALTH_JSON}}';
    const result = buildCoachPromptFromCustomTemplate(templateContent, {
      healthJson: '{"score":80}',
      maturityStage: 'Maintained',
    });

    assert.ok(result.prompt.includes('Stage: Maintained'));
    assert.ok(result.prompt.includes('prescriptions'));
    assert.ok(!result.prompt.includes('{{MATURITY_STAGE}}'));
    assert.ok(!result.prompt.includes('{{MATURITY_GUIDANCE}}'));
  });

  it('stage × template: each stage produces unique guidance per template', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];

    for (const tmpl of COACH_TEMPLATES) {
      const outputs = stages.map(
        (stage) => buildCoachPrompt(tmpl, { maturityStage: stage }).prompt,
      );

      // All four outputs should be different from each other
      for (let i = 0; i < outputs.length; i++) {
        for (let j = i + 1; j < outputs.length; j++) {
          assert.notEqual(
            outputs[i],
            outputs[j],
            `Template "${tmpl}": ${stages[i]} and ${stages[j]} should produce different outputs`,
          );
        }
      }
    }
  });
});

describe('COACH_PLACEHOLDERS (EP-0205 additions)', () => {
  it('has maturity-related placeholder tokens', () => {
    assert.equal(COACH_PLACEHOLDERS.MATURITY_STAGE, '{{MATURITY_STAGE}}');
    assert.equal(COACH_PLACEHOLDERS.MATURITY_GUIDANCE, '{{MATURITY_GUIDANCE}}');
  });
});

// ── Remediation Journey Diff Template (EP-0207) ──────────────

describe('resolveDiffBlock', () => {
  it('returns empty string when diffContext is undefined', () => {
    assert.equal(resolveDiffBlock(undefined), '');
  });

  it('returns empty string when no deltas (first run)', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 5,

        expiredRefs: 1,
        healthScore: 65,
        coverage: 70,
        hygiene: 60,
        maturityStage: 'Tracking',
      },
      diffSummaryOneLiner: 'baseline',
    };
    assert.equal(resolveDiffBlock(ctx), '');
  });

  it('returns diff table when deltas are present', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 5,
        expiredRefs: 1,
        healthScore: 75,
        coverage: 80,
        hygiene: 70,
        maturityStage: 'Maintained',
      },
      previous: {
        timestamp: '2026-03-25T10:00:00.000Z',
        totalIssues: 8,

        expiredRefs: 3,
        healthScore: 50,
        coverage: 60,
        hygiene: 55,
        maturityStage: 'Tracking',
      },
      deltas: {
        totalIssues: -3,
        expiredRefs: -2,
        healthScore: 25,
        coverage: 20,
        hygiene: 15,
      },
      diffSummaryOneLiner: 'score improved',
    };
    const block = resolveDiffBlock(ctx);
    assert.ok(block.includes('前回からの変化'));
    assert.ok(block.includes('健康スコア'));
    assert.ok(block.includes('+25'));
    assert.ok(block.includes('+20'));
    assert.ok(block.includes('+15'));
  });
});

describe('resolveStageTransition', () => {
  it('returns empty string when no diffContext', () => {
    assert.equal(resolveStageTransition(undefined), '');
  });

  it('returns empty string when no stage transition', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 5,

        expiredRefs: 0,
        healthScore: 65,
        coverage: 70,
        hygiene: 60,
        maturityStage: 'Tracking',
      },
      diffSummaryOneLiner: 'baseline',
    };
    assert.equal(resolveStageTransition(ctx), '');
  });

  it('returns celebration for advancement', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 5,

        expiredRefs: 0,
        healthScore: 85,
        coverage: 90,
        hygiene: 80,
        maturityStage: 'Maintained',
      },
      previous: {
        timestamp: '2026-03-25T10:00:00.000Z',
        totalIssues: 8,

        expiredRefs: 3,
        healthScore: 50,
        coverage: 60,
        hygiene: 55,
        maturityStage: 'Tracking',
      },
      deltas: {
        totalIssues: -3,

        expiredRefs: -3,
        healthScore: 35,
        coverage: 30,
        hygiene: 25,
      },
      stageTransition: { from: 'Tracking', to: 'Maintained' },
      diffSummaryOneLiner: 'stage advanced',
    };
    const block = resolveStageTransition(ctx);
    assert.ok(block.includes('おめでとう'));
    assert.ok(block.includes('Tracking'));
    assert.ok(block.includes('Maintained'));
  });

  it('returns warning for regression', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 10,

        expiredRefs: 5,
        healthScore: 30,
        coverage: 40,
        hygiene: 35,
        maturityStage: 'Foundation',
      },
      previous: {
        timestamp: '2026-03-25T10:00:00.000Z',
        totalIssues: 5,

        expiredRefs: 1,
        healthScore: 70,
        coverage: 80,
        hygiene: 65,
        maturityStage: 'Tracking',
      },
      deltas: {
        totalIssues: 5,

        expiredRefs: 4,
        healthScore: -40,
        coverage: -40,
        hygiene: -30,
      },
      stageTransition: { from: 'Tracking', to: 'Foundation' },
      diffSummaryOneLiner: 'stage regressed',
    };
    const block = resolveStageTransition(ctx);
    assert.ok(block.includes('ステージ変化'));
    assert.ok(block.includes('Tracking'));
    assert.ok(block.includes('Foundation'));
  });

  it('includes stage-specific celebration for Tracking advancement (EP-0211)', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 5,
        expiredRefs: 0,
        healthScore: 65,
        coverage: 75,
        hygiene: 50,
        maturityStage: 'Tracking',
      },
      previous: {
        timestamp: '2026-03-25T10:00:00.000Z',
        totalIssues: 8,
        expiredRefs: 2,
        healthScore: 30,
        coverage: 40,
        hygiene: 35,
        maturityStage: 'Foundation',
      },
      deltas: {
        totalIssues: -3,
        expiredRefs: -2,
        healthScore: 35,
        coverage: 35,
        hygiene: 15,
      },
      stageTransition: { from: 'Foundation', to: 'Tracking' },
      diffSummaryOneLiner: 'stage advanced',
    };
    const block = resolveStageTransition(ctx);
    assert.ok(block.includes(STAGE_CELEBRATION_MAP.Tracking));
    assert.ok(block.includes(NEXT_STAGE_ROADMAP.Tracking));
  });

  it('includes stage-specific celebration for Autonomous advancement (EP-0211)', () => {
    const ctx: CoachDiffContext = {
      current: {
        timestamp: '2026-04-01T10:00:00.000Z',
        totalIssues: 0,
        expiredRefs: 0,
        healthScore: 100,
        coverage: 95,
        hygiene: 95,
        maturityStage: 'Autonomous',
      },
      previous: {
        timestamp: '2026-03-25T10:00:00.000Z',
        totalIssues: 2,
        expiredRefs: 0,
        healthScore: 85,
        coverage: 90,
        hygiene: 80,
        maturityStage: 'Maintained',
      },
      deltas: {
        totalIssues: -2,
        expiredRefs: 0,
        healthScore: 15,
        coverage: 5,
        hygiene: 15,
      },
      stageTransition: { from: 'Maintained', to: 'Autonomous' },
      diffSummaryOneLiner: 'stage advanced',
    };
    const block = resolveStageTransition(ctx);
    assert.ok(block.includes(STAGE_CELEBRATION_MAP.Autonomous));
    assert.ok(block.includes(NEXT_STAGE_ROADMAP.Autonomous));
  });

  it('each stage transition produces distinct celebration content (EP-0211)', () => {
    const transitions: Array<{
      from: HealthMaturityStage;
      to: HealthMaturityStage;
    }> = [
      { from: 'Foundation', to: 'Tracking' },
      { from: 'Tracking', to: 'Maintained' },
      { from: 'Maintained', to: 'Autonomous' },
    ];
    const blocks = transitions.map((stageTransition) => {
      const ctx: CoachDiffContext = {
        current: {
          timestamp: '2026-04-01T10:00:00.000Z',
          totalIssues: 0,
          expiredRefs: 0,
          healthScore: 90,
          coverage: 90,
          hygiene: 90,
          maturityStage: stageTransition.to,
        },
        previous: {
          timestamp: '2026-03-25T10:00:00.000Z',
          totalIssues: 5,
          expiredRefs: 1,
          healthScore: 50,
          coverage: 50,
          hygiene: 50,
          maturityStage: stageTransition.from,
        },
        deltas: {
          totalIssues: -5,
          expiredRefs: -1,
          healthScore: 40,
          coverage: 40,
          hygiene: 40,
        },
        stageTransition,
        diffSummaryOneLiner: 'stage advanced',
      };
      return resolveStageTransition(ctx);
    });

    // All three celebration blocks should be distinct
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        assert.notEqual(
          blocks[i],
          blocks[j],
          `${transitions[i]!.to} and ${transitions[j]!.to} celebrations should differ`,
        );
      }
    }
  });
});

// ── Stage Celebration Map and Roadmap (EP-0211) ──────────────

describe('STAGE_CELEBRATION_MAP (EP-0211)', () => {
  it('has celebration messages for all four stages', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    for (const stage of stages) {
      assert.ok(
        stage in STAGE_CELEBRATION_MAP,
        `Missing celebration for ${stage}`,
      );
      assert.ok(
        STAGE_CELEBRATION_MAP[stage].length > 0,
        `${stage} celebration should not be empty`,
      );
    }
  });
});

describe('NEXT_STAGE_ROADMAP (EP-0211)', () => {
  it('has roadmap for all four stages', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];
    for (const stage of stages) {
      assert.ok(stage in NEXT_STAGE_ROADMAP, `Missing roadmap for ${stage}`);
      assert.ok(
        NEXT_STAGE_ROADMAP[stage].length > 0,
        `${stage} roadmap should not be empty`,
      );
    }
  });

  it('Foundation roadmap mentions Tracking as next stage', () => {
    assert.ok(NEXT_STAGE_ROADMAP.Foundation.includes('Tracking'));
    assert.ok(NEXT_STAGE_ROADMAP.Foundation.includes('shiori adopt'));
  });

  it('Tracking roadmap mentions Maintained as next stage', () => {
    assert.ok(NEXT_STAGE_ROADMAP.Tracking.includes('Maintained'));
    assert.ok(NEXT_STAGE_ROADMAP.Tracking.includes('shiori triage'));
  });

  it('Maintained roadmap mentions Autonomous as next stage', () => {
    assert.ok(NEXT_STAGE_ROADMAP.Maintained.includes('Autonomous'));
    assert.ok(NEXT_STAGE_ROADMAP.Maintained.includes('prescriptions'));
  });

  it('Autonomous roadmap provides maintenance guidance', () => {
    assert.ok(NEXT_STAGE_ROADMAP.Autonomous.includes('維持'));
    assert.ok(NEXT_STAGE_ROADMAP.Autonomous.includes('shiori delta'));
  });
});

// ── Stage Transition in JSON Output (EP-0211) ────────────────

describe('stageTransition in CoachResult (EP-0211)', () => {
  it('includes stageTransition data when stage advanced', () => {
    const result = buildCoachPrompt('health', {
      healthJson: '{"score":90}',
      diffContext: {
        current: {
          timestamp: '2026-04-01T10:00:00.000Z',
          totalIssues: 0,
          expiredRefs: 0,
          healthScore: 90,
          coverage: 90,
          hygiene: 90,
          maturityStage: 'Maintained',
        },
        previous: {
          timestamp: '2026-03-25T10:00:00.000Z',
          totalIssues: 5,
          expiredRefs: 1,
          healthScore: 50,
          coverage: 50,
          hygiene: 50,
          maturityStage: 'Tracking',
        },
        deltas: {
          totalIssues: -5,
          expiredRefs: -1,
          healthScore: 40,
          coverage: 40,
          hygiene: 40,
        },
        stageTransition: { from: 'Tracking', to: 'Maintained' },
        diffSummaryOneLiner: 'stage advanced',
      },
    });

    assert.ok(result.stageTransition);
    assert.equal(result.stageTransition!.from, 'Tracking');
    assert.equal(result.stageTransition!.to, 'Maintained');
    assert.equal(result.stageTransition!.advanced, true);
  });

  it('includes stageTransition with advanced=false for regression', () => {
    const result = buildCoachPrompt('health', {
      healthJson: '{"score":30}',
      diffContext: {
        current: {
          timestamp: '2026-04-01T10:00:00.000Z',
          totalIssues: 10,
          expiredRefs: 5,
          healthScore: 30,
          coverage: 40,
          hygiene: 35,
          maturityStage: 'Foundation',
        },
        previous: {
          timestamp: '2026-03-25T10:00:00.000Z',
          totalIssues: 5,
          expiredRefs: 1,
          healthScore: 70,
          coverage: 80,
          hygiene: 65,
          maturityStage: 'Tracking',
        },
        deltas: {
          totalIssues: 5,
          expiredRefs: 4,
          healthScore: -40,
          coverage: -40,
          hygiene: -30,
        },
        stageTransition: { from: 'Tracking', to: 'Foundation' },
        diffSummaryOneLiner: 'stage regressed',
      },
    });

    assert.ok(result.stageTransition);
    assert.equal(result.stageTransition!.from, 'Tracking');
    assert.equal(result.stageTransition!.to, 'Foundation');
    assert.equal(result.stageTransition!.advanced, false);
  });

  it('stageTransition is undefined when no transition occurred', () => {
    const result = buildCoachPrompt('health', {
      healthJson: '{"score":65}',
    });

    assert.equal(result.stageTransition, undefined);
  });

  it('stageTransition appears in JSON output format', () => {
    const result = buildCoachPrompt('health', {
      healthJson: '{"score":90}',
      diffContext: {
        current: {
          timestamp: '2026-04-01T10:00:00.000Z',
          totalIssues: 0,
          expiredRefs: 0,
          healthScore: 90,
          coverage: 90,
          hygiene: 90,
          maturityStage: 'Maintained',
        },
        previous: {
          timestamp: '2026-03-25T10:00:00.000Z',
          totalIssues: 5,
          expiredRefs: 1,
          healthScore: 50,
          coverage: 50,
          hygiene: 50,
          maturityStage: 'Tracking',
        },
        deltas: {
          totalIssues: -5,
          expiredRefs: -1,
          healthScore: 40,
          coverage: 40,
          hygiene: 40,
        },
        stageTransition: { from: 'Tracking', to: 'Maintained' },
        diffSummaryOneLiner: 'stage advanced',
      },
    });
    const output = formatCoachOutput(result, 'json');
    const envelope = JSON.parse(output);
    const data = envelope.data as {
      stageTransition?: { from: string; to: string; advanced: boolean };
    };

    assert.ok(data.stageTransition);
    assert.equal(data.stageTransition!.from, 'Tracking');
    assert.equal(data.stageTransition!.to, 'Maintained');
    assert.equal(data.stageTransition!.advanced, true);
  });
});

describe('diff placeholders in templates (EP-0207)', () => {
  it('replaces {{DIFF_SUMMARY}} in all built-in templates', () => {
    for (const tmpl of COACH_TEMPLATES) {
      const result = buildCoachPrompt(tmpl, {
        diffContext: {
          current: {
            timestamp: '2026-04-01T10:00:00.000Z',
            totalIssues: 5,

            expiredRefs: 0,
            healthScore: 65,
            coverage: 70,
            hygiene: 60,
            maturityStage: 'Tracking',
          },
          diffSummaryOneLiner: 'テストサマリー',
        },
      });
      assert.ok(
        !result.prompt.includes('{{DIFF_SUMMARY}}'),
        `Template "${tmpl}" should not have unreplaced {{DIFF_SUMMARY}}`,
      );
      assert.ok(
        result.prompt.includes('テストサマリー'),
        `Template "${tmpl}" should contain diff summary`,
      );
    }
  });

  it('replaces {{DIFF_BLOCK}} and {{STAGE_TRANSITION}} when no diff data', () => {
    const result = buildCoachPrompt('health', {
      healthJson: '{"score":80}',
    });
    assert.ok(!result.prompt.includes('{{DIFF_BLOCK}}'));
    assert.ok(!result.prompt.includes('{{STAGE_TRANSITION}}'));
  });

  it('custom templates can use diff placeholders', () => {
    const templateContent =
      'Summary: {{DIFF_SUMMARY}} | Block: {{DIFF_BLOCK}} | Trans: {{STAGE_TRANSITION}}';
    const result = buildCoachPromptFromCustomTemplate(templateContent, {
      diffContext: {
        current: {
          timestamp: '2026-04-01T10:00:00.000Z',
          totalIssues: 5,

          expiredRefs: 0,
          healthScore: 65,
          coverage: 70,
          hygiene: 60,
          maturityStage: 'Tracking',
        },
        diffSummaryOneLiner: 'カスタムサマリー',
      },
    });
    assert.ok(result.prompt.includes('カスタムサマリー'));
    assert.ok(!result.prompt.includes('{{DIFF_SUMMARY}}'));
    assert.ok(!result.prompt.includes('{{DIFF_BLOCK}}'));
    assert.ok(!result.prompt.includes('{{STAGE_TRANSITION}}'));
  });
});

describe('COACH_PLACEHOLDERS (EP-0207 additions)', () => {
  it('has diff-related placeholder tokens', () => {
    assert.equal(COACH_PLACEHOLDERS.DIFF_SUMMARY, '{{DIFF_SUMMARY}}');
    assert.equal(COACH_PLACEHOLDERS.DIFF_BLOCK, '{{DIFF_BLOCK}}');
    assert.equal(COACH_PLACEHOLDERS.STAGE_TRANSITION, '{{STAGE_TRANSITION}}');
  });
});
