# GitHub Actions: PR Checks Score Summary

`shiori delta` と `shiori health` の結果を GitHub Checks API の `output.summary` に埋め込み、PR レビュー画面の Checks タブでガバナンススコアの変化を直接可視化するレシピ。

## 概要

[Checks Gate レシピ](./github-checks-gate.md) は `shiori check` の終了コード（pass/fail）で PR をブロックしますが、スコアの「方向」は伝えません。このレシピは GitHub Checks API の `output.summary` フィールドを使い、PR の Checks タブにスコア差分のリッチサマリーを表示します。

### Checks API `output.summary` と `$GITHUB_STEP_SUMMARY` の違い

| 項目                   | Checks API `output.summary`                      | `$GITHUB_STEP_SUMMARY`                                  |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| 表示場所               | PR ページの **Checks タブ** → 個別チェック詳細   | **ワークフロー実行の Summary タブ**                     |
| API / 仕組み           | REST API `POST /repos/{owner}/{repo}/check-runs` | ファイルに `>>` で追記するだけ                          |
| 必要な権限             | `checks: write`                                  | なし（ワークフロー内蔵）                                |
| レビュアーの到達コスト | PR ページ内で完結（1クリック）                   | ワークフロー実行ページへの遷移が必要                    |
| 適用レシピ             | **このレシピ**                                   | [Step Summary レシピ](./github-actions-step-summary.md) |

レビュアーが PR ページ内でスコア変化を確認したい場合は **このレシピ（Checks API）** を、CI 運用者がワークフロー結果を一覧したい場合は **Step Summary** を使ってください。両方を併用することも可能です。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- **EP-0167（ADR 028 スキーマエンベロープ展開）が完了済みであること** — `shiori delta --format json` と `shiori health --format json` が ADR 028 エンベロープ（`meta` + `data` ラッパー）で出力される必要があります
- [Baseline ワークフロー](./github-actions-delta-pr-comment.md) が設定済み（delta 用）

> **EP-0167 未完了時の注意**: エンベロープなしの場合、JSON のトップレベル構造が異なります。以下のワークフロー例の `jq` パスを `.data.summary.added` → `.summary.added`、`.data.health.score` → `.health.score` のように `data.` プレフィックスを除去して読み替えてください。

## 必要な権限

GitHub Checks API を使用するため、ワークフローに **`checks: write`** 権限が必要です。

```yaml
permissions:
  contents: read
  checks: write # Checks API output.summary への書き込み
  actions: read # クロスワークフロー artifact 取得
```

> **トークンスコープ**: デフォルトの `GITHUB_TOKEN` で `checks: write` を指定すれば十分です。Fine-grained PAT を使用する場合は "Checks" の Read and write 権限を付与してください。Fork PR では `pull_request_target` イベントを検討する必要があります（セキュリティ上の配慮が必要）。

## ワークフロー

