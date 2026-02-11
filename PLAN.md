あなたはリポジトリ品質統治（lint運用・例外/負債管理）を担当するエンジニアです。以下の要件で「lint抑制の台帳化・検証・レポート化」を行う外部CLIツールを Node.js(TypeScript, ESM) で初期実装してください。stylelint/ESLint 両方を同じ枠組みで扱います。前提が変わる懸念（disable仕様、取得可能な情報、ESLint native suppressionsの実態）がある場合は、実装に入る前に“前提確認の議論”を優先して提示してください。

# 位置づけ（最重要）

本ツールは lint の代替でも単なる拡張でもない。`disable` により lint結果から消える「例外（technical exceptions）」を、ソースコードやlintネイティブ機構から回収し、台帳で管理する“ガバナンス層”である。

# “プラグインルールだけにしない”判断の根拠（READMEに必ず明記）

- `disable(-next-line/-line)` によって違反は lint結果に現れない（stylelint/ESLint共通）。プラグイン/ルールでは「抑制された違反の実体」やその一覧を安定して観測・レポート化できない。
- プラグインで出来るのは主に「disableコメントの書式強制」まで。台帳突合・期限切れ検出・棚卸し（台帳にあるがソースに無い）・レポート生成など“組織運用”の責務を押し込むと肥大化しやすい。
- したがって本件は外部CLIとして「抑制の事実抽出」「台帳突合」「レポート生成」を担う。必要なら別途、軽量ガード（disableにID必須等）のlintルールを追加できるが本スコープ外とする。

# 設計原則（重要：将来のESLint native suppressionsも視野）

本ツールは特定lintの抑制機構に依存しない。
抑制は共通モデル "SuppressionRecord" で表現し、取得元は pluggable な "SuppressionProvider" として実装する。

初期実装では CommentProvider（disableコメント走査）のみ提供する。
将来、次のProviderを追加可能な構造にする（実装は後回しでよい）：

- ESLint native suppressions（https://eslint.org/docs/latest/use/suppressions）
- 外部JSON suppressions
- リモート台帳

# 目的

- stylelint/ESLint の `disable-next-line` 等で lint結果から消える抑制を、ソースコードから回収して「抑制台帳」を生成する
- 抑制には必ずID（例: SUP-1234）を付けさせ、例外台帳（YAML/JSON）と突合して CI で検証できるようにする
- 人間向け（Markdown）と機械向け（JSON）のレポートを出す
- 後から provider / parser / 出力形式を追加できる

# 中核データモデル（明示）

## SuppressionRecord（最低限）

- id: string（例: SUP-1234。waive(...) から抽出）
- linter: "stylelint" | "eslint" | "unknown"
- rule?: string（抑制対象ルール名。例: plugin/baseline, @typescript-eslint/no-explicit-any）
- file: string
- line: number
- source: string（例: "comment" | "native" | "external"）
- raw: string（抑制コメント等の生文字列）
- meta?: Record<string, unknown>（reason/expires/ticket等。あれば）
- provider: string（CommentProvider等）

# 入力（ソースコード側の運用ルール）

IDは `waive(<ID>)` 形式で埋め込む。括弧必須。
例: `waive(SUP-1234)`

## stylelint（CSS/SCSS等）

- `/* stylelint-disable-next-line ... */`
- `/* stylelint-disable-line ... */`（可能なら対応）

最小形：
/_ stylelint-disable-next-line plugin/baseline -- waive(SUP-1234) reason="vendor prefix fallback" expires=2026-06-01 _/

複数行メタ（将来拡張、対応できれば尚良い）：
/_ compat-note:
id=SUP-1234
reason="vendor prefix fallback"
target="iOS Safari < 17.4, old Android WebView"
ticket="CSS-1234"
expires="2026-06-01"
_/
/_ stylelint-disable-next-line plugin/baseline _/

## ESLint（JS/TS）

- `// eslint-disable-next-line ...`
- `// eslint-disable-line ...`（可能なら対応）
  （block comment版 `/* eslint-disable-next-line */` は前提議論で扱い、初期は未対応でもよい）

