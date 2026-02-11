あなたは既に作成済みの「waiver-tracker」（Node.js / TypeScript / ESM の外部CLI）コードベースをリファクタし、lint抑制専用から「ソースコード内に散らばった共通の関心に対する“構造化注釈（annotation）”を収集・台帳化・監査する汎用ツール」へ進化させてください。ここでの変更は“方針に合わせた設計の一般化”が目的です。実装に入る前に、既存実装の構造を短く要約し、変更点がどこに影響するかを示してください。

# 背景（方針）
- 目的は lint抑制管理に閉じない。「コード内の判断/例外/注記」を構造化コメントとして残し、横断で収集・台帳管理・期限監視・棚卸し・レポートする。
- ただし初期の主要ユースケースとして lint抑制（stylelint/ESLintのdisableコメント + waive(ID)）は継続サポートする。
- “waive” 以外の注釈動詞も扱えるようにし、同じ仕組みで移行・リスク受容・メモ等に拡張可能にする。

# 変更のゴール（要約）
- 中核モデルを "Waiver" から "Annotation" に改名し、動詞（kind）を持つ汎用構造にする
- Providerを「lint抑制コメント」専用から、「注釈ソース」一般へ拡張できる形にする
- 台帳（ledger/registry）を注釈一般（ID単位）で管理できるようにする
- CLIは互換性を保ちつつ（deprecateは可）、scan/verify/report の意味を注釈一般に拡張する

# 具体的な設計変更

## 1) データモデルの一般化
既存の `SuppressionRecord` / `WaiverRecord` を次に置換：
- AnnotationRecord:
  - id: string
  - verb: string  (例: "waive" | "note" | "risk" | "migrate"。将来追加可能)
  - subject?: string（任意：対象ルール名や対象機能。例: stylelint rule / eslint rule）
  - tool?: string（任意：stylelint/eslint/unknown。後方互換のため）
  - file: string
  - line: number
  - source: "comment" | "native" | "external"
  - raw: string
  - meta?: Record<string, unknown>（reason/expires/owner/ticket等）
  - provider: string

補足：
- 既存の `linter`/`rule` は `tool`/`subject` に寄せる（lint以外でも成立するように）
- 後方互換のため scan出力に旧フィールドを残す場合は `--legacy-output` などで切り替え可能にする

## 2) シンボル（コード内マーカー）の一般化
現状の `waive(ID)` を維持しつつ、同形式で動詞を可変にする：
- `<verb>(<ID>)` を基本構文とする
- デフォルト許可verb: ["waive", "note", "risk", "migrate"]
- CLIオプション `--verbs waive,note,risk` で対象を絞れる
- ID抽出は `/<verb>\(([^)]+)\)/` の集合で行う（verbは許可リストから生成）

例：
- `/* stylelint-disable-next-line ... -- waive(SUP-1234) */`
- `// eslint-disable-next-line ... -- waive(SUP-5678) reason="temporary"`
- `// note(NOTE-9) ...`
- `/* migrate(MIG-1) */`

## 3) Providerインターフェースの再定義
既存の Provider を “抑制” ではなく “注釈” を返すものに変更：
- AnnotationProvider:
  - name: string
  - scan(globs, options): Promise<AnnotationRecord[]>

初期は CommentProvider を継続し、内部で「stylelint/ESLintのdisableコメント」から注釈を抽出する。
将来の拡張（実装は不要だが設計上の余地は残す）：
- ESLint native suppressions provider
- 外部JSON provider

## 4) 台帳（registry/ledger）の一般化
台帳ファイルを `waiver-ledger.yml` のような名称から、注釈一般に改名（例: `annotation-registry.yml`）。
構造：
- key = id
- value は少なくとも：
  - verb: string（任意。なければソースから推定）
  - reason: string
  - target: string[] | string（任意：影響範囲）
  - expires: YYYY-MM-DD（任意）
  - owner/ticket/notes（任意）

verifyは以下を維持：
- missing-in-registry
- unused-in-source
- expired
- malformed

## 5) CLI/コマンドの調整
- `waiver-tracker scan` は互換維持（内部は注釈スキャン）
- 可能なら alias として `annotation-tracker scan` も用意（パッケージ名は据え置きでOK）
- `--verbs` `--registry` `--format` などのオプションを追加
- 出力Markdownは verb別にセクション分け

## 6) READMEの更新
- 本ツールは lint抑制専用ではなく、構造化注釈を回収しガバナンスするツールであることを明記
- “プラグインルールだけにしない根拠”は引き続き記載（disableで結果から消える点）
- 典型例として lint抑制（waive）/移行（migrate）/リスク（risk）/注記（note）を掲載

# 実装方針（重要）
- 初期は行ベース走査で良い。AST化は後回し
- 既存のテストを壊さず、必要なら新テストを追加して移行を担保
- 大改造に見えるが、変更は“型と命名の一般化”が中心。挙動はなるべく保つ

# 期待するアウトプット
- 変更差分の要約（何を rename / 分割 / 追加したか）
- 主要ファイルの更新後コード（新しい型、Provider、scan/verify、README）
- 互換性（旧出力/旧オプション）についての扱いと、段階的移行プラン（短く）

この方針でリファクタを行い、コードを提示してください。
