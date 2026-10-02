# Governance Coach Broadcast: Automated Slack / GitHub Discussions Posts

A recipe that runs the output of `shiori coach` in CI and broadcasts it to the team weekly via a Slack Incoming Webhook or the GitHub Discussions API.

## Overview

The [Governance Coach](./governance-coach.md) recipe generates prompts with the `shiori coach` command, but copying and pasting them by hand does not become a habit. This recipe uses CI (GitHub Actions) to automate the following:

1. **Scheduled runs**: Generate a coaching prompt on a weekly cron schedule
2. **Team broadcast**: Post automatically to a Slack channel or GitHub Discussions
3. **Snapshot diffs**: Inject sprint-over-sprint progress automatically

### How This Differs from Governance Coach

| Item         | [Governance Coach](./governance-coach.md)   | This recipe                                             |
| ------------ | ------------------------------------------- | ------------------------------------------------------- |
| Purpose      | Learn how to generate LLM prompts           | Automatically broadcast the generated prompts to a team |
| Execution    | Manual (CLI / shell script)                 | Automated (CI cron)                                     |
| Audience     | Individual developers                       | The whole team                                          |
| Maturity     | Level 3+ (Measured)                         | Level 4 (Coached)                                       |
| Prerequisite | Understanding of the `shiori coach` command | Completion of the Governance Coach recipe               |

## Prerequisites

- shiori is set up (`shiori init` done, and the registry has entries)
- The `shiori coach` command is available (v0.1.1+)
- Configuration for your destination:
  - **Slack**: An Incoming Webhook URL (stored in the repository Secrets as `SLACK_WEBHOOK`)
  - **GitHub Discussions**: Discussions enabled on the repository, and the `discussions: write` permission for `GITHUB_TOKEN`

## Setup

### Preparing a Slack Incoming Webhook

1. Create an Incoming Webhook in the [Slack API](https://api.slack.com/messaging/webhooks)
2. Choose the channel to post to (e.g. `#governance`)
3. Store the Webhook URL in the repository Secrets as `SLACK_WEBHOOK`

### Preparing GitHub Discussions

1. Enable Settings → Features → Discussions in the repository
2. Create a "Governance" category (recommended)
3. Add `discussions: write` to the workflow's `permissions`

## Workflows

> **About the CLI path**: The samples below use `node dist/src/cli.js`. This is the usual path in a project that installs shiori in devDependencies. In a monorepo, read it as a package-relative path such as `node packages/shiori-cli/dist/src/cli.js`. `npx shiori` also works.

### Pattern 1: Slack broadcast

```yaml
# .github/workflows/shiori-coach-broadcast.yml
name: shiori coach broadcast

on:
  schedule:
    # Every Monday 9:00 JST (0:00 UTC)
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions: {}

jobs:
  broadcast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - name: Generate coach prompt (Slack format)
        run: |
          node dist/src/cli.js coach \
            --template health \
            --format slack-markdown \
            --snapshot-dir .config/shiori/coach-snapshots \
            > /tmp/coach-output.txt

      - name: Post to Slack
        if: env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          ADVICE=$(cat /tmp/coach-output.txt)
          curl -s -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg text "$ADVICE" '{ text: $text }')"

      # Save the coach snapshot (for diffing against the next run)
      - name: Upload coach snapshot
        uses: actions/upload-artifact@v7
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

### Pattern 2: GitHub Discussions broadcast

```yaml
# .github/workflows/shiori-coach-discussions.yml
name: shiori coach discussions

on:
  schedule:
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions: {}

jobs:
  broadcast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      discussions: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - name: Generate coach prompt (Discussion format)
        run: |
          node dist/src/cli.js coach \
            --template health \
            --format github-discussion \
            --snapshot-dir .config/shiori/coach-snapshots \
            > /tmp/coach-output.md

      - name: Create GitHub Discussion
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BODY=$(cat /tmp/coach-output.md)
          TITLE="Weekly Governance Coach — $(date -u +%Y-%m-%d)"
          gh api graphql -f query='
            mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
              createDiscussion(input: {repositoryId: $repoId, categoryId: $categoryId, title: $title, body: $body}) {
                discussion { url }
              }
            }' \
            -f repoId="$(gh repo view --json id -q .id)" \
            -f categoryId="$(gh api graphql -f query='
              query($owner: String!, $name: String!) {
                repository(owner: $owner, name: $name) {
                  discussionCategories(first: 20) {
                    nodes { id name }
                  }
                }
              }' \
              -f owner="$(gh repo view --json owner -q .owner.login)" \
              -f name="$(gh repo view --json name -q .name)" \
              -q '.data.repository.discussionCategories.nodes[] | select(.name == "Governance") | .id')" \
            -f title="$TITLE" \
            -f body="$BODY"

      - name: Upload coach snapshot
        uses: actions/upload-artifact@v7
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