最小形：
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- waive(SUP-5678) reason="temporary" expires=2026-06-01

# 例外台帳（ledger）

- `compat-ledger.yml`（または json）を読む
- キーはID（例: SUP-1234）
- 値は最低限：
  - reason: string
  - target: string[] | string（どのブラウザ/環境/事情向けか）
  - expires: YYYY-MM-DD（任意だが強く推奨）
  - ticket: string（任意）
  - owner: string（任意）
  - notes: string（任意）
  - kind: "stylelint" | "eslint" | "mixed"（任意。なければ推定）

# CLI仕様（コマンド名は仮に `lint-ledger`）

## 1) scan

- 入力: glob（複数指定可）、除外パターン
- 走査対象拡張子はオプションで指定可（デフォルト: css/scss/pcss と js/ts/tsx/jsx）
- Providerは `--provider comment` のように指定可能（初期はcommentのみ）
- 出力: JSON（stdout or file）
- 出力は安定ソート（id, file, line）

## 2) verify

- 入力: scan結果 + ledger
- 検証項目：
  - missing-in-ledger（ソースにあるが台帳にないID）
  - unused-in-source（台帳にあるがソースにないID）
  - expired（expiresが過去日）
  - malformed（ID形式違反、expires形式違反、metaパース失敗など）
- exit code 制御：
  - `--fail-on missing-in-ledger,expired`
  - `--warn-on unused-in-source`
- 出力: JSON/Markdown（パス指定可）

## 3) report（任意）

- verify結果を整形してMarkdownを生成（verifyに内包してもよい）
- missing/expiredは冒頭にサマリ

## 4) init-ledger（任意）

- scan結果から台帳の雛形を生成（reason/targetはプレースホルダ）

# 実装方針（初期）

- 初期は行ベースのテキスト走査でOK（ASTパースは後回し）
- ID抽出: `/compat\(([^)]+)\)/`
- stylelint disable検出:
  - `/* stylelint-disable-next-line` / `/* stylelint-disable-line`
- ESLint disable検出:
  - `// eslint-disable-next-line` / `// eslint-disable-line`
- ルール名抽出:
  - disableディレクティブ直後のトークン列から取得（スペース区切り、カンマ区切り対応）
- meta抽出（任意）:
  - `--` 以降に `key=value` / `key="..."` を軽くパース（reason/expires/ticket等）
- glob: fast-glob等を利用可
- yaml: `yaml` パッケージ利用可
- 大規模リポジトリでも破綻しないI/O（ストリーム/逐次処理を意識。ただし初期は簡素でよい）

# 構成（推奨）

- src/core/types.ts（SuppressionRecord等）
- src/core/providers/SuppressionProvider.ts（interface）
- src/core/providers/CommentProvider.ts（初期実装）
- src/core/ledger.ts（台帳読込）
- src/commands/scan.ts, verify.ts, init-ledger.ts
- src/cli.ts
- tests/（最低限）

# テスト

- ユニットテスト（ID抽出、stylelint/ESLint検出、verifyのmissing/expired/unused判定）
- fixtureファイルを少数用意

# 成果物

- 主要ソースコード一式（初期実装として動くレベル）
- package.json scripts（build/test/run）
- README：
  - 目的/位置づけ
  - “プラグインルールだけにしない”根拠（上記を簡潔に）
  - Provider設計（将来ESLint native suppressions等を入れる方針）
  - 運用ルール（コメントの書き方、ID命名、expires推奨）
  - 使い方（scan/verify）
  - CI統合例（任意）

# 前提が変わる可能性（最初に検討してから実装へ）

- ESLint側の suppressions 機能の入力形態・ファイル形式・取得経路（後でProvider追加する想定）
- ESLintの block comment 版や複数ルール指定の実運用を初期スコープに含めるか
- monorepoで複数台帳/複数ルートをどう扱うか（初期は単一台帳で良い）

この要件に沿って、まず「前提確認と設計要点」を短くまとめ、その後に初期実装のコード一式を提示してください。
