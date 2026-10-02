# Governance Coach: LLM-Powered Governance Improvement Suggestions

A recipe that passes the output of `shiori triage --format json` and `shiori weekly-report --format json` to an LLM to generate governance improvement advice in natural language.

## Overview

It uses the annotation and health data that shiori accumulates as context for an LLM, automatically generating improvement suggestions tailored to your team's governance situation. It does not bring an LLM dependency into shiori itself; it combines structured output with an external LLM API (per [ADR 018](../decisions/018-external-service-integration.md)).

### Features

- **Zero infrastructure**: works with just the shiori CLI and an LLM API key
- **LLM-agnostic**: usable with any provider, such as OpenAI, Anthropic, Google, or a local LLM
- **Prompt template approach**: embed shiori's JSON output into a template and pass it to the LLM

## Prerequisites

- shiori is set up (`shiori init` is done and the registry has entries)
- An LLM API key (for example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- `jq` and `curl` (used in the script examples)

## Prompt templates

### Template 1: Triage advisor

Generates a prioritized action plan from the triage results.

````markdown
You are a software governance expert.
Below is a triage report JSON from shiori (an annotation tracking tool).

```json
{{TRIAGE_JSON}}
```

Analyze this triage result and write governance improvement suggestions in the following format:

## Analysis

- Summarize the current governance situation in 2-3 sentences
- If there are critical/high issues, infer their root causes

## Action plan for this week

Propose up to 3 actions in priority order:

1. **[Priority]** Action — reason and expected effect
   - Command: `shiori ...`

## Structural improvement suggestions

If there are recurring patterns, propose improvements to processes or rules.
````

### Template 2: Weekly report coach

Reads trends from the weekly report and generates feedback for the team.

````markdown
You are a governance coach for a software team.
Below is a weekly governance report JSON from shiori.

```json
{{WEEKLY_REPORT_JSON}}
```

Analyze this report and write feedback in a form that can be shared in a team meeting:

## This week's highlights

- Explain the change in health score and its causes in 1-2 sentences
- Give specific praise for any positive trends

## Points to watch

- Causes of a score drop, and patterns in increasing annotations
- Status of handling expired and expiring-soon annotations

## Looking ahead to next week

- Propose 1-2 specific improvement actions
- Attach the corresponding shiori command to each action
````

### Template 3: Health diagnosis

Generates a prescription from the health results.

````markdown
You are an expert at diagnosing the health of a codebase.
Below are the health check results from shiori.

```json
{{HEALTH_JSON}}
```

Output the diagnosis in the following format:

## Diagnosis summary

State your findings on the score of {{SCORE}}/100 in 2-3 sentences.

## Prescription

Up to 3 items, in order of improvement impact:

| Priority | Prescription | Expected score improvement | Command |
| -------- | ------------ | -------------------------- | ------- |
| ...      | ...          | ...                        | ...     |

## Prognosis

A score forecast for one month from now if improvement continues at the current pace, with the rationale.
````

## Usage

### Basic: shell script

```bash
#!/bin/bash
# scripts/governance-coach.sh
# Usage: OPENAI_API_KEY=sk-... ./scripts/governance-coach.sh

set -euo pipefail

# Step 1: Get shiori's JSON output
TRIAGE_JSON=$(npx shiori triage --format json)
WEEKLY_JSON=$(npx shiori weekly-report --preset weekly --format json)

# Step 2: Build the prompt
PROMPT=$(cat <<PROMPT_EOF
You are a software governance expert.
Below are two reports from shiori (an annotation tracking tool).

## Triage report
\`\`\`json
${TRIAGE_JSON}
\`\`\`

## Weekly report
\`\`\`json
${WEEKLY_JSON}
\`\`\`

Analyze these two reports together and output the following:
1. Summary of the current situation (2-3 sentences)
2. Top-priority action for this week (1 item, with a shiori command)
3. Medium-term improvement suggestion (1 item)
PROMPT_EOF
)

# Step 3: Call the LLM API
curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "$(jq -n --arg prompt "$PROMPT" '{
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: $prompt }],
    temperature: 0.3
  }')" | jq -r '.choices[0].message.content'
```

### CI integration: GitHub Actions

````yaml
# .github/workflows/shiori-coach.yml
name: shiori governance coach

on:
  schedule:
    # Every Monday 9:00 JST (0:00 UTC)
    - cron: '0 0 * * 1'
  workflow_dispatch:

jobs:
  coach:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Generate governance data
        run: |
          npx shiori triage --format json > /tmp/triage.json
          npx shiori weekly-report --preset weekly --format json > /tmp/weekly.json

      - name: Generate coaching advice
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          TRIAGE=$(cat /tmp/triage.json)
          WEEKLY=$(cat /tmp/weekly.json)

          ADVICE=$(curl -s https://api.openai.com/v1/chat/completions \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${OPENAI_API_KEY}" \
            -d "$(jq -n \
              --arg triage "$TRIAGE" \
              --arg weekly "$WEEKLY" \
              '{
                model: "gpt-4o-mini",
                messages: [{
                  role: "user",
                  content: ("Analyze the shiori governance data and write improvement suggestions.\n\n## Triage\n```json\n" + $triage + "\n```\n\n## Weekly Report\n```json\n" + $weekly + "\n```\n\nOutput format:\n1. Summary of the current situation (2-3 sentences)\n2. Top-priority action for this week (with a shiori command)\n3. Medium-term improvement suggestion")
                }],
                temperature: 0.3
              }')" | jq -r '.choices[0].message.content')

          echo "## 🧑‍🏫 Governance Coach" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "$ADVICE" >> "$GITHUB_STEP_SUMMARY"

      - name: Post to Slack (optional)
        if: env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          # Forward the contents of the Step Summary to Slack
          SUMMARY=$(cat "$GITHUB_STEP_SUMMARY")
          curl -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg text "$SUMMARY" '{ text: $text }')"
