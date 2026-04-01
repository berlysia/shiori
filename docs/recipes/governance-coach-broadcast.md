# Governance Coach Broadcast: Slack / GitHub Discussions 自動投稿

`shiori coach` の出力を CI で自動実行し、Slack Incoming Webhook または GitHub Discussions API 経由でチームに週次配信するレシピ。

## 概要

[Governance Coach](./governance-coach.md) レシピは `shiori coach` コマンドでプロンプトを生成しますが、手動コピペでは定着しません。このレシピは CI (GitHub Actions) を使って以下を自動化します：

1. **スケジュール実行**: cron で毎週定期的にコーチングプロンプトを生成
2. **チーム配信**: Slack チャンネルまたは GitHub Discussions に自動投稿
3. **スナップショット差分**: sprint-over-sprint の進捗を自動注入

### Governance Coach との住み分け

| 項目     | [Governance Coach](./governance-coach.md) | このレシピ                               |
| -------- | ----------------------------------------- | ---------------------------------------- |
| 目的     | LLM プロンプトの生成方法を学ぶ            | 生成したプロンプトをチームに自動配信する |
| 実行方法 | 手動（CLI / シェルスクリプト）            | 自動（CI cron）                          |
| 対象     | 個人の開発者                              | チーム全体                               |
| 成熟度   | Level 3+（Measured）                      | Level 4（Coached）                       |
| 前提     | `shiori coach` コマンドの理解             | Governance Coach レシピの完了            |

## 前提条件

- shiori がセットアップ済み（`shiori init` 完了、レジストリにエントリあり）
- `shiori coach` コマンドが利用可能（v0.1.1+）
- 配信先に応じた設定：
  - **Slack**: Incoming Webhook URL（リポジトリ Secrets に `SLACK_WEBHOOK` として保存）
  - **GitHub Discussions**: リポジトリで Discussions が有効、`GITHUB_TOKEN` の `discussions: write` 権限

## セットアップ

### Slack Incoming Webhook の準備

