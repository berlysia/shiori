# GitHub Actions: HTML Governance Dashboard (Artifacts)

ゼロ認証でガバナンスダッシュボードを CI に組み込むレシピ。PAT・Gist・GitHub Pages の設定は一切不要です。

## 概要

このレシピは以下を実現します：

1. **CI で HTML レポート生成**: `shiori report --format html` で自己完結型 HTML ダッシュボードを生成
2. **Artifacts にアップロード**: `actions/upload-artifact` で HTML ファイルを保存
3. **Job Summary にリンク表示**: ダッシュボードへのアクセス導線を CI サマリーに追加

特徴：

- **ゼロ認証**: PAT・Gist・GitHub Pages の設定不要
- **自己完結 HTML**: 外部 CDN 依存なし、オフラインでも閲覧可能
- **ダークテーマ UI**: ヘルススコア・インサイト・ブレイクダウンを視覚的に表示
- **インタラクティブ**: セクション折りたたみ機能付き

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み

## セットアップ手順

### ワークフローを追加する

```yaml
# .github/workflows/shiori-html-report.yml
name: shiori html report

on:
  push:
    branches: [main]
  # 日次更新（オプション）
  schedule:
    - cron: '0 0 * * *'

jobs:
  report:
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

      - name: Build
        run: pnpm build

      - name: Generate HTML report
        run: npx shiori report --format html --output .tmp/shiori-report.html

      - name: Upload HTML report artifact
        uses: actions/upload-artifact@v4
        with:
          name: shiori-governance-report
          path: .tmp/shiori-report.html
          retention-days: 90
          overwrite: true

      # Job Summary にダッシュボードリンクを追加
      - name: Add dashboard link to summary
        run: |
          echo "## 📊 Shiori Governance Dashboard" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "HTML レポートが Artifacts にアップロードされました。" >> "$GITHUB_STEP_SUMMARY"
          echo "ワークフロー実行ページの **Artifacts** セクションからダウンロードできます。" >> "$GITHUB_STEP_SUMMARY"
```

## 既存 CI に統合する方法

独立ワークフローではなく、既存の CI ジョブに組み込む場合：

```yaml
# 既存の CI ステップの後に追加
- name: Generate HTML governance report
  run: npx shiori report --format html --output .tmp/shiori-report.html

- name: Upload governance dashboard
  uses: actions/upload-artifact@v4
  with:
    name: shiori-governance-report
    path: .tmp/shiori-report.html
    retention-days: 90
    overwrite: true
```

## 出力内容

HTML レポートには以下のセクションが含まれます：

| セクション          | 内容                                               |
| ------------------- | -------------------------------------------------- |
| Health Score        | ガバナンスヘルススコア（0–100）とレベル表示        |
| Overview            | アノテーション数・候補数・レジストリエントリ数など |
| Insights            | ガバナンス改善提案（error/warning/info）           |
| Issues by Type      | issue タイプ別の内訳                               |
| Annotations by Rule | lint ルール別のアノテーション数                    |
| Ownership           | オーナー別のアノテーション数                       |
| Annotation Kinds    | kind 別のアノテーション数                          |

## カスタマイズ

### verify エラーがある場合に CI を失敗させる

```yaml
- name: Generate report and verify
  run: |
    npx shiori report --format html --output .tmp/shiori-report.html
    npx shiori verify --fail-on missing-in-registry,expired
```

### PR にも生成する

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

PR ワークフローでは Artifacts が PR の Checks タブからアクセスできます。

### Badge レシピと組み合わせる

```yaml
- name: Generate reports
  run: |
    npx shiori report --format html --output .tmp/shiori-report.html
    npx shiori report --format badge --output .tmp/shiori-badge.json
```

---

## 関連

- [Governance Score Badge レシピ](./governance-badge.md)
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md)
- [GitHub Checks Gate レシピ](./github-checks-gate.md)
