---
status: Accepted
deps: []
---

# ADR 001: External CLI over Lint Plugin

## Context

lint の `disable` コメント（`stylelint-disable-next-line`, `eslint-disable-next-line` 等）で抑制された違反は lint 結果に一切現れない。組織として「どの違反がなぜ抑制されているか」を把握し、期限管理や棚卸しを行うガバナンス層が必要だった。

> **Note:** このツールは当初 `lint-ledger` という名前で、データストアを「台帳（ledger）」と呼んでいたが、`shiori` にリネームし、データストアの呼称を「レジストリ（registry）」に統一した。

実現手段として **lint プラグインとして実装する案** と **外部 CLI として実装する案** を検討した。

## Decision

**外部 CLI として実装する。**

lint 結果から消えた抑制を回収し、レジストリ突合・期限検出・棚卸し・レポート生成を担う独立ツールとして構築する。

## Rationale

### lint プラグイン案を却下した理由

1. **観測不能**: `disable` コメントにより違反は lint 結果から完全に消える。プラグイン/ルールでは「抑制された違反の実体」やその一覧を安定して観測・レポート化できない。
2. **責務の肥大化**: プラグインで対応できるのは主に「disable コメントの書式強制」まで。レジストリ突合・期限切れ検出・棚卸し（レジストリにあるがソースにない）・レポート生成など組織運用の責務を押し込むとプラグインが肥大化する。
3. **lint ツール横断**: stylelint と ESLint の両方を統一的に扱う必要があり、個別プラグインでは二重実装になる。

### 外部 CLI の利点

- ソースコードを直接走査するため、disable で隠された違反を確実に回収できる
- lint ツールのバージョンや内部 API に依存しない
- レジストリ管理・レポート生成・CI 統合を自然に担える
- 将来的にプラグインで書式強制（disable に ID 必須等）を追加することと補完関係にある

## Design Principles

### Provider Pattern

抑制の取得元を特定の lint ツールに依存させない。共通モデル（AnnotationRecord）で表現し、取得元は pluggable な Provider として実装する。

- 初期実装: CommentProvider（行ベースのテキスト走査で disable コメントを検出）
- 将来拡張可能: ESLint native suppressions, 外部 JSON, リモートレジストリ

### Line-based Text Scanning

初期実装では AST パースではなく行ベースのテキスト走査を採用。lint ツールの AST に依存せず、シンプルかつ高速に動作する。AST ベースの精密な解析は将来の Provider として追加可能。

### ID-based Tracking

ソースコード内の抑制には `waive(<ID>)` 形式で一意の ID を埋め込むことを要求する。この ID をレジストリと突合することで、組織的な管理（理由・期限・担当者の記録）を実現する。

## Consequences

- lint ツールとは独立したビルド・テスト・リリースサイクルを持つ
- CI パイプラインで lint とは別ステップとして実行する必要がある
- disable コメントの書式強制（ID 必須等）が必要な場合は、別途軽量な lint ルールを追加する必要がある
