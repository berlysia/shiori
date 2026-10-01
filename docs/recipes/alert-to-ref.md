# Alert-to-Ref Jump Bridge

GitHub Code Scanning のアラートから `shiori show --ref` へ直接ジャンプするブリッジスクリプト。

## 概要

shiori は `--format sarif` で SARIF 出力を生成し、GitHub Code Scanning にアップロードできます。
このレシピは、Code Scanning のアラートから元の shiori ref を逆引きし、
`shiori show` で詳細情報（理由・オーナー・期限・URL）を表示するワークフローを提供します。

## 前提条件

- [GitHub CLI (`gh`)](https://cli.github.com/) がインストール済み
- `gh auth login` で認証済み
- リポジトリに SARIF アップロード済み（後述の CI 設定参照）

## 使い方

### コマンドラインから

```bash
# アラート番号を指定して ref 情報を表示
./docs/recipes/alert-to-ref.sh owner/repo 42
```

### VS Code Task から

`docs/recipes/vscode-tasks.json.example` を `.vscode/tasks.json` にコピーして使用:

```bash
cp docs/recipes/vscode-tasks.json.example .vscode/tasks.json
```

Command Palette → "Tasks: Run Task" → "shiori: Jump to ref from alert" を選択。

## 仕組み

1. `gh api` で Code Scanning のアラートを取得
2. アラートメッセージから ref を抽出（`ID "..."` / `Ref "..."` パターン）
3. `shiori show --ref <ref>` を実行して ref の詳細を表示

### Ref 抽出パターン

shiori の `verify` が生成するメッセージには 2 種のパターンがあります:

| パターン      | Issue Types                                                        |
| ------------- | ------------------------------------------------------------------ |
| `ID "<ref>"`  | missing-in-registry, unused-in-source, expired                     |
| `Ref "<ref>"` | ref-format, unrouted-ref, ref-collision, registry-routing-mismatch |

スクリプトは正規表現 `(?:ID\|Ref) "\K[^"]+` でどちらのパターンからも ref を抽出します。

> **Note:** `syntax-error` と `ref-format` はメッセージ内に `ID "..."` / `Ref "..."` パターンを含まないため、
> ref の自動抽出に失敗します（終了コード 1）。エラーメッセージに元のアラートメッセージが表示されるので、
> 手動で ref を確認してください。

## 終了コード

| コード | 意味                                     |
| ------ | ---------------------------------------- |
| 0      | 成功                                     |
| 1      | ref 抽出失敗（メッセージパターン不一致） |
| 2      | gh CLI 未インストール                    |
| 3      | GitHub API 認証エラー（401/403）         |
| 4      | アラートが見つからない（404）            |
| 5      | ネットワークエラー等                     |

## CI 設定例

SARIF を GitHub Code Scanning にアップロードする GitHub Actions ワークフロー:

```yaml
# .github/workflows/shiori.yml
name: shiori
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - run: pnpm install
      - run: pnpm build

      - name: Scan annotations
        run: shiori scan > .config/shiori/scan-result.json

      - name: Verify and output SARIF
        run: shiori verify --format sarif > shiori.sarif
        continue-on-error: true

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: shiori.sarif
```

## 関連

- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md)
- [`shiori show` コマンド](../api.md)