````

> **When using the Anthropic API:** In the `Generate coaching advice` step, replace `OPENAI_API_KEY` with `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`, and make the curl command the same form as the script in the [Anthropic API (Claude)](#anthropic-api-claude) section.

### Local LLM (Ollama)

```bash
#!/bin/bash
# No LLM API key needed; runs locally with Ollama
TRIAGE_JSON=$(npx shiori triage --format json)

curl -s http://localhost:11434/api/generate \
  -d "$(jq -n --arg triage "$TRIAGE_JSON" '{
    model: "llama3.1",
    prompt: ("Analyze the shiori triage result and write improvement suggestions:\n" + $triage),
    stream: false
  }')" | jq -r '.response'
```

### Anthropic API (Claude)

````bash
#!/bin/bash
# scripts/governance-coach-anthropic.sh
# Usage: ANTHROPIC_API_KEY=sk-ant-... ./scripts/governance-coach-anthropic.sh

set -euo pipefail

TRIAGE_JSON=$(npx shiori triage --format json)
WEEKLY_JSON=$(npx shiori weekly-report --preset weekly --format json)

curl -s https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -d "$(jq -n \
    --arg triage "$TRIAGE_JSON" \
    --arg weekly "$WEEKLY_JSON" \
    '{
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: ("You are a software governance expert. Analyze the two shiori reports together and write improvement suggestions.\n\n## Triage report\n```json\n" + $triage + "\n```\n\n## Weekly report\n```json\n" + $weekly + "\n```\n\nOutput format:\n1. Summary of the current situation (2-3 sentences)\n2. Top-priority action for this week (1 item, with a shiori command)\n3. Medium-term improvement suggestion (1 item)")
      }]
    }')" | jq -r '.content[0].text'
````

### Integration with Claude Code

If you use Claude Code, you can pass shiori's output directly into the prompt:

```bash
# Use the triage result as context for Claude Code
npx shiori triage --format json | pbcopy
# → Paste into Claude Code and ask "Analyze this triage result and write improvement suggestions"
```

## Key points of the JSON output schema

### triage (`shiori triage --format json`)

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "items": [
    {
      "ref": "SUP-1234",
      "priority": "critical",
      "issues": [{ "type": "expired", "ref": "SUP-1234", "message": "..." }],
      "sourceLocations": [
        { "file": "src/foo.ts", "line": 42, "rule": "no-console" }
      ],
      "action": "shiori update SUP-1234 --expires=2026-06-30"
    }
  ],
  "summary": {
    "total": 5,
    "byPriority": { "critical": 1, "high": 2, "medium": 1, "low": 1 }
  }
}
```

### weekly-report (`shiori weekly-report --format json`)

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "period": { "since": "2026-03-17", "until": "2026-03-24" },
  "activity": {
    "totalOperations": 5,
    "successRate": 100,
    "netChange": 2,
    "uniqueRefs": ["SUP-1234", "SUP-5678"]
  },
  "health": { "score": 85, "level": "healthy", "summary": "..." },
  "registryOverview": {
    "totalEntries": 12,
    "totalAnnotations": 15,
    "totalCandidates": 3,
    "totalIssues": 2
  },
  "insights": [{ "category": "warning", "message": "..." }],
  "velocity": { "count": 0 }
}
```

## Customization

### Prompt tuning points

- **Temperature**: around `0.3` is stable. Raising it produces more creative suggestions
- **Output language**: specify it in the prompt (Japanese/English)
- **Focus area**: narrow it down with instructions such as "focus on security" or "analyze only expired items"
- **Output format**: specify Markdown tables, bullet lists, Slack blocks, etc. in the prompt

### Trend analysis across multiple snapshots

Combined with the Observatory recipe, you can ask for trend analysis that includes past snapshots:

```bash
# Combine the snapshots for the last 4 weeks
SNAPSHOTS=$(for f in observatory/data/*.json; do cat "$f"; echo ","; done | sed '$ s/,$//' | jq -s '.')

# Prompt with trends
curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -d "$(jq -n --arg data "$SNAPSHOTS" '{
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: ("Analyze the governance snapshots for the past 4 weeks as a time series:\n" + $data) }]
  }')" | jq -r '.choices[0].message.content'
```

