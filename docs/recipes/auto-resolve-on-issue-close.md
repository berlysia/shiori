# GitHub Actions: Issue Close → Auto Resolve

GitHub Issue がクローズされたとき、`shiori resolve --closed` を自動実行してアノテーションを解消するワークフローテンプレート。daemon デプロイ不要で、GitHub Actions のみで完結します。

## 概要

- `on: issues` + `types: [closed]` で Issue クローズをトリガー
- `shiori scan` → `shiori resolve --closed --apply --yes` を実行
- 結果を Job Summary に出力
- 変更があれば自動コミット＋プッシュ

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- ref に GitHub Issue 番号を使用している（例: `GH-123`）
- リポジトリの Actions 設定で `contents: write` 権限が許可されている

## ワークフロー

````yaml
# .github/workflows/shiori-auto-resolve.yml
name: shiori auto-resolve on issue close

on:
  issues:
    types: [closed]

permissions:
  contents: write

jobs:
  auto-resolve:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Scan annotations
        run: pnpm shiori scan

      - name: Resolve closed refs
        id: resolve
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          OUTPUT=$(pnpm shiori resolve --closed --apply --yes --format json 2>&1) || true
          echo "$OUTPUT"

          # Extract JSON from stdout (shiori writes status to stderr, JSON to stdout)
          JSON=$(echo "$OUTPUT" | grep -E '^\{' | head -1)
          if [ -n "$JSON" ]; then
            RESOLVED=$(echo "$JSON" | jq -r '.resolvedRefs | length // 0')
            echo "resolved=$RESOLVED" >> "$GITHUB_OUTPUT"
            echo "json=$JSON" >> "$GITHUB_OUTPUT"
          else
            echo "resolved=0" >> "$GITHUB_OUTPUT"
          fi

      - name: Write Job Summary
        if: always()
        run: |
          echo "## shiori auto-resolve" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          if [ "${{ steps.resolve.outputs.resolved }}" -gt 0 ] 2>/dev/null; then
            echo "✅ Resolved ${{ steps.resolve.outputs.resolved }} closed ref(s)" >> "$GITHUB_STEP_SUMMARY"
            echo "" >> "$GITHUB_STEP_SUMMARY"
            echo '```json' >> "$GITHUB_STEP_SUMMARY"
            echo '${{ steps.resolve.outputs.json }}' >> "$GITHUB_STEP_SUMMARY"
            echo '```' >> "$GITHUB_STEP_SUMMARY"
          else
            echo "ℹ️ No annotations matched the closed issue." >> "$GITHUB_STEP_SUMMARY"
          fi

      - name: Commit and push changes
        if: steps.resolve.outputs.resolved > 0
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet && exit 0
          git commit -m "chore(shiori): auto-resolve annotations for closed issue #${{ github.event.issue.number }}"
          git push
````

## 動作フロー

1. GitHub Issue がクローズされる
2. ワークフローがトリガーされ、リポジトリをチェックアウト
3. `shiori scan` でソースコードをスキャンし、最新の scan-result を生成
4. `shiori resolve --closed --apply --yes --format json` で以下を実行:
   - `GITHUB_TOKEN` を使用して、すべての ref の Issue ステータスを確認
   - クローズされた ref に対応するアノテーションをソースから除去
   - レジストリエントリを削除
5. 結果を Job Summary に出力
6. 変更があれば自動コミット＋プッシュ

## daemon との使い分け

| 観点           | GitHub Actions（本レシピ）           | shiori-daemon                   |
| -------------- | ------------------------------------ | ------------------------------- |
| インフラ       | 不要（GitHub が提供）                | 常駐プロセスのデプロイが必要    |
| 適性           | 低〜中頻度の Issue クローズ          | 高頻度のイベント処理            |
| レイテンシ     | 数十秒〜数分（Actions 起動時間）     | 数秒（常駐プロセスが即応答）    |
| 環境           | GitHub.com / GitHub Enterprise Cloud | セルフホスト環境も対応          |
| 複雑さ         | YAML ファイル1つ                     | サーバーデプロイ + Webhook 設定 |
| カスタマイズ性 | ワークフローステップの追加で拡張     | コード変更で自由に拡張          |

**推奨**:

- **まずは本レシピ（GitHub Actions）から始める** — インフラ不要で即導入可能
- Issue クローズ頻度が高く、レイテンシが問題になる場合に daemon への移行を検討

## カスタマイズ

### 特定ブランチへの限定

デフォルトブランチでのみ実行する場合:

```yaml
on:
  issues:
    types: [closed]

jobs:
  auto-resolve:
    runs-on: ubuntu-latest
    if: github.event.issue.state_reason != 'not_planned'
```

`not_planned` で閉じられた Issue を除外することで、意図的にクローズしたもののみを処理します。

### Slack 通知の追加

resolve 結果を Slack に通知する場合、[Slack Notification レシピ](./slack-notification.md) と組み合わせます:

```yaml
- name: Notify Slack
  if: steps.resolve.outputs.resolved > 0
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: |
    curl -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"shiori: Issue #${{ github.event.issue.number }} のクローズに伴い、${{ steps.resolve.outputs.resolved }} 件のアノテーションを自動解消しました\"}"
```

### PR 経由での変更

直接プッシュではなく PR を作成する場合:

```yaml
- name: Create PR for resolved annotations
  if: steps.resolve.outputs.resolved > 0
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    BRANCH="shiori/auto-resolve-${{ github.event.issue.number }}"
    git checkout -b "$BRANCH"
    git add -A
    git diff --cached --quiet && exit 0
    git commit -m "chore(shiori): auto-resolve annotations for closed issue #${{ github.event.issue.number }}"
    git push -u origin "$BRANCH"
    gh pr create \
      --title "chore(shiori): auto-resolve for #${{ github.event.issue.number }}" \
      --body "Issue #${{ github.event.issue.number }} のクローズに伴い、関連アノテーションを自動解消します。" \
      --label "governance"
```

## トラブルシューティング

### "No closed refs found" と表示される

- ref 形式が GitHub Issue と一致しているか確認（例: `GH-123`）
- `shiori scan` の結果に対象の ref が含まれているか確認: `pnpm shiori scan && pnpm shiori show --ref GH-123`
- `GITHUB_TOKEN` が正しく設定されているか確認

### 権限エラーでプッシュに失敗する

- ワークフローの `permissions` に `contents: write` が含まれているか確認
- リポジトリ設定 > Actions > General > Workflow permissions で "Read and write permissions" を選択

### scan-result freshness エラー

ソースファイルが scan 後に変更された場合に発生します。ワークフロー内で `shiori scan` を `resolve` の直前に実行していれば通常は発生しません。並行するワークフローが同時にファイルを変更している場合は `--force` フラグの追加を検討してください。