### Pattern 3: Combined Slack + Discussions

To broadcast to both Slack and Discussions at the same time, merge the steps of patterns 1 and 2 into a single workflow:

```yaml
# .github/workflows/shiori-coach-broadcast.yml
name: shiori coach broadcast

on:
  schedule:
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions: {}

jobs:
  broadcast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      discussions: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      # Generate the Slack prompt and the Discussion prompt side by side
      - name: Generate coach prompts
        run: |
          node dist/src/cli.js coach \
            --template health \
            --format slack-markdown \
            --snapshot-dir .config/shiori/coach-snapshots \
            > /tmp/coach-slack.txt

          node dist/src/cli.js coach \
            --template health \
            --format github-discussion \
            --snapshot-dir .config/shiori/coach-snapshots \
            > /tmp/coach-discussion.md

      - name: Post to Slack
        if: env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          ADVICE=$(cat /tmp/coach-slack.txt)
          curl -s -X POST "$SLACK_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg text "$ADVICE" '{ text: $text }')"

      - name: Create GitHub Discussion
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BODY=$(cat /tmp/coach-discussion.md)
          TITLE="Weekly Governance Coach — $(date -u +%Y-%m-%d)"
          gh api graphql -f query='
            mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
              createDiscussion(input: {repositoryId: $repoId, categoryId: $categoryId, title: $title, body: $body}) {
                discussion { url }
              }
            }' \
            -f repoId="$(gh repo view --json id -q .id)" \
            -f categoryId="$(gh api graphql -f query='
              query($owner: String!, $name: String!) {
                repository(owner: $owner, name: $name) {
                  discussionCategories(first: 20) {
                    nodes { id name }
                  }
                }
              }' \
              -f owner="$(gh repo view --json owner -q .owner.login)" \
              -f name="$(gh repo view --json name -q .name)" \
              -q '.data.repository.discussionCategories.nodes[] | select(.name == "Governance") | .id')" \
            -f title="$TITLE" \
            -f body="$BODY"

      - name: Upload coach snapshot
        uses: actions/upload-artifact@v7
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

## Choosing a Template

The `--template` flag changes what is broadcast:

| Template   | Use                               | Recommended frequency |
| ---------- | --------------------------------- | --------------------- |
| `triage`   | Prioritized action plan           | Weekly                |
| `weekly`   | Coaching on the weekly report     | Weekly                |
| `health`   | Health diagnosis and prescription | Weekly to biweekly    |
| `combined` | All reports combined              | Monthly               |

## Injecting Diffs from Snapshots

When you pass `--snapshot-dir`, the diff against the previous coaching run is injected automatically:

- `{{DIFF_SUMMARY}}`: A one-liner such as `"Health: 75→80 (+5), Coverage: +3"`
- `{{DIFF_BLOCK}}`: A previous / current / delta comparison table
- `{{STAGE_TRANSITION}}`: A congratulatory message when the stage is promoted

Snapshots are rotated LRU-style with `--max-snapshots` (default: 10).

### Persisting Snapshots in CI

In GitHub Actions the filesystem does not persist between jobs, so you need to save snapshots as an artifact and restore them on the next run:

```yaml
# Download the previous snapshot (skipped on the first run)
- name: Restore coach snapshots
  uses: actions/download-artifact@v8
  with:
    name: coach-snapshot
    path: .config/shiori/coach-snapshots/
  continue-on-error: true

