# ローカルリアルタイムガバナンスダッシュボード

開発中にファイル保存のたびにガバナンスダッシュボードを自動更新するレシピ。ブラウザ上でヘルススコア・変更差分をリアルタイムに確認できます。

## 概要

`shiori watch --dashboard` は以下を実現します：

1. **ファイル監視**: ソースファイルの変更を検知して自動でスキャン
2. **HTML ダッシュボード生成**: verify + health + report を統合した自己完結 HTML を出力
3. **ブラウザ自動リロード**: 3秒間隔の `<meta http-equiv="refresh">` で最新状態を反映
4. **変更差分表示**: 前回スキャンとの差分（追加・削除）をオーバーレイ表示

特徴：

- **ゼロ設定**: コマンド一つで起動、外部サーバー不要
- **自己完結 HTML**: CDN 依存なし、オフラインでも閲覧可能
- **ダークテーマ UI**: ヘルススコア・インサイト・ブレイクダウンを視覚的に表示
- **Governance Diff Overlay**: ファイル変更ごとにアノテーションの増減をバッジとテーブルで表示

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトの devDependencies に追加済み
- レジストリファイルが存在する（`shiori init` 済み）

## 基本的な使い方

### ダッシュボードを起動してブラウザで開く

```bash
shiori watch --dashboard --open
```

ブラウザが自動で開き、ファイルを保存するたびにダッシュボードが更新されます。`Ctrl+C` で停止します。

### ダッシュボードのみ（ブラウザ手動で開く）

```bash
shiori watch --dashboard
```

デフォルトでは `.config/shiori/dashboard.html` に出力されます。ブラウザで直接開いてください。

### レジストリも同期する

```bash
shiori watch --dashboard --sync-registry --open
```

新しいアノテーションが見つかると自動でレジストリにエントリを追加します。

## ダッシュボードの内容

| セクション          | 内容                                                 |
| ------------------- | ---------------------------------------------------- |
| Health Score        | ガバナンスヘルススコア（0–100）とレベル表示          |
| Changes             | 前回スキャンとの差分（追加・削除のバッジとテーブル） |
| Overview            | アノテーション数・候補数・レジストリエントリ数など   |
| Insights            | ガバナンス改善提案（error/warning/info）             |
| Issues by Type      | issue タイプ別の内訳                                 |
| Annotations by Rule | lint ルール別のアノテーション数                      |
| Ownership           | オーナー別のアノテーション数                         |
| Annotation Kinds    | kind 別のアノテーション数                            |

各セクションの見出しをクリックすると折りたたみ/展開できます。

## カスタマイズ

### 出力パスを変更する

```bash
shiori watch --dashboard --dashboard-output .tmp/my-dashboard.html --open
```

### デバウンス間隔を調整する

ファイル変更検知の間隔（ミリ秒）を調整できます。デフォルトは 250ms です。

```bash
# 高頻度保存する場合は長めに設定
shiori watch --dashboard --debounce-ms 1000 --open
```

### スキャン対象を限定する

```bash
shiori watch --dashboard --patterns "src/**/*.ts,src/**/*.tsx" --open
```

### ワンショットモードで単発生成

CI やスクリプトで一度だけ生成して終了する場合：

```bash
shiori watch --once --dashboard --dashboard-output .tmp/report.html
```

## VSCode タスクとして登録する

`.vscode/tasks.json` に追加して、VSCode から簡単に起動できます：

```json
{
  "label": "shiori: live dashboard",
  "type": "shell",
  "command": "npx shiori watch --dashboard --open",
  "isBackground": true,
  "problemMatcher": []
}
```

## フラグ一覧

| フラグ               | 短縮 | 説明                                                         |
| -------------------- | ---- | ------------------------------------------------------------ |
| `--dashboard`        | —    | HTML ダッシュボード生成を有効化                              |
| `--dashboard-output` | —    | HTML 出力パス（デフォルト: `.config/shiori/dashboard.html`） |
| `--open`             | —    | 初回生成時にデフォルトブラウザで自動起動                     |
| `--sync-registry`    | —    | スキャン結果をレジストリに自動マージ                         |
| `--registry`         | `-r` | レジストリファイルのパス                                     |
| `--patterns`         | `-p` | スキャン対象の glob パターン（カンマ区切り）                 |
| `--ignore`           | `-i` | 除外パターン（カンマ区切り）                                 |
| `--debounce-ms`      | —    | デバウンス間隔（ミリ秒、デフォルト: 250）                    |
| `--once`             | —    | 一度だけ実行して終了                                         |
| `--cwd`              | —    | 作業ディレクトリ                                             |
| `--config`           | `-c` | 設定ディレクトリのパス                                       |

---

## 関連

- [HTML Artifacts Dashboard レシピ](./html-artifacts-dashboard.md) — CI で HTML レポートを Artifacts に保存
- [Governance Score Badge レシピ](./governance-badge.md) — README にバッジを表示
- [Delta PR Comment レシピ](./github-actions-delta-pr-comment.md) — PR にガバナンス変更を通知
