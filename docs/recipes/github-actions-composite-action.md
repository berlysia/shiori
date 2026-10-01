# GitHub Actions: shiori-action Composite Action

shiori のすべての CI 統合パターンをワンステップで実行できる composite action。70行以上の YAML が数行に。

## 概要

`shiori-action` は以下のモードを提供する composite action です：

| Mode             | 説明                                           | トリガー例                  |
| ---------------- | ---------------------------------------------- | --------------------------- |
| `baseline`       | ベースブランチのスキャン結果を artifact に保存 | `push` to main              |
| `pr-comment`     | PR コメントに delta + triage レポートを投稿    | `pull_request`              |
| `pr-description` | PR Description に delta + triage を埋め込み    | `pull_request`              |
| `checks-gate`    | `shiori check` でステータスチェック            | `push` + `pull_request`     |
| `badge`          | ガバナンスバッジ JSON を生成                   | `push` to main + `schedule` |
| `sarif`          | SARIF 出力 + Code Scanning アップロード        | `push` + `pull_request`     |

## クイックスタート

### 最小構成（ベースライン + PR コメント）

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: baseline

  pr-comment:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: pr-comment
          max-increase: 0
```

これだけで、70行以上あった YAML が実質2ステップに削減されます。

## 必要な Permissions

モードに応じて呼び出し元ワークフローで `permissions` を設定してください：

| Mode             | 必要な permissions                                        |
| ---------------- | --------------------------------------------------------- |
| `baseline`       | `contents: read`                                          |
| `pr-comment`     | `contents: read`, `pull-requests: write`, `actions: read` |
| `pr-description` | `contents: read`, `pull-requests: write`, `actions: read` |
| `checks-gate`    | `contents: read`                                          |
| `badge`          | `contents: read`                                          |
| `sarif`          | `contents: read`, `security-events: write`                |

## モード別の使い方

### baseline: ベーススキャン保存

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: baseline
```

`pnpm shiori scan` を実行し、結果を GitHub Actions artifact として保存します。PR モード（`pr-comment`, `pr-description`）のベースラインとして使用されます。

**カスタマイズ可能な inputs:**

- `baseline-artifact-name`: artifact 名（デフォルト: `shiori-base-scan`）
- `retention-days`: artifact 保持日数（デフォルト: `90`）

### pr-comment: PR コメント投稿

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-comment
    max-increase: 0 # アノテーション純増を禁止
    onboarding: true # オンボーディングフッターを表示
```

ベースラインとの差分を計算し、PR コメントに delta レポート + triage レポートを投稿します。アノテーション数が `max-increase` を超えた場合は CI を失敗させます。

**追加 inputs:**

- `added-only`: 追加されたアノテーションのみ表示（デフォルト: `false`）
- `base-branch`: ベースブランチ名（デフォルト: `main`）
- `baseline-workflow-name`: ベースラインワークフロー名（デフォルト: `shiori baseline`）

### pr-description: PR Description 更新

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-description
    max-increase: 0
```

PR Description 内の `<!-- shiori-delta-start -->` / `<!-- shiori-delta-end -->` マーカーと `<!-- shiori-triage-start -->` / `<!-- shiori-triage-end -->` マーカーの間にレポートを埋め込みます。マーカーがない場合は末尾に追加します。

### checks-gate: ステータスチェック

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: checks-gate
    fail-on: expired,missing-in-registry
```

`shiori check` を実行し、指定した issue type が検出されると CI を失敗させます。ブランチ保護ルールと組み合わせることでマージをブロックできます。

### badge: ガバナンスバッジ

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: badge
    gist-token: ${{ secrets.GIST_TOKEN }}
    gist-id: ${{ vars.SHIORI_BADGE_GIST_ID }}
```

shields.io endpoint JSON を生成し、artifact として保存します。`gist-token` と `gist-id` を指定すると Gist にもアップロードします。

### sarif: Code Scanning

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: sarif
    sarif-category: shiori
```

SARIF v2.1.0 形式の診断結果を生成し、GitHub Code Scanning にアップロードします。

## 全モード統合ワークフロー例

```yaml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: baseline

  pr-delta:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: pr-comment
          max-increase: 0

  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: checks-gate

  code-scanning:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: sarif
```

## 手動 YAML レシピとの使い分け

| 基準                    | Composite Action を使う      | 手動 YAML を使う           |
| ----------------------- | ---------------------------- | -------------------------- |
| カスタマイズ            | 標準的な設定で十分           | 独自のステップ追加が必要   |
| ワークフロー            | 新規構築 or 既存の置き換え   | 既存 YAML を維持したい     |
| `actions/github-script` | 不要                         | カスタム JS ロジックが必要 |
| Self-hosted runners     | GitHub-hosted runners を使用 | `gh` CLI が未インストール  |

手動 YAML レシピは引き続き利用可能です：

- [Delta PR Comment](./github-actions-delta-pr-comment.md)
- [Delta PR Description](./github-actions-delta-pr-description.md)
- [Checks Gate](./github-checks-gate.md)
- [Governance Badge](./governance-badge.md)
- [Code Scanning](./code-scanning.md)

## トラブルシューティング

### ベースラインが見つからない

初回 PR では baseline artifact が存在しないため、ダウンロードがスキップされます。`--base-fallback-empty` により空のベースとして扱われ、全アノテーションが「Added」として表示されます。

### PR コメントが毎回新規投稿される

`<!-- shiori-delta -->` マーカーで既存コメントを検索しています。`shiori delta --format markdown` の出力にこのマーカーが含まれているか確認してください。

### Self-hosted runner で動かない

`gh` CLI がプリインストールされていない場合があります。ワークフローに `gh` CLI のインストールステップを追加するか、手動 YAML レシピを使用してください。

### `actions: read` 権限エラー

`pr-comment` / `pr-description` モードでは、クロスワークフロー artifact の取得に `actions: read` 権限が必要です。ワークフローの `permissions` セクションを確認してください。

---

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [Delta PR Description レシピ](./github-actions-delta-pr-description.md)
- [Checks Gate レシピ](./github-checks-gate.md)
- [Governance Badge レシピ](./governance-badge.md)
- [Code Scanning レシピ](./code-scanning.md)
- [Governance Summary レシピ](./github-actions-governance-summary.md)
