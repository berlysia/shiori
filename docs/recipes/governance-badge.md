# GitHub Actions: Governance Score Badge

A recipe that shows the repository's governance score in the README as a shields.io badge.

## Overview

This recipe provides the following:

1. **Scan and report in CI**: generate shields.io endpoint JSON with `shiori report --format badge`
2. **Upload to a Gist**: save the JSON to a GitHub Gist with `exuanbo/actions-deploy-gist`
3. **Embed the badge in the README**: show a real-time badge via the shields.io endpoint URL

The badge color changes automatically depending on the score:

| Score | Color          | Level    |
| ----- | -------------- | -------- |
| ≥ 80  | 🟢 brightgreen | healthy  |
| 50–79 | 🟡 yellow      | warning  |
| < 50  | 🔴 red         | critical |

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is already added to the project's devDependencies
- A GitHub Gist has been created (to host the endpoint JSON)
- A `GIST_TOKEN` secret with write permission to the Gist has been set

## Setup steps

### 1. Create a Gist

Create a new Gist on GitHub:

- File name: `shiori-badge.json`
- Content (initial value):
  ```json
  {
    "schemaVersion": 1,
    "label": "governance",
    "message": "pending",
    "color": "lightgrey"
  }
  ```
- Note the Gist ID (the end of the URL: `https://gist.github.com/<user>/<gist-id>`)

### 2. Issue a Personal Access Token (PAT)

- GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Repository permissions are not needed. Grant only `Read and write` permission for Gists
- Save it as `GIST_TOKEN` in the repository's Secrets

### 3. Add the workflow

```yaml
# .github/workflows/shiori-badge.yml
name: shiori badge

on:
  push:
    branches: [main]
  # Daily update (optional)
  schedule:
    - cron: '0 0 * * *'

jobs:
  badge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
        with:
          version: latest

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Generate badge JSON
        run: node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json

      - name: Upload to Gist
        uses: exuanbo/actions-deploy-gist@v1
        with:
          token: ${{ secrets.GIST_TOKEN }}
          gist_id: YOUR_GIST_ID # ← replace with the Gist ID you created
          file_path: .tmp/shiori-badge.json
          file_type: text
```

### 4. Embed the badge in the README

```markdown
[![Governance Score](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2F<user>%2F<gist-id>%2Fraw%2Fshiori-badge.json)](https://gist.github.com/<user>/<gist-id>)
```

Replace `<user>` and `<gist-id>` with the actual values.

---

## Alternative: use GitHub Actions Artifacts

A lightweight method that saves the badge JSON as a CI artifact instead of using a Gist:

```yaml
- name: Build
  run: pnpm build

- name: Generate badge JSON
  run: node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json

- name: Upload badge artifact
  uses: actions/upload-artifact@v7
  with:
    name: shiori-badge
    path: .tmp/shiori-badge.json
    retention-days: 90
    overwrite: true
```

This method cannot show a real-time README badge, but you can track the score trend through CI history.

---

## Output format

`shiori report --format badge` outputs shields.io endpoint JSON:

```json
{
  "schemaVersion": 1,
  "label": "governance",
  "message": "85/100",
  "color": "brightgreen"
}
```

Field meanings:

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `schemaVersion` | shields.io endpoint schema version (always `1`)          |
| `label`         | Text on the left side of the badge (`governance`)        |
| `message`       | Text on the right side of the badge (`score/100` format) |
| `color`         | shields.io color name (`brightgreen`, `yellow`, `red`)   |

---

## Customization

### Change the schedule frequency

```yaml
# Update every Monday at 9:00 UTC
schedule:
  - cron: '0 9 * * 1'
```

### Fail CI when there are verify errors

```yaml
- name: Generate badge and verify
  run: |
    node dist/src/cli.js report --format badge --output .tmp/shiori-badge.json
    node dist/src/cli.js verify --fail-on missing-in-registry,expired
```

---

## Troubleshooting

### The badge stays at "pending"

The Gist may not have been updated. Check the `Upload to Gist` step in the workflow run log. Check that the permissions of `GIST_TOKEN` are set correctly.

### The badge does not appear on shields.io

shields.io caches the Gist raw URL (up to 5 minutes). On the first run, wait a few minutes and reload. Check that the URL encoding is correct.

### The score is different from what you expected

Run `shiori report` manually to check the score breakdown:

```bash
node dist/src/cli.js report --format json | jq '.health'
```

---

## Use the Composite Action for simplicity

A composite action is available that reduces the YAML above to a few lines:

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: badge
    gist-token: ${{ secrets.GIST_TOKEN }}
    gist-id: ${{ vars.SHIORI_BADGE_GIST_ID }}
```

See the [Composite Action recipe](./github-actions-composite-action.md) for details.

---

## Related

- [Composite Action recipe](./github-actions-composite-action.md)
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md)
- [Alert-to-Ref Bridge recipe](./alert-to-ref.md)
