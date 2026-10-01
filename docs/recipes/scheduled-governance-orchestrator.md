# Scheduled Governance Orchestrator

期限切れ・期限間近アノテーションをスケジュール実行で検出し、GitHub Issue を自動生成するオーケストレーションワークフロー。既存レシピ（[Expires Alert](./github-actions-expires-alert.md)、[GitHub Issue Creation](./github-issue-creation.md)、[Slack Notification](./slack-notification.md)）を統合した本番運用向けレシピです。

## 概要

このレシピは以下を1つのワークフローで実現します：

1. **スケジュール実行**: cron で定期的に `shiori check` を実行
2. **Issue 自動生成**: expired / expiring-soon を ref 単位で GitHub Issue に起票
3. **重複防止**: 既存の open Issue と ref でマッチングし、二重起票を回避
4. **Assignee 自動設定**: registry の `owner` フィールドから GitHub username を解決
5. **Slack 通知**（オプション）: サマリーを Slack に投稿

## 前提条件

- Node.js >= 18.0.0
- `shiori` がプロジェクトの devDependencies に追加済み
- `gh` CLI が GitHub Actions ランナーで使用可能（デフォルトで利用可能）
- リポジトリに `governance` ラベルが存在（`gh label create governance` で作成可能）

## ワークフロー