1. [Slack API](https://api.slack.com/messaging/webhooks) で Incoming Webhook を作成
2. 投稿先チャンネルを選択（例: `#governance`）
3. Webhook URL をリポジトリの Secrets に `SLACK_WEBHOOK` として保存

### GitHub Discussions の準備

1. リポジトリの Settings → Features → Discussions を有効化
2. 「Governance」カテゴリを作成（推奨）
3. ワークフローの `permissions` に `discussions: write` を追加

## ワークフロー

> **CLI パスについて**: 以下のサンプルでは `node dist/src/cli.js` を使用しています。これは shiori を devDependencies にインストールしたプロジェクトでの一般的なパスです。モノレポ構成の場合は `node packages/shiori-cli/dist/src/cli.js` のようにパッケージ相対パスに読み替えてください。`npx shiori` も利用可能です。

### パターン 1: Slack 配信

```yaml
# .github/workflows/shiori-coach-broadcast.yml
name: shiori coach broadcast

on:
  schedule:
    # 毎週月曜 9:00 JST (0:00 UTC)
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions: {}

jobs:
  broadcast:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
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

      # coach snapshot の保存（次回との差分比較用）
      - name: Upload coach snapshot
        uses: actions/upload-artifact@v4
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

### パターン 2: GitHub Discussions 配信

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
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
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
        uses: actions/upload-artifact@v4
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

### パターン 3: Slack + Discussions 統合

Slack と Discussions の両方に同時配信する場合は、上記パターン 1 と 2 のステップを 1 つのワークフローに統合します：

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
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      # Slack 用と Discussion 用のプロンプトを並行生成
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
        uses: actions/upload-artifact@v4
        with:
          name: coach-snapshot
          path: .config/shiori/coach-snapshots/
          retention-days: 90
          overwrite: true
```

## テンプレートの選択

`--template` フラグで配信内容を変更できます：

| テンプレート | 用途                       | 推奨頻度   |
| ------------ | -------------------------- | ---------- |
| `triage`     | 優先度付きアクションプラン | 週次       |
| `weekly`     | 週次レポートのコーチング   | 週次       |
| `health`     | 健全性診断と処方箋         | 週次〜隔週 |
| `combined`   | 全レポート統合             | 月次       |

## スナップショットによる差分注入

`--snapshot-dir` を指定すると、前回のコーチングとの差分が自動注入されます：

- `{{DIFF_SUMMARY}}`: `"Health: 75→80 (+5), Coverage: +3"` のようなワンライナー
- `{{DIFF_BLOCK}}`: previous / current / delta の比較テーブル
- `{{STAGE_TRANSITION}}`: ステージ昇格時のお祝いメッセージ

スナップショットは `--max-snapshots`（デフォルト: 10）で LRU ローテーションされます。

### CI でのスナップショット永続化

GitHub Actions ではジョブ間でファイルシステムが揮発するため、スナップショットを artifact として保存し、次回実行時に復元する必要があります：

```yaml
# 前回のスナップショットをダウンロード（初回は skip）
- name: Restore coach snapshots
  uses: actions/download-artifact@v4
  with:
    name: coach-snapshot
    path: .config/shiori/coach-snapshots/
  continue-on-error: true

# coach 実行（スナップショットが見つかれば差分注入）
- name: Generate coach prompt
  run: |
    node dist/src/cli.js coach \
      --template health \
      --format slack-markdown \
      --snapshot-dir .config/shiori/coach-snapshots \
      > /tmp/coach-output.txt

# 最新スナップショットをアップロード
- name: Upload coach snapshot
  uses: actions/upload-artifact@v4
  with:
    name: coach-snapshot
    path: .config/shiori/coach-snapshots/
    retention-days: 90
    overwrite: true
```

## カスタマイズ

### 配信頻度を変更する

```yaml
# 隔週（第 1・第 3 月曜）
schedule:
  - cron: '0 0 1-7,15-21 * 1'

# 月次（毎月 1 日）
schedule:
  - cron: '0 0 1 * *'
```

### LLM 連携を追加する

`shiori coach` はプロンプトのみを生成し、LLM API は呼び出しません。CI 内で LLM を呼び出してアドバイスまで自動生成するには、[Governance Coach レシピ](./governance-coach.md) のシェルスクリプト例を参照してください：

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

    # LLM のアドバイスを Slack に投稿
    curl -s -X POST "$SLACK_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg text "$ADVICE" '{ text: $text }')"
```

### Slack Block Kit で見た目を改善する

Incoming Webhook は Block Kit も受け付けます：

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

## トラブルシューティング

### Slack に投稿されない

- Webhook URL が正しいか確認: `curl -s -X POST "$SLACK_WEBHOOK" -d '{"text":"test"}'`
- `SLACK_WEBHOOK` シークレットが設定されているか確認
- ワークフローの `if: env.SLACK_WEBHOOK != ''` 条件を確認

### GitHub Discussion が作成されない

- リポジトリの Discussions が有効か確認
- 「Governance」カテゴリが存在するか確認（カテゴリ名は大文字小文字を区別）
- `GITHUB_TOKEN` の `discussions: write` 権限を確認

### スナップショット差分が表示されない

- `--snapshot-dir` が正しいパスを指しているか確認
- 前回のスナップショット artifact が存在するか確認（初回実行時は差分なし）
- `continue-on-error: true` が restore ステップに設定されているか確認

## ガバナンス成熟度モデルにおける位置づけ

| Level | 名称          | 仕組み                           | レシピ                                                   |
| ----- | ------------- | -------------------------------- | -------------------------------------------------------- |
| 0     | Invisible     | lint disable で違反が隠れている  | --                                                       |
| 1     | Visible       | PR コメントで差分を通知          | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced      | PR ステータスチェックでブロック  | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured      | トレンド追跡 + ダッシュボード    | [Observatory](./governance-observatory.md)               |
| 4     | **Coached**   | **LLM がデータ駆動で改善を提案** | [Governance Coach](./governance-coach.md)                |
| 4+    | **Broadcast** | **コーチングをチームに自動配信** | **このレシピ**                                           |

Level 4 (Coached) の定着フェーズとして、コーチングプロンプトの生成をチームリチュアル化します。

---

## 関連

- [Governance Coach](./governance-coach.md) -- LLM プロンプト生成の基盤レシピ
- [Slack Notification](./slack-notification.md) -- 簡易 Slack 通知レシピ
- [Slack Governance Pulse](./slack-pulse.md) -- Block Kit ダッシュボード配信
- [Governance Observatory](./governance-observatory.md) -- 時系列ダッシュボード
- [Governance Badge](./governance-badge.md) -- README バッジ表示
