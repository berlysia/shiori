# Governance Observatory: 時系列ダッシュボード

`weekly-report --format json` の出力を蓄積し、GitHub Pages の静的ダッシュボードで技術的負債のトレンドを可視化するレシピ。

## 概要

このレシピは以下を実現します：

1. **週次 JSON スナップショット蓄積**: `shiori weekly-report --format json` の出力を Git リポジトリに自動コミット
2. **静的 HTML ダッシュボード**: 蓄積された JSON を読み込み、スコアトレンド・Issue 推移を SVG チャートで表示
3. **GitHub Pages 自動デプロイ**: push トリガーでダッシュボードを自動公開

特徴：

- **ゼロ外部依存**: Chart.js 等の CDN 不要、自己完結 HTML + 純 SVG チャート
- **ダークテーマ UI**: 既存の shiori HTML ダッシュボードと統一されたデザイン
- **インタラクティブ**: ツールチップ・セクション折りたたみ付き
- **増分蓄積**: 毎回のスナップショットが Git 履歴に残り、データロスなし

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- レジストリファイルが存在する（`shiori init` 済み）
- GitHub Pages が有効化されている（Settings → Pages → Source: GitHub Actions）

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Scheduled CI Workflow (weekly)                              │
│                                                             │
│  shiori weekly-report --format json                         │
│       ↓                                                     │
│  data/YYYY-MM-DD.json  ← Git commit & push                 │
│       ↓                                                     │
│  data/snapshots.json   ← マニフェスト更新                   │
│       ↓                                                     │
│  GitHub Pages deploy   → governance-observatory.html        │
│                           + data/*.json                     │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ手順

### Step 1: ダッシュボードファイルを配置

リポジトリルートに `observatory/` ディレクトリを作成し、HTML テンプレートをコピーします：

```bash
mkdir -p observatory/data
cp node_modules/@berlysia/shiori/docs/templates/governance-observatory.html observatory/index.html
echo '{"files":[]}' > observatory/data/snapshots.json
```

> **Note**: テンプレートは `docs/templates/governance-observatory.html` にあります。npm パッケージからコピーするか、[リポジトリから直接取得](https://github.com/berlysia/shiori/blob/main/docs/templates/governance-observatory.html)してください。

### Step 2: GitHub Actions ワークフローを追加

```yaml
# .github/workflows/shiori-observatory.yml
name: shiori governance observatory

on:
  schedule:
    # 毎週月曜 0:00 UTC に実行
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  snapshot:
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

      # Step 1: 週次レポート JSON を生成
      - name: Generate weekly report snapshot
        run: |
          DATE=$(date -u +%Y-%m-%d)
          npx shiori weekly-report \
            --preset weekly \
            --format json \
            --output "observatory/data/${DATE}.json"

      # Step 2: マニフェストを更新
      - name: Update snapshots manifest
        run: |
          cd observatory/data
          # data/ 内の全 JSON ファイル（snapshots.json 除く）をリスト化
          FILES=$(ls -1 *.json 2>/dev/null | grep -v snapshots.json | sort)
          # JSON 配列を構築
          echo '{"files":[' > snapshots.json.tmp
          FIRST=true
          for f in $FILES; do
            if [ "$FIRST" = true ]; then
              FIRST=false
            else
              echo ',' >> snapshots.json.tmp
            fi
            echo "\"$f\"" >> snapshots.json.tmp
          done
          echo ']}' >> snapshots.json.tmp
          mv snapshots.json.tmp snapshots.json

      # Step 3: Git commit & push
      - name: Commit snapshot
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add observatory/data/
          git diff --cached --quiet && echo "No changes to commit" && exit 0
          DATE=$(date -u +%Y-%m-%d)
          git commit -m "chore(observatory): add governance snapshot ${DATE}"
          git push

  deploy:
    needs: snapshot
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.ref }}

      # snapshot ジョブの push を取得するため再 checkout
      - run: git pull --rebase

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: observatory

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Step 3: GitHub Pages を有効化

1. リポジトリの **Settings** → **Pages** へ移動
2. **Source** を **GitHub Actions** に設定

### Step 4: 初回スナップショットを手動実行

Actions タブから `shiori governance observatory` ワークフローを手動トリガー（`workflow_dispatch`）して初回データを生成します。

## ディレクトリ構造

```
observatory/
├── index.html              ← ダッシュボード HTML（テンプレートからコピー）
└── data/
    ├── snapshots.json      ← マニフェスト（ファイル名リスト）
    ├── 2026-03-17.json     ← 週次スナップショット
    ├── 2026-03-24.json
    └── ...
```

## ダッシュボードの内容

| セクション       | 内容                                   |
| ---------------- | -------------------------------------- |
| Latest Score     | 最新のヘルススコアとレベルバッジ       |
| Score Trend      | スコアの時系列推移（SVG 折れ線グラフ） |
| Issue Trend      | Issue・アノテーション・候補数の推移    |
| Snapshot History | 全スナップショットのテーブル一覧       |

チャートはホバーでツールチップ表示。セクション見出しをクリックで折りたたみ/展開。

## カスタマイズ

### スケジュールの変更

```yaml
on:
  schedule:
    - cron: '0 0 * * 1' # 毎週月曜（デフォルト）
    - cron: '0 0 * * *' # 毎日
    - cron: '0 0 1 * *' # 毎月1日
```

### プリセットの変更

```yaml
# 全期間のヘルススナップショット
- run: npx shiori weekly-report --preset health --format json --output "observatory/data/${DATE}.json"

# カスタム期間
- run: npx shiori weekly-report --preset custom --since 2026-01-01 --format json --output "observatory/data/${DATE}.json"
```

### Artifacts にもバックアップ

```yaml
# Git commit の後に追加
- uses: actions/upload-artifact@v4
  with:
    name: observatory-snapshot-${{ env.DATE }}
    path: observatory/data/${{ env.DATE }}.json
    retention-days: 365
```

### GitHub Step Summary にスコアを表示

```yaml
# snapshot ジョブのステップに追加
- name: Add score to summary
  run: |
    SCORE=$(jq '.health.score' "observatory/data/${DATE}.json")
    LEVEL=$(jq -r '.health.level' "observatory/data/${DATE}.json")
    echo "## 📡 Governance Observatory" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "**Score:** ${SCORE}/100 (${LEVEL})" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "[📊 Dashboard](${{ steps.deployment.outputs.page_url || 'TBD' }})" >> "$GITHUB_STEP_SUMMARY"
```

### 既存の HTML レポートと併用

```yaml
# HTML レポートも同時に生成
- run: |
    npx shiori weekly-report --preset weekly --format json --output "observatory/data/${DATE}.json"
    npx shiori weekly-report --preset weekly --format html --output "observatory/reports/${DATE}.html"
```

## ローカルでのプレビュー

ダッシュボードは静的ファイルのため、任意の HTTP サーバーでプレビューできます：

```bash
# Python
cd observatory && python3 -m http.server 8080

# Node.js (npx)
npx serve observatory

# 直接開く（fetch が動作しないため HTTP サーバー推奨）
open observatory/index.html
```

## スナップショットデータ形式

各スナップショットは `shiori weekly-report --format json` の出力そのままです：

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "period": { "since": "2026-03-17", "until": "2026-03-24" },
  "activity": {
    "totalOperations": 5,
    "successfulOperations": 5,
    "successRate": 100,
    "netChange": 2,
    "uniqueRefs": ["SUP-1234", "SUP-5678"]
  },
  "health": { "score": 85, "level": "healthy", "summary": "..." },
  "registryOverview": {
    "totalEntries": 12,
    "totalAnnotations": 15,
    "totalCandidates": 3,
    "totalIssues": 2
  },
  "insights": [],
  "velocity": { "count": 0 }
}
```

ダッシュボード HTML は `health`、`registryOverview` フィールドを参照してチャートを描画します。

## トラブルシューティング

### ダッシュボードが空（No snapshot data found）

1. `observatory/data/snapshots.json` の `files` 配列が空でないか確認
2. JSON ファイルが `observatory/data/` に存在するか確認
3. HTTP サーバー経由でアクセスしているか確認（`file://` では fetch が失敗）

### GitHub Pages にデプロイされない

1. Settings → Pages → Source が「GitHub Actions」になっているか確認
2. ワークフローの `permissions` に `pages: write` と `id-token: write` があるか確認
3. リポジトリが public、または GitHub Pages が有効な有料プランか確認

### スナップショットが重複する

cron スケジュールと `workflow_dispatch` の同日実行で同一ファイル名（`YYYY-MM-DD.json`）が生成されるため、上書きになります。意図的な設計です。

## ガバナンス成熟度モデルにおける位置づけ

| Level | 名称         | 仕組み                            | レシピ                                                   |
| ----- | ------------ | --------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | lint disable で違反が隠れている   | —                                                        |
| 1     | Visible      | PR コメントで差分を通知           | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced     | PR ステータスチェックでブロック   | [Checks Gate](./github-checks-gate.md)                   |
| 3     | **Measured** | **トレンド追跡 + ダッシュボード** | **このレシピ**                                           |
| 4     | Proactive    | スケジュール実行で自動 Issue      | [Orchestrator](./scheduled-governance-orchestrator.md)   |

Level 3 は、ガバナンスの改善/悪化傾向をチーム全体で可視化し、データドリブンに技術的負債を管理する状態です。

---

## 関連

- [HTML Artifacts Dashboard](./html-artifacts-dashboard.md) — 単一スナップショットの HTML レポート
- [Governance Score Badge](./governance-badge.md) — README にバッジを表示
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — 自動 Issue 生成
- [GitHub Actions Step Summary](./github-actions-step-summary.md) — Step Summary 統合
