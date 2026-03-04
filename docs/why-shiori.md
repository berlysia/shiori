# Why shiori?

## lint disable コメントが隠す構造的リスク

`eslint-disable-next-line` や `stylelint-disable-next-line` を書くと、その違反は lint 結果から**完全に消えます**。CI は緑のまま、PR レビューではコメントの存在に気づいても「なぜ抑制したのか」「いつ解消するのか」「誰が責任を持つのか」は分かりません。

抑制が1つ2つなら問題にならないかもしれません。しかしコードベースが成長するにつれ、disable コメントは静かに増殖し、やがて**誰も全体像を把握できない技術的負債の温床**になります。

shiori はこの「見えない違反」を組織的な管理下に戻します。

## なぜ lint プラグインではないのか

### 構造的な限界: 抑制された違反は観測できない

lint ツールが `disable` コメントを処理する仕組みを見れば、プラグインでは解決できない理由が明確になります。

```
ソースコード
  ↓
[パース & ルール実行] → 違反を検出
  ↓
[disable ディレクティブ適用] → 該当違反を除去
  ↓
lint 結果（違反リスト）  ← プラグインが見えるのはここだけ
```

ESLint では `linter.verify()` の内部で `applyDisableDirectives()` が呼ばれ、disable コメントに対応する違反を結果配列から除去します。プラグイン（カスタムルール）が受け取るのは除去後の結果であり、**何が抑制されたかを知る手段がありません**。

つまり、プラグインには構造的に以下のことができません:

- 抑制された違反の一覧を取得する
- 抑制の理由や期限を検証する
- 「レジストリに登録されていない抑制」を検出する

### 責務の不一致: プラグインを肥大化させる組織的関心事

仮にプラグインでコメント書式の強制（`disable` コメントに ID を必須にする等）ができたとしても、ガバナンスに必要な機能の大部分はプラグインの責務を超えています:

| 機能                  | プラグインで可能か | 理由                                                                |
| --------------------- | ------------------ | ------------------------------------------------------------------- |
| コメント書式の強制    | ✅ 可能            | AST ノードとして処理できる                                          |
| レジストリとの照合    | ❌ 不適切          | 外部 JSON/YAML の読み込み・突合はルールの責務外                     |
| 有効期限の検出        | ❌ 不適切          | 日付比較・期限切れ通知はルールの責務外                              |
| 棚卸し（未使用検出）  | ❌ 不可能          | レジストリにあるがソースにない ref はソース走査だけでは検出できない |
| 横断レポート生成      | ❌ 不可能          | lint は1ファイル単位。プロジェクト全体の集計は構造上できない        |
| SARIF / Markdown 出力 | ❌ 不適切          | 出力形式の多様化は lint ツールの責務外                              |
| 複数 lint ツール横断  | ❌ 不可能          | ESLint プラグインは stylelint の抑制を見られない                    |

これらをプラグインに詰め込むと、lint ルールとしての単純さと保守性が失われます。

### lint ツール非依存: バージョンや内部 API に縛られない

lint ツールのメジャーバージョンアップ（ESLint v8 → v9 の flat config 移行など）はプラグインに破壊的変更を強います。shiori はソースコードを直接テキスト走査するため、lint ツールの内部 API に一切依存しません。ESLint、stylelint、Biome——どの lint ツールの disable コメントでも同じように処理できます。

## 外部 CLI という選択

shiori は lint ツールの**外側**で動作する独立した CLI です。この設計により:

- **ソースコード直接走査**: disable で隠された違反を確実に回収
- **レジストリ管理**: 各アノテーションに理由・担当者・有効期限を紐づけ
- **CI 統合**: `shiori check` 一発でスキャンと検証を完了、GitHub Actions で即座に導入可能
- **複数出力形式**: JSON、Markdown、SARIF、サマリー——用途に応じて選択
- **lint ツール横断**: ESLint も stylelint も同じコマンドで統一管理

### lint ルールとの補完関係

shiori は lint ルールを**置き換えるものではありません**。

```
┌─────────────────────────────────┐
│           lint ルール            │  disable コメントの書式を強制
│  （例: require-shiori-ref）      │  「ID なしの disable は許可しない」
└──────────┬──────────────────────┘
           │ 補完
┌──────────▼──────────────────────┐
│           shiori CLI             │  ID 付きアノテーションを回収
│                                  │  レジストリ照合・期限管理・レポート
└─────────────────────────────────┘
```