```yaml
# .github/workflows/shiori-checks-summary.yml
name: shiori checks summary

on:
  pull_request:
    branches: [main]

jobs:
  checks-summary:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
      actions: read

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

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

      # 2. Scan PR head
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # 3. Compute delta (JSON format for jq parsing)
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

      # 4. Collect health score
      - name: Health check
        run: pnpm shiori health --format json --output .tmp/shiori-health.json
        continue-on-error: true

      # 5. Build Markdown summary for Checks API output.summary
      - name: Build checks summary
        shell: bash
        run: |
          SUMMARY=""

          # Delta section
          if [ -f .tmp/shiori-delta.json ]; then
            ADDED=$(jq '.data.summary.added // 0' .tmp/shiori-delta.json)
            REMOVED=$(jq '.data.summary.removed // 0' .tmp/shiori-delta.json)
            NET=$(jq '.data.summary.net // 0' .tmp/shiori-delta.json)
            UNCHANGED=$(jq '.data.summary.unchanged // 0' .tmp/shiori-delta.json)

            # Net change indicator
            if [ "$NET" -gt 0 ] 2>/dev/null; then
              NET_DISPLAY="+${NET} :chart_with_upwards_trend:"
            elif [ "$NET" -lt 0 ] 2>/dev/null; then
              NET_DISPLAY="${NET} :chart_with_downwards_trend:"
            else
              NET_DISPLAY="0 :left_right_arrow:"
            fi

            SUMMARY+="## Annotation Delta\n\n"
            SUMMARY+="| Metric | Count |\n"
            SUMMARY+="|--------|-------|\n"
            SUMMARY+="| :heavy_plus_sign: Added | ${ADDED} |\n"
            SUMMARY+="| :heavy_minus_sign: Removed | ${REMOVED} |\n"
            SUMMARY+="| Unchanged | ${UNCHANGED} |\n"
            SUMMARY+="| **Net change** | **${NET_DISPLAY}** |\n\n"
          fi

          # Health section
          if [ -f .tmp/shiori-health.json ]; then
            SCORE=$(jq '.data.health.score // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            LEVEL=$(jq -r '.data.health.level // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            HEALTH_SUMMARY=$(jq -r '.data.health.summary // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            ERRORS=$(jq '.data.issues.errors // 0' .tmp/shiori-health.json 2>/dev/null || echo "0")
            WARNINGS=$(jq '.data.issues.warnings // 0' .tmp/shiori-health.json 2>/dev/null || echo "0")

            if [ -n "$SCORE" ]; then
              # Status emoji based on health level
              case "$LEVEL" in
                healthy)  STATUS_EMOJI=":green_circle:" ;;
                warning)  STATUS_EMOJI=":yellow_circle:" ;;
                critical) STATUS_EMOJI=":red_circle:" ;;
                *)        STATUS_EMOJI=":white_circle:" ;;
              esac

              SUMMARY+="## Health Score\n\n"
              SUMMARY+="${STATUS_EMOJI} **${SCORE}/100** (${LEVEL})\n\n"
              if [ -n "$HEALTH_SUMMARY" ]; then
                SUMMARY+="> ${HEALTH_SUMMARY}\n\n"
              fi
              SUMMARY+="| Metric | Value |\n"
              SUMMARY+="|--------|-------|\n"
              SUMMARY+="| Errors | ${ERRORS} |\n"
              SUMMARY+="| Warnings | ${WARNINGS} |\n\n"
            fi
          fi

          # Fallback if no data
          if [ -z "$SUMMARY" ]; then
            SUMMARY="No governance data available for this PR.\n"
          fi

          # Save summary for next step
          printf '%b' "$SUMMARY" > .tmp/shiori-checks-summary.md

      # 6. Create/update Check Run with output.summary
      - name: Post checks summary
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('.tmp/shiori-checks-summary.md', 'utf-8');

            // Determine conclusion from delta step outcome
            const deltaOutcome = '${{ steps.delta.outcome }}';
            const conclusion = deltaOutcome === 'failure' ? 'failure' : 'success';

            await github.rest.checks.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              name: 'shiori governance summary',
              head_sha: context.payload.pull_request.head.sha,
              status: 'completed',
              conclusion: conclusion,
              output: {
                title: conclusion === 'success'
                  ? 'Governance check passed'
                  : 'Annotation count exceeded threshold',
                summary: summary,
              },
            });
```

## Checks タブの表示例

PR の Checks タブで「shiori governance summary」をクリックすると、以下のようなサマリーが表示されます：

```markdown
## Annotation Delta

| Metric                     | Count                               |
| -------------------------- | ----------------------------------- |
| :heavy_plus_sign: Added    | 1                                   |
| :heavy_minus_sign: Removed | 2                                   |
| Unchanged                  | 13                                  |
| **Net change**             | **-1 :chart_with_downwards_trend:** |

## Health Score

:green_circle: **85/100** (healthy)

> 42 tracked annotations, 3 issues remaining

| Metric   | Value |
| -------- | ----- |
| Errors   | 1     |
| Warnings | 2     |
```

