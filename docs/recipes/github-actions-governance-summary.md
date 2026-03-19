# GitHub Actions: Governance Summary PR Comment

PR コメントに delta だけでなく、coverage・hygiene・trend を統合した「ガバナンスサマリー」を1コメントで表示するレシピ。

## 概要

delta 単体では「+1 件追加」の重大さが判断できません。coverage 85% のリポジトリでの +1 件と coverage 30% のリポジトリでの +1 件は意味が全く異なります。

このレシピは以下のコマンドを統合し、1つの PR コメントでリポジトリのガバナンス全体像を提供します：

1. **`shiori delta`** — この PR での差分（追加・削除）
2. **`shiori health`** — ガバナンススコア（coverage, hygiene）
3. **`shiori trend`** — スコアの時系列トレンド
4. **`shiori triage`** — 優先度付きアクションリスト

## PR コメントの表示例

```markdown
<!-- shiori-governance-summary -->

## 🔖 Governance Summary

### Delta (this PR)

| Metric     | Count |
| ---------- | ----- |
| ➕ Added   | 1     |
| ➖ Removed | 2     |
| ∆ Net      | -1    |

### Health Score

| Metric   | Score  | Status |
| -------- | ------ | ------ |
| Overall  | 82/100 | 🟢     |
| Coverage | 91%    | 🟢     |
| Hygiene  | 73%    | 🟡     |

### Trend (last 5 snapshots)
```

Score: 78 → 80 → 79 → 81 → 82 ▲

```

<details>
<summary>📋 Triage (2 items)</summary>

| Priority | Ref | Issue | Action |
|----------|-----|-------|--------|
| 🔴 critical | SUP-1234 | expired | `shiori resolve --ref SUP-1234` |
| 🟡 high | SUP-9999 | missing-in-registry | `shiori update` |

</details>
```

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- [Baseline ワークフロー](./github-actions-delta-pr-comment.md) が設定済み（delta 用）
- Health snapshot が蓄積されていること（trend 用、なくても動作する）

## ワークフロー

