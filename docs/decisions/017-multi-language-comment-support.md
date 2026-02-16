# ADR 017: 多言語コメント構文サポート

## Status

Proposed

## Context

現在の CommentProvider は JavaScript/CSS 系のコメント構文（`//` と `/* */`）のみを認識する。`extractComments()` は以下の正規表現でコメントを抽出する:

```typescript
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/.*/g;
```

これにより以下の言語では動作するが:

| 言語                               | `//` | `/* */` | 動作   |
| ---------------------------------- | ---- | ------- | ------ |
| JavaScript/TypeScript              | Yes  | Yes     | OK     |
| CSS/SCSS                           | No   | Yes     | 部分的 |
| Java/C/C++/C#/Go/Rust/Swift/Kotlin | Yes  | Yes     | OK     |

以下の言語では動作しない:

| 言語       | コメント構文     | 動作   |
| ---------- | ---------------- | ------ |
| Python     | `#`              | NG     |
| Ruby       | `#`              | NG     |
| Shell/Bash | `#`              | NG     |
| YAML       | `#`              | NG     |
| TOML       | `#`              | NG     |
| Lua        | `--` / `--[[ ]]` | NG     |
| SQL        | `--` / `/* */`   | 部分的 |
| HTML/XML   | `<!-- -->`       | NG     |
| Elixir     | `#`              | NG     |

競合の leasot は49言語をサポートしており、shiori の「言語非依存」を謳いながら実質 C 系言語限定である点は矛盾している。

### lint disable の実態

shiori の主要ユースケースは lint disable comment の追跡であり、各言語のリンターが使うコメント構文は多様:

```python
# noqa: E501  -- shiori: SUP-001        # Python (flake8/ruff)
# type: ignore  -- shiori: SUP-002      # Python (mypy)
```

```ruby
# rubocop:disable Style/StringLiterals  -- shiori: SUP-001
```

```shell
# shellcheck disable=SC2086  -- shiori: SUP-001
```

```html
<!-- eslint-disable-next-line vue/no-v-html -- shiori: SUP-001 -->
```

## Decision

### コメント抽出をファイル拡張子ベースで切り替える

`extractComments()` を拡張子に応じたコメント構文セットで動作させる。

#### コメント構文の定義

```typescript
interface CommentSyntax {
  line?: string[]; // 行コメントの開始文字列 (例: ["//"], ["#"], ["--"])
  block?: {
    // ブロックコメント
    open: string;
    close: string;
  }[];
}

const COMMENT_SYNTAXES: Record<string, CommentSyntax> = {
  // C-style (default)
  c: { line: ['//'], block: [{ open: '/*', close: '*/' }] },
  // Hash-style
  hash: { line: ['#'] },
  // SQL/Lua-style
  dashdash: { line: ['--'], block: [{ open: '/*', close: '*/' }] },
  // HTML/XML-style
  html: { block: [{ open: '<!--', close: '-->' }] },
  // Lua-style
  lua: { line: ['--'], block: [{ open: '--[[', close: ']]' }] },
};
```

#### 拡張子マッピング

```typescript
const EXTENSION_MAP: Record<string, string> = {
  // C-style
  '.js': 'c',
  '.ts': 'c',
  '.tsx': 'c',
  '.jsx': 'c',
  '.css': 'c',
  '.scss': 'c',
  '.pcss': 'c',
  '.less': 'c',
  '.java': 'c',
  '.go': 'c',
  '.rs': 'c',
  '.swift': 'c',
  '.kt': 'c',
  '.c': 'c',
  '.cpp': 'c',
  '.h': 'c',
  '.cs': 'c',
  '.php': 'c',
  // Hash-style
  '.py': 'hash',
  '.rb': 'hash',
  '.sh': 'hash',
  '.bash': 'hash',
  '.zsh': 'hash',
  '.fish': 'hash',
  '.yaml': 'hash',
  '.yml': 'hash',
  '.toml': 'hash',
  '.r': 'hash',
  '.pl': 'hash',
  '.pm': 'hash',
  '.ex': 'hash',
  '.exs': 'hash', // Elixir
  // SQL/Lua
  '.sql': 'dashdash',
  '.lua': 'lua',
  // HTML/XML
  '.html': 'html',
  '.xml': 'html',
  '.svg': 'html',
  '.vue': 'c', // Vue SFC: script/style は C-style
};
```