```yaml
# .github/workflows/shiori-governance-orchestrator.yml
name: shiori governance orchestrator

on:
  schedule:
    # 毎週月曜 9:00 UTC に実行
    - cron: '0 9 * * 1'
  workflow_dispatch:
    inputs:
      threshold:
        description: 'Expiring threshold in days'
        required: false
        default: '30'
      dry_run:
        description: 'Dry run (no issues created)'
        required: false
        default: 'false'
        type: boolean

permissions:
  contents: read
  issues: write

jobs:
  orchestrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      # Step 1: shiori check で期限切れ・期限間近を検出
      - name: Run shiori check
        id: check
        run: |
          THRESHOLD="${{ inputs.threshold || '30' }}"
          pnpm shiori check \
            --fail-on expired,expiring-soon \
            --expiring-threshold "$THRESHOLD" \
            -f json \
            -o .tmp/shiori-check.json || true

          EXPIRED=$(jq '.summary.byType["expired"] // 0' .tmp/shiori-check.json)
          EXPIRING=$(jq '.summary.byType["expiring-soon"] // 0' .tmp/shiori-check.json)
          echo "expired=$EXPIRED" >> "$GITHUB_OUTPUT"
          echo "expiring=$EXPIRING" >> "$GITHUB_OUTPUT"
          echo "threshold=$THRESHOLD" >> "$GITHUB_OUTPUT"

      # Step 2: ref ごとに Issue を自動生成（重複チェック付き）
      - name: Create issues per ref
        if: steps.check.outputs.expired > 0 || steps.check.outputs.expiring > 0
        env:
          GH_TOKEN: ${{ github.token }}
          DRY_RUN: ${{ inputs.dry_run || 'false' }}
        run: |
          REGISTRY_FILE=".config/shiori/registry.json"
          CREATED=0
          SKIPPED=0

          # expired と expiring-soon の issue を ref 単位で処理
          # NOTE: プロセス置換 < <(...) を使い、while ループを親シェルで実行する。
          # パイプ（| while）だとサブシェルになり CREATED/SKIPPED が親に反映されない。
          while IFS=$'\t' read -r TYPE REF MESSAGE; do

            # Issue タイトルの構築
            if [ "$TYPE" = "expired" ]; then
              TITLE="[shiori] Expired: ${REF}"
              LABELS="governance,expired"
            else
              TITLE="[shiori] Expiring soon: ${REF}"
              LABELS="governance,expiring-soon"
            fi

            # 重複チェック: shiori ラベル + ref で既存 Issue を検索
            EXISTING=$(gh issue list \
              --label "governance" \
              --search "in:title [shiori] ${REF}" \
              --state open \
              --json number \
              --jq 'length' 2>/dev/null || echo "0")

            if [ "$EXISTING" -gt 0 ]; then
              echo "⏭ Skip: Issue already exists for ${REF}"
              SKIPPED=$((SKIPPED + 1))
              continue
            fi

            # registry から owner を取得して assignee に設定
            OWNER=""
            if [ -f "$REGISTRY_FILE" ]; then
              OWNER=$(jq -r --arg ref "$REF" '.[$ref].owner // empty' "$REGISTRY_FILE")
            fi

            # registry からメタデータを取得
            REASON=$(jq -r --arg ref "$REF" '.[$ref].reason // "No reason recorded"' "$REGISTRY_FILE" 2>/dev/null || echo "No reason recorded")
            EXPIRES=$(jq -r --arg ref "$REF" '.[$ref].expires // "Not set"' "$REGISTRY_FILE" 2>/dev/null || echo "Not set")
            KIND=$(jq -r --arg ref "$REF" '.[$ref].kind // "unknown"' "$REGISTRY_FILE" 2>/dev/null || echo "unknown")
            TARGET=$(jq -r --arg ref "$REF" '.[$ref].target // "unknown"' "$REGISTRY_FILE" 2>/dev/null || echo "unknown")

            # Issue 本文の構築
            BODY="## shiori Governance Alert

**Type:** \`${TYPE}\`
**Ref:** \`${REF}\`
**Kind:** \`${KIND}\`
**Target:** \`${TARGET}\`
**Expires:** ${EXPIRES}

### Reason

${REASON}

### Detection

${MESSAGE}

### Resolution

1. \`shiori show --ref ${REF}\` で詳細を確認
2. \`shiori jump --ref ${REF}\` でソース位置にジャンプ
3. 問題を解決後、\`shiori resolve --ref ${REF} --apply\` で追跡を終了

---
*This issue was automatically created by [shiori governance orchestrator](https://github.com/berlysia/shiori).*"

            if [ "$DRY_RUN" = "true" ]; then
              echo "🔍 Dry run: Would create issue for ${REF}"
              echo "   Title: ${TITLE}"
              echo "   Labels: ${LABELS}"
              echo "   Assignee: ${OWNER:-none}"
              CREATED=$((CREATED + 1))
              continue
            fi

            # Issue 作成（assignee は配列で構築し word splitting を回避）
            ASSIGN_ARGS=()
            if [ -n "$OWNER" ]; then
              ASSIGN_ARGS+=(--assignee "$OWNER")
            fi

            gh issue create \
              --title "$TITLE" \
              --body "$BODY" \
              --label "$LABELS" \
              "${ASSIGN_ARGS[@]}" || echo "⚠ Failed to create issue for ${REF} (assignee '${OWNER}' may not be a collaborator)"

            echo "✅ Created issue for ${REF}"
            CREATED=$((CREATED + 1))
          done < <(jq -r '
            .issues[]
            | select(.type == "expired" or .type == "expiring-soon")
            | [.type, .ref, .message] | @tsv
          ' .tmp/shiori-check.json | sort -u -k2,2)

          echo "### Summary" >> "$GITHUB_STEP_SUMMARY"
          echo "- Created: ${CREATED} issues" >> "$GITHUB_STEP_SUMMARY"
          echo "- Skipped (duplicate): ${SKIPPED} issues" >> "$GITHUB_STEP_SUMMARY"

      # Step 3 (Optional): Slack 通知
      - name: Slack notification
        if: |
          (steps.check.outputs.expired > 0 || steps.check.outputs.expiring > 0)
          && env.SLACK_WEBHOOK_URL != ''
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          EXPIRED="${{ steps.check.outputs.expired }}"
          EXPIRING="${{ steps.check.outputs.expiring }}"
          THRESHOLD="${{ steps.check.outputs.threshold }}"
          REPO="${{ github.repository }}"
          RUN_URL="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"

          TEXT=":warning: *shiori Governance Alert* — <${RUN_URL}|Details>\n"
          TEXT+=":red_circle: Expired: ${EXPIRED}\n"
          TEXT+=":large_yellow_circle: Expiring soon (within ${THRESHOLD} days): ${EXPIRING}\n"
          TEXT+="Repository: \`${REPO}\`\n"
          TEXT+="Run \`shiori triage\` for prioritized action list."

          curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"${TEXT}\"}"
```

## 機能詳細

### 重複防止

Issue の重複チェックは2つの条件で判定します：

