# Neovim: diagnostic integration via errorformat

A recipe that integrates the GCC-compatible output of `shiori verify --format diagnostic` into Neovim's quickfix list, so you can jump to governance violations with `:make`.

## Overview

This recipe provides the following:

1. **Makefile target** that defines `shiori verify --format diagnostic`
2. **errorformat** settings so that Neovim can parse the diagnostic output
3. **`:make` command** to show violations in the quickfix list and jump between files

No new code is needed. It uses the existing `--format diagnostic` output as is.

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is installed in the project
- A registry file exists (`shiori init` is done)
- Neovim 0.5 or later (also works with Vim)

## Diagnostic output format

`shiori verify --format diagnostic` outputs a GCC-compatible one-issue-per-line format:

```
file:line:column: severity: message [type]
```

Example output:

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

## Makefile target

Add the following to the `Makefile` at the project root:

```makefile
.PHONY: shiori-verify

shiori-verify:
	npx shiori verify --format diagnostic
```

If you use pnpm:

```makefile
shiori-verify:
	pnpm shiori verify --format diagnostic
```

You can use `shiori check` the same way:

```makefile
shiori-check:
	npx shiori check --format diagnostic
```

## errorformat settings

### Method 1: Neovim `makeprg` + `errorformat` (recommended)

Add the following to `init.lua`:

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

For `init.vim` (Vimscript):

```vim
" shiori diagnostic format
set makeprg=npx\ shiori\ verify\ --format\ diagnostic
set errorformat=%f:%l:%c:\ %trror:\ %m,%f:%l:%c:\ %tarning:\ %m
```

### Method 2: Makefile + default errorformat

If you have already defined the Makefile target, point `makeprg` at the Makefile target:

```lua
vim.opt_local.makeprg = "make shiori-verify"
vim.opt_local.errorformat = "%f:%l:%c: %trror: %m,%f:%l:%c: %tarning: %m"
```

### errorformat explained

| Pattern    | Meaning                            |
| ---------- | ---------------------------------- |
| `%f`       | File path                          |
| `%l`       | Line number                        |
| `%c`       | Column number                      |
| `%trror`   | Matches `error` (severity = `E`)   |
| `%tarning` | Matches `warning` (severity = `W`) |
| `%m`       | Message body                       |

## Usage

```vim
" 1. Run shiori verify and load the results into quickfix
:make

" 2. Open the quickfix list
:copen

" 3. Jump to a violation
:cnext     " Next violation
:cprev     " Previous violation
:cfirst    " First violation
```

## Customization

### Key mappings

If you use it often, add key mappings:

```lua
-- Run shiori verify with <leader>sv
vim.keymap.set("n", "<leader>sv", ":make<CR>", { desc = "shiori verify" })

-- quickfix navigation
vim.keymap.set("n", "]q", ":cnext<CR>", { desc = "Next quickfix" })
vim.keymap.set("n", "[q", ":cprev<CR>", { desc = "Prev quickfix" })
```

### When using shiori check

To use `check` (a combined scan + verify command) instead of `verify`:

```lua
vim.opt_local.makeprg = "npx shiori check --format diagnostic"
```

### Project-specific settings

You can configure per project with `.nvim.lua` (Neovim's exrc):

```lua
-- .nvim.lua (project root)
vim.opt_local.makeprg = "pnpm shiori verify --format diagnostic"
vim.opt_local.errorformat = "%f:%l:%c: %trror: %m,%f:%l:%c: %tarning: %m"
```

You need to enable `set exrc` in `init.lua`:

```lua
vim.opt.exrc = true
```

## Troubleshooting

### "command not found" error with `:make`

Check that `npx` or `pnpm` is on the shell PATH. Neovim uses the default shell, so `$PATH` may differ from your terminal.

```lua
-- Specify the full path
vim.opt_local.makeprg = "/usr/local/bin/npx shiori verify --format diagnostic"
```

### No entries appear in quickfix

Check that `errorformat` is set correctly:

```vim
:set errorformat?
```

To check the output manually:

```bash
npx shiori verify --format diagnostic
```

If there is no output, there are 0 verify issues (this is normal).

### Entries like `<unknown>:0:1`

Annotations whose file path or line number cannot be determined (for example, ones that exist only in the registry) are output as `<unknown>:0:1`. This is by design.

## Related

- [VS Code Tasks recipe](./vscode-annotate-task.md) — equivalent integration in VS Code
- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md) — design policy for structured output
