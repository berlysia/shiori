# Neovim: errorformat による diagnostic 統合

`shiori verify --format diagnostic` の GCC 互換出力を Neovim の quickfix リストに統合し、`:make` でガバナンス違反にジャンプできるようにするレシピ。

## 概要

このレシピは以下を実現します：

1. **Makefile ターゲット** で `shiori verify --format diagnostic` を定義
2. **errorformat** 設定で diagnostic 出力を Neovim が解析可能に
3. **`:make` コマンド** で quickfix リストに違反を表示し、ファイル間をジャンプ

新規コードは不要。既存の `--format diagnostic` 出力をそのまま利用します。

## 前提条件

- Node.js >= 22.6.0
- `shiori` がプロジェクトにインストール済み
- レジストリファイルが存在する（`shiori init` 済み）
- Neovim 0.5 以上（Vim でも動作可能）

## diagnostic 出力フォーマット

`shiori verify --format diagnostic` は GCC 互換の 1 行 1 issue フォーマットを出力します：

```
file:line:column: severity: message [type]
```

出力例：

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

## Makefile ターゲット

プロジェクトルートの `Makefile` に以下を追加します：

```makefile
.PHONY: shiori-verify

shiori-verify:
	npx shiori verify --format diagnostic
```

pnpm を使用している場合：

```makefile
shiori-verify:
	pnpm shiori verify --format diagnostic
```

`shiori check` でも同様に使えます：

```makefile
shiori-check:
	npx shiori check --format diagnostic
```

## errorformat 設定

### 方法 1: Neovim の `makeprg` + `errorformat`（推奨）

`init.lua` に以下を追加します：

```lua
-- shiori diagnostic format: file:line:column: severity: message [type]
vim.api.nvim_create_autocmd("FileType", {
  pattern = "*",
  callback = function()
    vim.opt_local.makeprg = "npx shiori verify --format diagnostic"
    vim.opt_local.errorformat = "%f:%l:%c: %trror: %m,%f:%l:%c: %tarning: %m"
  end,
})
```

`init.vim` (Vimscript) の場合：

```vim
" shiori diagnostic format
set makeprg=npx\ shiori\ verify\ --format\ diagnostic
set errorformat=%f:%l:%c:\ %trror:\ %m,%f:%l:%c:\ %tarning:\ %m
```

### 方法 2: Makefile + デフォルト errorformat

Makefile ターゲットを定義済みの場合、`makeprg` を Makefile ターゲットに向けます：

```lua
vim.opt_local.makeprg = "make shiori-verify"
vim.opt_local.errorformat = "%f:%l:%c: %trror: %m,%f:%l:%c: %tarning: %m"
```

### errorformat の解説

| パターン   | 意味                                 |
| ---------- | ------------------------------------ |
| `%f`       | ファイルパス                         |
| `%l`       | 行番号                               |
| `%c`       | カラム番号                           |
| `%trror`   | `error` にマッチ（severity = `E`）   |
| `%tarning` | `warning` にマッチ（severity = `W`） |
| `%m`       | メッセージ本文                       |

## 使い方

```vim
" 1. shiori verify を実行し、結果を quickfix に読み込む
:make

" 2. quickfix リストを開く
:copen

" 3. 違反箇所にジャンプ
:cnext     " 次の違反へ
:cprev     " 前の違反へ
:cfirst    " 最初の違反へ
```

## カスタマイズ

### キーマッピング

頻繁に使う場合はキーマッピングを追加します：

```lua
-- <leader>sv で shiori verify を実行
vim.keymap.set("n", "<leader>sv", ":make<CR>", { desc = "shiori verify" })

-- quickfix ナビゲーション
vim.keymap.set("n", "]q", ":cnext<CR>", { desc = "Next quickfix" })
vim.keymap.set("n", "[q", ":cprev<CR>", { desc = "Prev quickfix" })
```

### shiori check を使う場合

`verify` の代わりに `check`（scan + verify の統合コマンド）を使う場合：

```lua
vim.opt_local.makeprg = "npx shiori check --format diagnostic"
```

### プロジェクト固有の設定

`.nvim.lua`（Neovim の exrc）でプロジェクト単位の設定が可能です：

```lua
-- .nvim.lua (プロジェクトルート)
vim.opt_local.makeprg = "pnpm shiori verify --format diagnostic"
vim.opt_local.errorformat = "%f:%l:%c: %trror: %m,%f:%l:%c: %tarning: %m"
```

`set exrc` を `init.lua` で有効化しておく必要があります：

```lua
vim.opt.exrc = true
```

## トラブルシューティング

### `:make` で "command not found" エラー

`npx` や `pnpm` がシェル PATH に含まれているか確認します。Neovim はデフォルトシェルを使用するため、`$PATH` がターミナルと異なる場合があります。

```lua
-- フルパスを指定する
vim.opt_local.makeprg = "/usr/local/bin/npx shiori verify --format diagnostic"
```

### quickfix にエントリが表示されない

`errorformat` が正しく設定されているか確認します：

```vim
:set errorformat?
```

手動で出力を確認する場合：

```bash
npx shiori verify --format diagnostic
```

出力がない場合は verify issues が 0 件です（正常）。

### `<unknown>:0:1` のエントリ

ファイルパスや行番号が特定できないアノテーション（レジストリにのみ存在する等）は `<unknown>:0:1` として出力されます。これは仕様です。

## 関連

- [VS Code Tasks レシピ](./vscode-annotate-task.md) — VS Code での同等の統合
- [ADR 018: 外部サービス連携戦略](../decisions/018-external-service-integration.md) — 構造化出力の設計方針