## Position in the governance maturity model

| Level | Name        | Mechanism                                  | Recipe                                                   |
| ----- | ----------- | ------------------------------------------ | -------------------------------------------------------- |
| 0     | Invisible   | Violations are hidden by lint disable      | —                                                        |
| 1     | Visible     | Notify of the diff via PR comment          | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced    | Block with a PR status check               | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured    | Trend tracking + dashboard                 | [Observatory](./governance-observatory.md)               |
| 4     | **Coached** | **An LLM proposes improvements from data** | **This recipe**                                          |
| 4+    | Broadcast   | Automatically deliver coaching to the team | [Coach Broadcast](./governance-coach-broadcast.md)       |

Level 4 is the state where an LLM, based on accumulated governance data, makes context-aware improvement suggestions and supports the team's decision-making.

## Dogfooding: example run on shiori itself

The shiori project itself self-tracks annotations in `.config/shiori/registry.json`. Below is an example of the input and output when running Governance Coach against shiori's development registry.

### Example input: triage JSON (excerpt)

```json
{
  "timestamp": "2026-03-23T00:00:00.000Z",
  "items": [
    {
      "ref": "DEV-002",
      "priority": "high",
      "issues": [
        {
          "type": "expiring-soon",
          "ref": "DEV-002",
          "message": "expires 2026-06"
        }
      ],
      "registryEntry": {
        "reason": "Type assertion for runtime-validated JSON parsed as ReportResult",
        "target": "src/commands/trend-cli.ts",
        "expires": "2026-06",
        "ticket": "EP-0011",
        "owner": "berlysia",
        "kind": "type-assertion"
      },
      "sourceLocations": [{ "file": "src/commands/trend-cli.ts", "line": 25 }],
      "action": "extend expires or resolve"
    },
    {
      "ref": "DEV-007",
      "priority": "high",
      "issues": [
        {
          "type": "expiring-soon",
          "ref": "DEV-007",
          "message": "expires 2026-06"
        }
      ],
      "registryEntry": {
        "reason": "Config file parsed from JSON/YAML cast to ShioriConfig without schema validation",
        "target": "src/core/config.ts",
        "expires": "2026-06",
        "ticket": "EP-0011",
        "owner": "berlysia",
        "kind": "type-assertion"
      },
      "sourceLocations": [{ "file": "src/core/config.ts", "line": 42 }],
      "action": "extend expires or resolve"
    }
  ],
  "summary": {
    "total": 2,
    "byPriority": { "critical": 0, "high": 2, "medium": 0, "low": 0 }
  }
}
```

### Example input: weekly-report JSON (excerpt)

```json
{
  "timestamp": "2026-03-23T00:00:00.000Z",
  "period": { "since": "2026-03-16", "until": "2026-03-23" },
  "activity": {
    "totalOperations": 3,
    "successfulOperations": 3,
    "failedOperations": 0,
    "successRate": 100,
    "netChange": 0,
    "uniqueRefs": ["DEV-018", "DEV-019"],
    "byEventType": { "scan": 2, "verify": 1 }
  },
  "health": {
    "level": "warning",
    "score": 72,
    "summary": "2 entries expiring soon (EP-0011 type assertions)"
  },
  "registryOverview": {
    "totalEntries": 11,
    "totalAnnotations": 11,
    "totalCandidates": 0,
    "totalIssues": 2
  },
  "insights": [
    {
      "category": "warning",
      "message": "2 type-assertion entries expire in 2026-06; resolve via EP-0011 JSON Schema validation"
    }
  ]
}
```

### Example LLM output

An example of the output when the above is passed to the Governance Coach template:

> **Summary of the current situation:** The shiori project self-tracks 11 annotations, and overall operation is stable. However, two type-assertion suppressions (DEV-002, DEV-007) tied to EP-0011 (JSON Schema validation) expire in 2026-06, so action is needed.
>
> **Top-priority action this week:** Check the progress of EP-0011, and if it can be completed in time, resolve them with `shiori resolve --ref DEV-002 --apply` and `shiori resolve --ref DEV-007 --apply`. If it cannot be completed in time, extend expires with `shiori update`.
>
> **Medium-term improvement suggestion:** Because type-assertion suppressions make up the majority of the registry, prioritizing the JSON Schema validation implementation in EP-0011 and structurally eliminating the need for type assertions can improve the registry's health score.

### Reproduction steps

```bash
# Run at the shiori project root
npx shiori triage --format json > /tmp/triage.json
npx shiori weekly-report --preset health --format json > /tmp/weekly.json

# Run Coach with any LLM API (see the shell script examples above)
```

---

## Related

- [Coach Broadcast](./governance-coach-broadcast.md) — recipe for automatic delivery to Slack / GitHub Discussions
- [Governance Observatory](./governance-observatory.md) — time-series dashboard (snapshot accumulation)
- [GitHub Actions Step Summary](./github-actions-step-summary.md) — display CI results in the Step Summary
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — automatic Issue generation
- [Slack Notification](./slack-notification.md) — Slack notification recipe
