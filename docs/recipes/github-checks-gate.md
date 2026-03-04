# GitHub Actions: Checks Gate

`shiori check` の結果を GitHub PR ステータスチェック（✅/❌）として表示し、ブランチ保護ルールでマージをブロックするレシピ。

## 概要

このレシピは以下を実現します：

1. **PR ごとに `shiori check` を実行**し、ガバナンス違反を検出
2. **終了コードを GitHub Actions が自動検知**して PR の Checks タブにステータスを表示
3. **ブランチ保護ルール**で shiori check を required にすることで、違反のある PR をマージ不可にする

コア CLI の変更は不要です。`shiori check` の既存の終了コード（0 = 成功、1 = 違反あり）をそのまま活用します。

## ガバナンス成熟度モデル

このレシピは段階的な導入を想定しています：

| Level | 名称         | 仕組み                                      | レシピ                                                   |
| ----- | ------------ | ------------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | lint disable で違反が隠れている             | —                                                        |
| 1     | Visible      | PR コメントで差分を通知                     | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | **Enforced** | **PR ステータスチェックでマージをブロック** | **このレシピ**                                           |
| 3     | Measured     | ガバナンススコアのバッジ表示 + トレンド追跡 | [Governance Badge](./governance-badge.md)                |

Level 1（通知）から始めて、チームの習熟に応じて Level 2（強制）に昇格するのが推奨パターンです。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み（`pnpm add -D shiori`）
- GitHub Actions で `pull_request` イベントをトリガーに使用

## ワークフロー

```yaml
# .github/workflows/shiori-checks-gate.yml
name: shiori governance

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
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

      # shiori check は scan + verify をワンステップで実行。
      # --fail-on で指定した issue type が検出されると exit code 1 を返し、
      # GitHub Actions がこのステップを failed としてマークする。
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry
```

これだけで PR の Checks タブに `shiori governance / check` が表示されます。

## 終了コードとステータスの対応

| `shiori check` 終了コード | GitHub Checks ステータス | 意味                             |
| ------------------------- | ------------------------ | -------------------------------- |
| `0`                       | ✅ Success               | ガバナンス違反なし               |
| `1`                       | ❌ Failure               | `--fail-on` に該当する違反を検出 |

GitHub Actions はステップの終了コードをそのまま Checks のステータスに反映するため、追加の API 呼び出しは不要です。

## ブランチ保護ルールの設定

PR ステータスチェックをマージ要件にするには：

1. リポジトリの **Settings → Branches → Branch protection rules**
2. `main`（または対象ブランチ）のルールを編集
3. **Require status checks to pass before merging** を有効化
4. 検索ボックスに `shiori governance / check` と入力して追加

> **Note**: ステータスチェック名は `<workflow name> / <job name>` 形式です。
> 上記の例では workflow name が `shiori governance`、job name が `check` なので
> `shiori governance / check` となります。

## `--fail-on` ポリシーの設計

`--fail-on` で指定する issue type によって、ガバナンスの厳しさを調整できます：

### 段階的導入の例

```yaml
# Step 1: 最小限のポリシー（期限切れのみブロック）
- name: shiori check
  run: pnpm shiori check --fail-on expired

# Step 2: レジストリ未登録もブロック
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry

# Step 3: 厳格なポリシー（追跡参照なしもブロック）
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry,missing-ref

# Step 4: 期限が近いものも警告として表示
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry --warn-on expiring-soon
```

### 使用可能な issue type

| Issue Type            | 説明                                 |
| --------------------- | ------------------------------------ |
| `expired`             | `expires` 期限を過ぎたアノテーション |
| `expiring-soon`       | `expires` 期限が近いアノテーション   |
| `missing-in-registry` | ソースにあるがレジストリに未登録     |
| `unused-in-source`    | レジストリにあるがソースに不在       |
| `missing-ref`         | 追跡参照（ref）が付与されていない    |
| `duplicate-ref`       | 同一 ref が複数レジストリに存在      |
| `invalid-ref`         | ref がパターンに一致しない           |

## カスタマイズ

### SARIF 出力との併用

ステータスチェックと Code Scanning を同時に有効にできます：

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
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

      - name: Generate SARIF
        if: always()
        run: pnpm shiori verify --format sarif --output .tmp/shiori.sarif

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: .tmp/shiori.sarif
          category: shiori
```

### Delta PR Comment との併用

ステータスチェック（ブロック）と PR コメント（通知）を組み合わせるのが最も効果的です：

```yaml
jobs:
  # Level 2: ステータスチェックでブロック
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

  # Level 1: PR コメントで差分を通知（並行実行）
  pr-delta:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      # ... (delta-pr-comment レシピを参照)
```

詳細は [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) を参照してください。

### `shiori init --ci` で自動生成

```bash
pnpm shiori init --ci checks-gate
```

このコマンドで上記のワークフロー YAML が `.github/workflows/shiori.yml` に自動生成されます。

---

## トラブルシューティング

### ステータスチェックが表示されない

- ワークフローが少なくとも1回実行されるまで、ブランチ保護ルールの検索に表示されません。まず PR を作成してワークフローを実行してください。

### `--fail-on` を変更してもチェックが失敗しない

- `--fail-on` で指定した issue type のアノテーションが実際に存在するか確認してください：
  ```bash
  pnpm shiori check --fail-on expired,missing-in-registry -f json | jq '.summary'
  ```

### Checks タブの名前を変更したい

ワークフロー YAML の `name` と `jobs.<job_id>` を変更してください：

```yaml
name: annotation governance # ← ワークフロー名
jobs:
  shiori: # ← ジョブ名
    # → Checks タブには "annotation governance / shiori" と表示
```

---

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [Governance Badge レシピ](./governance-badge.md)
- [Expires Alert レシピ](./github-actions-expires-alert.md)