## ガバナンス成熟度モデルにおける位置づけ

| Level | 名称         | 仕組み                                      | レシピ                                                   |
| ----- | ------------ | ------------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | lint disable で違反が隠れている             | ---                                                      |
| 1     | Visible      | PR コメントで差分を通知                     | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced     | PR ステータスチェックでマージをブロック     | [Checks Gate](./github-checks-gate.md)                   |
| 2+    | **Informed** | **Checks タブにスコア差分を表示**           | **このレシピ**                                           |
| 3     | Measured     | ガバナンススコアのバッジ表示 + トレンド追跡 | [Governance Badge](./governance-badge.md)                |

Level 2（Enforced）と Level 3（Measured）の間を埋めるレシピです。Checks Gate と併用することで、pass/fail に加えてスコアの方向性をレビュアーに伝えられます。

## カスタマイズ

### Checks Gate と併用する

このレシピは Checks Gate と独立して動作します。両方を同一ワークフローに含めることで、ブロック判定とスコアサマリーを同時に提供できます：

```yaml
jobs:
  # Level 2: pass/fail ゲート
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry

  # Level 2+: スコア差分サマリー（並行実行）
  checks-summary:
    # ... (上記のワークフローを参照)
```

### Step Summary と併用する

Checks タブとワークフロー Summary の両方にガバナンス情報を表示する場合：

```yaml
# Checks API output.summary に表示
- name: Post checks summary
  # ... (上記のステップ)

# Step Summary にも表示
- name: Health step summary
  continue-on-error: true
  run: pnpm shiori health --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

### `--max-increase` の閾値を変更する

```yaml
- name: Compute delta
  run: |
    pnpm shiori delta \
      --base .tmp/shiori-base-scan.json \
      --head .tmp/shiori-head-scan.json \
      --format json \
      --base-fallback-empty \
      --max-increase 3 \
      --output .tmp/shiori-delta.json
```

### Check Run 名を変更する

`actions/github-script` 内の `name` フィールドを変更してください：

```javascript
await github.rest.checks.create({
  // ...
  name: 'annotation governance', // ← 任意の名前
  // ...
});
```

ブランチ保護ルールでこのチェックを required にする場合は、ここで指定した名前を使用してください。

---

## トラブルシューティング

### Checks タブにサマリーが表示されない

- `permissions.checks: write` が設定されているか確認してください
- `head_sha` が正しい commit SHA を指しているか確認してください。`pull_request` イベントでは `context.payload.pull_request.head.sha` を使用します
- Fork PR の場合、`GITHUB_TOKEN` に `checks: write` 権限がない場合があります。`pull_request_target` イベントの使用を検討してください（セキュリティの配慮が必要）

### `jq` のパスエラーが出る

EP-0167（ADR 028 エンベロープ展開）の適用状態により JSON 構造が異なります：

- **エンベロープあり**（EP-0167 適用後）: `.data.summary.added`
- **エンベロープなし**（EP-0167 適用前）: `.summary.added`

`shiori delta --format json | jq '.meta.schemaVersion'` で `1` が返れば エンベロープあり、エラーになればエンベロープなしです。

### ベースラインが見つからない

[Delta PR Comment レシピのトラブルシューティング](./github-actions-delta-pr-comment.md#ベースラインが見つからない初回prの場合) を参照してください。`--base-fallback-empty` により初回 PR でも動作します。

---

## 関連

- [Checks Gate レシピ](./github-checks-gate.md) --- pass/fail ステータスチェック
- [Step Summary レシピ](./github-actions-step-summary.md) --- `$GITHUB_STEP_SUMMARY` への出力
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) --- PR コメントへの差分投稿
- [Governance Summary レシピ](./github-actions-governance-summary.md) --- 統合ガバナンスサマリー
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [ADR 028: コマンド出力スキーマバージョニング](../decisions/028-command-output-schema-versioning.md)
