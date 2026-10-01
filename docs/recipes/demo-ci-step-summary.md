# Demo CI Step Summary

`scan --demo --format github-summary` を使って、shiori 未導入のプロジェクトでも CI の Step Summary にガバナンスデモを表示するレシピ。

## 概要

プロジェクトに shiori をセットアップする前に、CI 上で動作を体験できます。組み込みのサンプルファイルを使うため、レジストリの初期化やソースコードの変更は一切不要です。

チームメンバーへの紹介や、導入前の評価に最適です。

## 最小ワークフロー

```yaml
name: shiori demo
on: [pull_request]

jobs:
  demo:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - name: shiori demo → Step Summary
        run: npx @berlysia/shiori scan --demo --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

これだけで PR の Step Summary タブにデモ結果が表示されます。

## 出力フォーマット

| フォーマット           | コマンド                              | 用途                            |
| ---------------------- | ------------------------------------- | ------------------------------- |
| GitHub Summary         | `scan --demo --format github-summary` | Step Summary 直接出力           |
| Markdown               | `scan --demo --format markdown`       | Gist・Wiki・ドキュメント共有    |
| JSON                   | `scan --demo --format json`           | CI パイプライン・プログラム連携 |
| 人間向け（デフォルト） | `scan --demo`                         | ローカルターミナル表示          |

## 実践例: チーム紹介ワークフロー

CI で demo を実行し、結果を Markdown でアーティファクト保存する例:

```yaml
name: shiori demo report
on:
  workflow_dispatch: # 手動実行で評価

jobs:
  demo:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22

      # Step Summary に表示
      - name: Demo → Step Summary
        run: npx @berlysia/shiori scan --demo --format github-summary >> "$GITHUB_STEP_SUMMARY"

      # Markdown レポートをアーティファクトとして保存
      - name: Demo → Markdown report
        run: npx @berlysia/shiori scan --demo --format markdown --output demo-report.md

      - name: Upload demo report
        uses: actions/upload-artifact@v7
        with:
          name: shiori-demo-report
          path: demo-report.md
          retention-days: 30
```

## デモから本導入への移行

デモで動作を確認したら、3 コマンドで本導入できます:

```bash
pnpm add -D @berlysia/shiori
shiori init --ci basic
shiori check
```

`shiori init --ci basic` は本番用の CI ワークフロー（`shiori check` + Step Summary）を自動生成します。

## 設計上のポイント

- **`npx` でゼロインストール**: `pnpm add` 不要。CI 上で `npx` 経由で実行可能
- **`continue-on-error` 不要**: demo モードは常に exit 0 を返すため、ワークフロー制御が不要
- **セットアップ依存なし**: レジストリ・設定ファイル・ソースコード変更が一切不要

## 関連

- [Step Summary レシピ](./github-actions-step-summary.md) — 本番用の verify/health/report Step Summary
- [Getting Started](../getting-started.md) — 5 分でのセットアップガイド