#### フォールバック戦略

- 未知の拡張子は C-style（`//`, `/* */`）をフォールバックとする
- これは現在の動作と完全に後方互換
- 設定でオーバーライド可能（後述）

### 設定による拡張

`config.yaml` でユーザーがカスタム拡張子マッピングを追加可能:

```yaml
# config.yaml
commentSyntax:
  # 拡張子 → 構文名のマッピング
  extensions:
    .tf: hash # Terraform
    .hcl: hash # HCL
    .nim: hash # Nim
  # カスタム構文の定義
  custom:
    erlang:
      line: ['%']
```

### 実装の段階

#### Phase 1（v0.1）: 組み込み構文の拡充

- `extractComments()` にコメント構文パラメータを追加
- 拡張子マッピングによる自動選択
- C-style / Hash-style / HTML-style の3つをカバー
- 後方互換性を完全に維持

#### Phase 2（v0.2）: 設定による拡張

- `config.yaml` での拡張子マッピングと構文定義
- カスタム構文のサポート

#### Phase 3（将来）: ファイル内容ベースの検出

- shebang (`#!/usr/bin/env python`) による言語推定
- `.editorconfig` や IDE 設定との連携

## Alternatives Considered

### A. 言語ごとの専用 Provider を作成

- 利点: 言語固有のロジック（Pythonのdocstring除外等）を実装可能
- 欠点: Provider が爆発的に増える。各 Provider のテストが必要。現在の CommentProvider の単純さが失われる
- 判断: コメント構文の違いは行コメント開始文字とブロックコメント区切りの差異に還元できるため、パラメータ化で十分

### B. 外部パーサーライブラリ（tree-sitter 等）の導入

- 利点: 正確なコメント抽出。文字列リテラル内の誤検出がない
- 欠点: 大きな依存関係。ネイティブバイナリが必要な場合も。ADR 001 の軽量CLI方針に反する
- 判断: ADR 015 の段階的アプローチ（ref バリデーション + デフォルト除外）で偽陽性は十分抑制できる。tree-sitter は v1.0 以降の検討事項

### C. すべてのファイルを C-style として扱い続ける

- 利点: 実装変更なし
- 欠点: Python/Ruby/Shell ユーザーが使えない。「言語非依存」の謳い文句が虚偽になる
- 判断: 最小限の実装コストで大幅な言語カバレッジ向上が見込めるため、やるべき

## Consequences

### 変更されるもの

- `extractComments()` がコメント構文パラメータを受け取るようになる
- `CommentProvider.scan()` がファイル拡張子からコメント構文を決定
- `ShioriConfig` に `commentSyntax` フィールドを追加（Phase 2）

### 追加されるもの

- コメント構文定義（`CommentSyntax` 型、`EXTENSION_MAP`）
- Hash-style / HTML-style コメント抽出ロジック
- 対応言語ごとのテストケース

### リスク

- **正規表現の誤マッチ**: `#` は URL フラグメントやカラーコードでも使われる。行頭空白 + `#` に限定する等のヒューリスティックが必要
- **文字列リテラル内の `#`**: Python の `f"# comment"` 等。ADR 015 の ref バリデーション（B）で緩和

### 他 ADR への影響

- **ADR 001**: 言語非依存の方針を実質的に実現。行ベーステキストスキャンのアプローチは維持
- **ADR 015**: 偽陽性防止策が新しいコメント構文にも適用される