```yaml
# .github/workflows/shiori-governance-summary.yml
name: shiori governance summary

on:
  pull_request:
    branches: [main]

jobs:
  governance-summary:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # 1. Download baseline (same as pr-comment recipe)
      - name: Download baseline scan artifact
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const workflows = await github.rest.actions.listRepoWorkflows({
              owner: context.repo.owner,
              repo: context.repo.repo,
            });
            const baselineWorkflow = workflows.data.workflows.find(
              w => w.name === 'shiori baseline'
            );
            if (!baselineWorkflow) return;
            const runs = await github.rest.actions.listWorkflowRuns({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: baselineWorkflow.id,
              branch: 'main',
              status: 'success',
              per_page: 1,
            });
            if (runs.data.workflow_runs.length === 0) return;
            const artifacts = await github.rest.actions.listWorkflowRunArtifacts({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runs.data.workflow_runs[0].id,
            });
            const artifact = artifacts.data.artifacts.find(
              a => a.name === 'shiori-base-scan'
            );
            if (!artifact) return;
            const download = await github.rest.actions.downloadArtifact({
              owner: context.repo.owner,
              repo: context.repo.repo,
              artifact_id: artifact.id,
              archive_format: 'zip',
            });
            fs.mkdirSync('.tmp', { recursive: true });
            fs.writeFileSync('.tmp/shiori-base-scan.zip', Buffer.from(download.data));
            require('child_process').execSync('unzip -o .tmp/shiori-base-scan.zip -d .tmp/');
        continue-on-error: true

      # 2. Gather all data
      - name: Scan (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      - name: Compute delta
        id: delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format json \
            --base-fallback-empty \
            --max-increase 0 \
            --output .tmp/shiori-delta.json
        continue-on-error: true

      - name: Health check
        run: pnpm shiori health --format json --output .tmp/shiori-health.json
        continue-on-error: true

      - name: Trend data
        run: pnpm shiori trend --format json --output .tmp/shiori-trend.json
        continue-on-error: true

      - name: Triage report
        run: pnpm shiori triage --format json --output .tmp/shiori-triage.json
        continue-on-error: true

      # 3. Assemble summary comment
      - name: Build governance summary
        shell: bash
        run: |
          cat > .tmp/shiori-summary.md << 'HEADER'
          <!-- shiori-governance-summary -->

          ## 🔖 Governance Summary

          HEADER

          # Delta section
          if [ -f .tmp/shiori-delta.json ]; then
            ADDED=$(jq '.summary.added // 0' .tmp/shiori-delta.json)
            REMOVED=$(jq '.summary.removed // 0' .tmp/shiori-delta.json)
            NET=$(jq '.summary.net // 0' .tmp/shiori-delta.json)
            cat >> .tmp/shiori-summary.md << EOF
          ### Delta (this PR)

          | Metric | Count |
          |--------|-------|
          | ➕ Added | $ADDED |
          | ➖ Removed | $REMOVED |
          | ∆ Net | $NET |

          EOF
          fi

          # Health section
          if [ -f .tmp/shiori-health.json ]; then
            SCORE=$(jq '.score // "N/A"' .tmp/shiori-health.json)
            COVERAGE=$(jq -r '.coverage // "N/A"' .tmp/shiori-health.json)
            HYGIENE=$(jq -r '.hygiene // "N/A"' .tmp/shiori-health.json)

            # Determine status emoji based on score
            STATUS="🟢"
            if [ "$SCORE" != "N/A" ] && [ "$SCORE" -lt 80 ] 2>/dev/null; then STATUS="🟡"; fi
            if [ "$SCORE" != "N/A" ] && [ "$SCORE" -lt 50 ] 2>/dev/null; then STATUS="🔴"; fi

            cat >> .tmp/shiori-summary.md << EOF
          ### Health Score

          | Metric | Score | Status |
          |--------|-------|--------|
          | Overall | $SCORE/100 | $STATUS |
          | Coverage | $COVERAGE | — |
          | Hygiene | $HYGIENE | — |

          EOF
          fi

          # Trend section
          if [ -f .tmp/shiori-trend.json ]; then
            TREND_LINE=$(jq -r '[.snapshots[].score] | map(tostring) | join(" → ")' .tmp/shiori-trend.json 2>/dev/null || echo "")
            if [ -n "$TREND_LINE" ]; then
              cat >> .tmp/shiori-summary.md << EOF
          ### Trend

          \`\`\`
          Score: $TREND_LINE
          \`\`\`

          EOF
            fi
          fi

          # Triage section (collapsed)
          if [ -f .tmp/shiori-triage.json ]; then
            TRIAGE_COUNT=$(jq '.items | length' .tmp/shiori-triage.json 2>/dev/null || echo "0")
            if [ "$TRIAGE_COUNT" -gt 0 ] 2>/dev/null; then
              echo "<details>" >> .tmp/shiori-summary.md
              echo "<summary>📋 Triage ($TRIAGE_COUNT items)</summary>" >> .tmp/shiori-summary.md
              echo "" >> .tmp/shiori-summary.md
              pnpm shiori triage --format markdown >> .tmp/shiori-summary.md 2>/dev/null || true
              echo "" >> .tmp/shiori-summary.md
              echo "</details>" >> .tmp/shiori-summary.md
            fi
          fi

      # 4. Post comment
      - name: Post governance summary
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          MARKER="<!-- shiori-governance-summary -->"
          REPO="${{ github.repository }}"
          PR="${{ github.event.pull_request.number }}"
          BODY=$(cat .tmp/shiori-summary.md)

          # Find existing comment
          COMMENT_ID=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
            --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | head -1 || true)

          if [ -n "$COMMENT_ID" ] && [ "$COMMENT_ID" != "null" ]; then
            gh api "repos/$REPO/issues/comments/$COMMENT_ID" \
              --method PATCH --field body="$BODY" --silent
          else
            gh api "repos/$REPO/issues/$PR/comments" \
              --method POST --field body="$BODY" --silent
          fi

      # 5. Fail gate
      - name: Fail if annotation count increased
        if: steps.delta.outcome == 'failure'
        run: exit 1
```

## カスタマイズ

### Health / Trend セクションを省略する

各コマンドのステップを削除するだけで該当セクションが非表示になります。`continue-on-error: true` により、コマンドが失敗してもワークフローは継続します。

### Composite Action と組み合わせる

EP-0088 の composite action がリリースされた後は、このレシピの delta + triage 部分を `shiori-action` で置き換え、health / trend 部分のみ手動で追加する構成が推奨です。

```yaml
# delta + triage は composite action で
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-comment
    max-increase: 0

# health + trend は追加ステップで
- run: pnpm shiori health --format json --output .tmp/health.json
- run: pnpm shiori trend --format json --output .tmp/trend.json
```

### スコア閾値をカスタマイズする

Health score の色分け基準を変更する場合は、「Build governance summary」ステップの STATUS 判定ロジックを編集してください。

---

## 関連

- [Composite Action レシピ](./github-actions-composite-action.md)
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