1. **ラベル**: `governance` ラベルが付いている
2. **タイトル検索**: `[shiori] <ref>` がタイトルに含まれている

Issue がクローズされると（解決済み）、次回の実行で同じ ref に対して新しい Issue が作成されます。これにより、一度解決した問題が再発した場合も検出できます。

### Assignee 自動設定

registry の `owner` フィールドの値を GitHub username として直接使用します：

```json
{
  "SUP-1234": {
    "reason": "vendor prefix fallback",
    "owner": "octocat",
    "expires": "2026-06-01"
  }
}
```

この場合、`octocat` が Issue の assignee に設定されます。

> **Note**: `owner` がリポジトリのコラボレーターでない場合、assignee 設定は失敗しますが、Issue 自体は作成されます。

### Dry Run

`workflow_dispatch` から手動トリガーする際に `dry_run: true` を指定すると、Issue を作成せずにプレビューのみ表示します。初回導入時の動作確認に使用してください。

## カスタマイズ

### スケジュールの変更

```yaml
on:
  schedule:
    - cron: '0 9 * * 1' # 毎週月曜 9:00 UTC
    - cron: '0 9 * * 1-5' # 平日毎日 9:00 UTC
    - cron: '0 0 1 * *' # 毎月1日 0:00 UTC
```

### 閾値の変更

`--expiring-threshold` でアラートの日数を調整できます。config.yaml で `verify.expiringThresholdDays` をプロジェクト全体のデフォルトとして設定することもできます。

### Issue テンプレートの変更

ワークフロー内の `BODY` 変数を編集して、Issue 本文のフォーマットをカスタマイズできます。Markdown がそのまま使えます。

### Slack 通知の有効化

1. Slack Incoming Webhook URL を取得
2. リポジトリの Secrets に `SLACK_WEBHOOK_URL` として登録
3. ワークフローが自動的に通知を送信（Webhook URL が設定されている場合のみ）

### チーム別のルーティング

registry の `owner` と GitHub の CODEOWNERS を組み合わせることで、チーム別のルーティングが可能です：

```json
{
  "FE-001": { "owner": "team-frontend", "expires": "2026-06" },
  "BE-002": { "owner": "team-backend", "expires": "2026-09" }
}
```

GitHub Teams を assignee に設定するには、Organization のリポジトリで Teams に Write 権限を付与してください。

## トラブルシューティング

### Issue が作成されない

1. `governance` ラベルが存在するか確認: `gh label list | grep governance`
2. `GITHUB_TOKEN` の権限を確認: `issues: write` が必要
3. Dry run で動作確認: `workflow_dispatch` から `dry_run: true` で実行

### Assignee が設定されない

- registry の `owner` 値がリポジトリのコラボレーター名と一致しているか確認
- Organization の場合、Team 名ではなく個人の GitHub username を使用
- Assignee 設定の失敗は Issue 作成をブロックしません（警告のみ）

### 重複 Issue が作成される

- `governance` ラベルが Issue に付いているか確認
- Issue タイトルの `[shiori]` プレフィックスが変更されていないか確認
- GitHub API の検索インデックスに遅延がある場合、まれに重複が発生する可能性があります

## ガバナンス成熟度モデルにおける位置づけ

| Level | 名称          | 仕組み                           | レシピ                                                   |
| ----- | ------------- | -------------------------------- | -------------------------------------------------------- |
| 0     | Invisible     | lint disable で違反が隠れている  | —                                                        |
| 1     | Visible       | PR コメントで差分を通知          | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced      | PR ステータスチェックでブロック  | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured      | バッジ + トレンド追跡            | [Governance Badge](./governance-badge.md)                |
| 4     | **Proactive** | **スケジュール実行で自動 Issue** | **このレシピ**                                           |

Level 4 は、期限管理が自動化され、チームが受動的にアラートを受け取るだけで技術的負債を管理できる状態です。

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Expires Alert レシピ](./github-actions-expires-alert.md) — 単純な expires 検出 + Issue 作成
- [GitHub Issue Creation レシピ](./github-issue-creation.md) — スクリプトベースの Issue 作成
- [Slack Notification レシピ](./slack-notification.md) — Slack 通知単体
- [Checks Gate レシピ](./github-checks-gate.md) — PR ステータスチェック