lint ルールで「disable コメントには必ず `shiori:` アノテーションを書くこと」を強制し、shiori がそのアノテーションを回収・管理する——この分業が最も合理的です。

## 5分で始める CI ガバナンス

```bash
pnpm add -D @berlysia/shiori   # 1. インストール
shiori init --ci basic          # 2. 初期化 + CI ワークフロー生成
shiori check                    # 3. アノテーション検証
shiori update                   # 4. 新しい ref をレジストリに追加
git push                        # 5. CI がガバナンスを自動検証
```

既存プロジェクトで散在する lint disable コメントを一括で管理下に置くには:

```bash
shiori scan && shiori adopt --apply
```

`shiori adopt` が未追跡の disable コメントに `shiori:` アノテーションを挿入し、レジストリエントリを自動生成します。

## Governance as Documentation: コードの「なぜ」を構造化する

shiori のアノテーションは単なる管理タグではありません。コード中の**判断・例外・文脈**を構造化し、ドキュメントの一部として機能させるものです。

### アノテーションが指し示すもの

`shiori:` の追跡参照（ref）は、課題チケットに限りません:

| 用途       | 例                 | 意味                           |
| ---------- | ------------------ | ------------------------------ |
| バグ追跡   | `shiori: SUP-1234` | ワークアラウンドの追跡チケット |
| 設計判断   | `shiori: ADR:0007` | アーキテクチャ決定記録への参照 |
| 開発メモ   | `shiori: DEV-001`  | 技術的決定や TODO の記録       |
| 移行計画   | `shiori: MIG-042`  | マイグレーション対象のマーカー |
| リスク受容 | `shiori: RISK-003` | 意識的なリスク受容の記録       |

コードの「なぜこうなっているのか」を、外部ドキュメントや管理システムと構造的に紐づけることができます。

### Before / After

**Without shiori** — 抑制は見えないノイズ:

```typescript
// eslint-disable-next-line no-constant-condition
while (true) {
  /* ... */
}

const raw: Config = JSON.parse(content) as Config;
```

レビュアーはキャストの存在は見えますが、*なぜ*必要か、*誰が*責任を持ち、*いつ*解消すべきかは分かりません。

**With shiori** — 各例外が追跡・監査可能:

```typescript
// eslint-disable-next-line no-constant-condition -- shiori: DEV-001 reason="infinite loop pattern"
while (true) {
  /* ... */
}

// shiori: DEV-007 reason="config cast without schema validation" expires=2026-06
const raw: Config = JSON.parse(content) as Config;
```

レジストリが構造化メタデータを保持:

```json
{
  "DEV-007": {
    "reason": "Config file parsed from JSON cast without schema validation",
    "expires": "2026-06",
    "owner": "berlysia",
    "kind": "type-assertion"
  }
}
```

## ビジョン: エディタ内でのガバナンス体験

shiori の目指す次のステップは、**コードを読む行為の中にガバナンス情報を自然に溶け込ませる**ことです。

`shiori:` アノテーションの上にカーソルを置くと、レジストリの理由・期限・担当者・外部リンクがホバーで即座に表示される——ターミナルに切り替えることなく、コードと文脈の距離をゼロにする IDE 統合を設計しています。

```
┌─────────────────────────────────────────────────────┐
│ // shiori: DEV-007 expires=2026-06                  │
│         ▼ hover                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ DEV-007 (type-assertion)                        │ │
│ │ Config cast without schema validation           │ │
│ │ Owner: berlysia | Expires: 2026-06              │ │
│ │ Ticket: EP-0011 → [Open in browser]             │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

shiori は「ドキュメントの一部として読めるアノテーション」を実現し、コード品質と開発者体験の両立を目指します。

## さらに詳しく

- [README](../README.md) — コマンドリファレンスと CI 統合ガイド
- [ADR 001](decisions/001-external-cli-over-lint-plugin.md) — 外部 CLI を選んだ設計決定の詳細
- [ADR 002](decisions/002-annotation-model-generalization.md) — アノテーションモデルの一般化
- [Configuration](configuration.md) — 設定リファレンス
- [API Reference](api.md) — プログラマティック API
