# GitHub Actions: Multi-Repo Governance HTML Dashboard

複数リポジトリのガバナンス状況を1つの HTML ダッシュボードに集約し、CI Artifacts として自動公開するレシピ。

## 概要

このレシピは以下を実現します：

1. **各リポジトリで `shiori summary` を実行**: JSON 形式でガバナンスサマリーを出力
2. **`shiori aggregate --format html` で集約**: 組織全体のダッシュボードを生成
3. **Artifacts にアップロード**: 認証不要で閲覧可能

特徴：

- **ゼロ認証**: PAT・Gist・GitHub Pages の設定不要
- **自己完結 HTML**: 外部 CDN 依存なし、オフラインでも閲覧可能
- **ダークテーマ UI**: スコア分布スパークライン・リポジトリ比較テーブル・worst-repository ハイライト
- **インタラクティブ**: セクション折りたたみ機能付き
- **CI ゲート統合**: `--fail-on-level` でスコア閾値チェックが可能

## 前提条件

- Node.js >= 22.6.0
- 各リポジトリに shiori が導入済み
- 各リポジトリの CI が `shiori summary --output` で JSON を出力すること

## セットアップ手順

### Step 1: 各リポジトリでサマリー JSON を出力

各リポジトリの CI で `shiori summary` を実行し、Artifacts にアップロードします：

```yaml
# 各リポジトリの .github/workflows/shiori-summary.yml
name: shiori summary

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'

jobs:
  summary:
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

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Generate summary JSON
        run: npx shiori summary --repository "${{ github.repository }}" --output .tmp/summary.json

      - uses: actions/upload-artifact@v4
        with:
          name: shiori-summary
          path: .tmp/summary.json
          retention-days: 30
          overwrite: true
```

### Step 2: 集約ダッシュボードを生成

別リポジトリ（またはモノレポのルート）で集約ワークフローを作成：

```yaml
# .github/workflows/shiori-aggregate-dashboard.yml
name: shiori aggregate dashboard

on:
  schedule:
    - cron: '0 1 * * *' # 各リポジトリの summary 出力後に実行
  workflow_dispatch:

jobs:
  aggregate:
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

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      # 各リポジトリの summary JSON をダウンロード
      - name: Download summary artifacts
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const repos = ['org/repo-a', 'org/repo-b', 'org/repo-c'];
            fs.mkdirSync('.tmp/summaries', { recursive: true });
            for (const repo of repos) {
              const [owner, name] = repo.split('/');
              try {
                const artifacts = await github.rest.actions.listArtifactsForRepo({
                  owner, repo: name,
                  name: 'shiori-summary',
                  per_page: 1,
                });
                if (artifacts.data.artifacts.length > 0) {
                  const download = await github.rest.actions.downloadArtifact({
                    owner, repo: name,
                    artifact_id: artifacts.data.artifacts[0].id,
                    archive_format: 'zip',
                  });
                  fs.writeFileSync(`.tmp/${name}.zip`, Buffer.from(download.data));
                  require('child_process').execSync(`unzip -o .tmp/${name}.zip -d .tmp/summaries/${name}/`);
                }
              } catch (e) {
                console.warn(`Skipping ${repo}: ${e.message}`);
              }
            }

      # HTML ダッシュボード生成
      - name: Generate aggregate HTML dashboard
        run: npx shiori aggregate --files ".tmp/summaries/*/summary.json" --format html -o .tmp/dashboard.html

      - uses: actions/upload-artifact@v4
        with:
          name: shiori-governance-dashboard
          path: .tmp/dashboard.html
          retention-days: 90
          overwrite: true

      - name: Add dashboard link to summary
        run: |
          echo "## 📊 Shiori Organization Governance Dashboard" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "HTML ダッシュボードが Artifacts にアップロードされました。" >> "$GITHUB_STEP_SUMMARY"
          echo "ワークフロー実行ページの **Artifacts** セクションからダウンロードできます。" >> "$GITHUB_STEP_SUMMARY"
```

## モノレポでの使い方

モノレポ内の複数パッケージを集約する場合はよりシンプルです：

```yaml
- name: Generate summaries
  run: |
    for pkg in packages/*/; do
      name=$(basename "$pkg")
      npx shiori summary --cwd "$pkg" --repository "$name" --output ".tmp/summaries/${name}.json"
    done

- name: Generate aggregate dashboard
  run: npx shiori aggregate --files ".tmp/summaries/*.json" --format html -o .tmp/dashboard.html
```

## CI ゲートとの併用

HTML ダッシュボード生成と CI ゲートを同時に使用できます：

```yaml
- name: Generate dashboard and enforce quality gate
  run: |
    npx shiori aggregate --files ".tmp/summaries/*.json" --format html -o .tmp/dashboard.html
    npx shiori aggregate --files ".tmp/summaries/*.json" --fail-on-level critical
```

## 出力内容

HTML ダッシュボードには以下のセクションが含まれます：

| セクション           | 内容                                                       |
| -------------------- | ---------------------------------------------------------- |
| Overall Summary Card | 組織全体の平均スコア・リポジトリ数・issue 合計             |
| Worst Repository     | 最もスコアが低いリポジトリのハイライト                     |
| Score Distribution   | リポジトリ別スコアのスパークライン（ヘルスカラーで色分け） |
| Repository Table     | 全リポジトリの比較テーブル（スコアバー付き）               |

---

## 関連

- [HTML Artifacts Dashboard (single-repo)](./html-artifacts-dashboard.md)
- [Governance Summary PR Comment](./github-actions-governance-summary.md)
- [GitHub Checks Gate](./github-checks-gate.md)