# Run coach (the diff is injected if a snapshot is found)
- name: Generate coach prompt
  run: |
    node dist/src/cli.js coach \
      --template health \
      --format slack-markdown \
      --snapshot-dir .config/shiori/coach-snapshots \
      > /tmp/coach-output.txt

# Upload the latest snapshot
- name: Upload coach snapshot
  uses: actions/upload-artifact@v7
  with:
    name: coach-snapshot
    path: .config/shiori/coach-snapshots/
    retention-days: 90
    overwrite: true
```

## Customization

### Changing the Broadcast Frequency

```yaml
# Biweekly (1st and 3rd Monday)
schedule:
  - cron: '0 0 1-7,15-21 * 1'

# Monthly (1st of each month)
schedule:
  - cron: '0 0 1 * *'
```

### Adding LLM Integration

`shiori coach` only generates the prompt and does not call an LLM API. To call an LLM inside CI and generate the advice automatically, see the shell script example in the [Governance Coach recipe](./governance-coach.md):

```yaml
- name: Generate coaching advice via LLM
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    PROMPT=$(node dist/src/cli.js coach -t health -f prompt)
    ADVICE=$(curl -s https://api.openai.com/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${OPENAI_API_KEY}" \
      -d "$(jq -n --arg prompt "$PROMPT" '{
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: $prompt }],
        temperature: 0.3
      }')" | jq -r '.choices[0].message.content')

    # Post the LLM advice to Slack
    curl -s -X POST "$SLACK_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg text "$ADVICE" '{ text: $text }')"
```

### Improving the Look with Slack Block Kit

Incoming Webhooks also accept Block Kit:

```bash
curl -s -X POST "$SLACK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg text "$ADVICE" '{
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Governance Coach" } },
      { type: "section", text: { type: "mrkdwn", text: $text } }
    ]
  }')"
```

## Troubleshooting

### Nothing is posted to Slack

- Check that the Webhook URL is correct: `curl -s -X POST "$SLACK_WEBHOOK" -d '{"text":"test"}'`
- Check that the `SLACK_WEBHOOK` secret is set
- Check the workflow's `if: env.SLACK_WEBHOOK != ''` condition

### The GitHub Discussion is not created

- Check that Discussions is enabled on the repository
- Check that the "Governance" category exists (category names are case-sensitive)
- Check the `discussions: write` permission of `GITHUB_TOKEN`

### The snapshot diff is not shown

- Check that `--snapshot-dir` points to the correct path
- Check that the previous snapshot artifact exists (there is no diff on the first run)
- Check that `continue-on-error: true` is set on the restore step

## Position in the Governance Maturity Model

| Level | Name          | Mechanism                                           | Recipe                                                   |
| ----- | ------------- | --------------------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible     | Violations are hidden by lint disable               | --                                                       |
| 1     | Visible       | Diffs are reported in PR comments                   | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced      | PR status checks block merges                       | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured      | Trend tracking + dashboard                          | [Observatory](./governance-observatory.md)               |
| 4     | **Coached**   | **An LLM proposes data-driven improvements**        | [Governance Coach](./governance-coach.md)                |
| 4+    | **Broadcast** | **Coaching is broadcast to the team automatically** | **This recipe**                                          |

As the consolidation phase of Level 4 (Coached), this recipe turns generating the coaching prompt into a team ritual.

---

## Related

- [Governance Coach](./governance-coach.md) -- The foundation recipe for LLM prompt generation
- [Slack Notification](./slack-notification.md) -- A simple Slack notification recipe
- [Slack Governance Pulse](./slack-pulse.md) -- Block Kit dashboard broadcast
- [Governance Observatory](./governance-observatory.md) -- Time-series dashboard
- [Governance Badge](./governance-badge.md) -- README badge display
