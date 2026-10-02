# VS Code Tasks: Editor Keybinding Integration for the annotate Command

A recipe that invokes `shiori annotate` from inside the editor with a keyboard shortcut, delivering about 80% of the "in-editor governance" experience without an LSP.

## Overview

This recipe achieves the following:

1. **VS Code Tasks** define `shiori annotate --target ${file}:${lineNumber}`
2. **Keybindings** insert an annotation at the cursor line immediately
3. **Problem Matcher** shows the results of `shiori verify --format diagnostic` in the Problems panel
4. **JSON output** lets you process annotate results programmatically

The governance workflow is completed with standard VS Code features alone, with no LSP extension.

## How the User Experience Changes

| Before                                                   | After                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Type the file path and line number by hand in a terminal | On the cursor line, press `Ctrl+Shift+A` and just enter a ref            |
| Run verify by hand in a terminal after annotate          | Tasks + Problem Matcher show results in the Problems panel automatically |
| Follow the CLI output by eye to locate violations        | Jump to a violation with one click from the Problems panel               |

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is added to the project's devDependencies
- A registry file exists (`shiori init` done)
- VS Code 1.50 or later

## Task Definitions

Add the following tasks to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "shiori: Annotate current line (dry-run)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --format json",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Annotate current line (apply)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --apply",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Annotate with reason + expires (apply)",
      "type": "shell",
      "command": "pnpm shiori annotate --target ${file}:${lineNumber} --ref ${input:ref} --reason ${input:reason} --expires ${input:expires} --apply",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Verify (diagnostic)",
      "type": "shell",
      "command": "pnpm shiori verify --format diagnostic",
      "problemMatcher": {
        "owner": "shiori",
        "fileLocation": ["relative", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "message": 5,
          "code": 6
        }
      },
      "presentation": {
        "reveal": "silent",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Check (diagnostic)",
      "type": "shell",
      "command": "pnpm shiori check --format diagnostic",
      "problemMatcher": {
        "owner": "shiori",
        "fileLocation": ["relative", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "message": 5,
          "code": 6
        }
      },
      "presentation": {
        "reveal": "silent",
        "panel": "shared"
      }
    },
    {
      "label": "shiori: Live Dashboard",
      "type": "shell",
      "command": "pnpm shiori watch --dashboard --open",
      "isBackground": true,
      "problemMatcher": []
    }
  ],
  "inputs": [
    {
      "id": "ref",
      "type": "promptString",
      "description": "Tracking reference (e.g. SUP-1234, ADR:0007)",
      "default": ""
    },
    {
      "id": "reason",
      "type": "promptString",
      "description": "Reason for the annotation",
      "default": ""
    },
    {
      "id": "expires",
      "type": "promptString",
      "description": "Expiration date (YYYY-MM-DD or YYYY-MM)",
      "default": ""
    }
  ]
}
```

## Keybinding Configuration

Add to `keybindings.json` (`Ctrl+Shift+P` → `Preferences: Open Keyboard Shortcuts (JSON)`):

```json
[
  {
    "key": "ctrl+shift+a",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Annotate current line (dry-run)"
  },
  {
    "key": "ctrl+shift+alt+a",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Annotate current line (apply)"
  },
  {
    "key": "ctrl+shift+d",
    "command": "workbench.action.tasks.runTask",
    "args": "shiori: Verify (diagnostic)"
  }
]
```

> **macOS**: Read `ctrl` as `cmd`.

### Intent of the Keybindings

| Key                | Task                | Description                                      |
| ------------------ | ------------------- | ------------------------------------------------ |
| `Ctrl+Shift+A`     | Annotate (dry-run)  | Check with a JSON preview first                  |
| `Ctrl+Shift+Alt+A` | Annotate (apply)    | Write for real after checking                    |
| `Ctrl+Shift+D`     | Verify (diagnostic) | List governance violations in the Problems panel |

## How the Problem Matcher Works

`shiori verify --format diagnostic` outputs in a GCC-compatible format:

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

It is compatible with VS Code's `$gcc` Problem Matcher, so it appears in the Problems panel automatically. The tasks.json above uses a custom regular expression so that the `[type]` part is also captured as the code.

### Regular Expression for the Custom Problem Matcher

```
^(.+):(\d+):(\d+):\s+(error|warning):\s+(.+)\s+\[(.+)\]$
```

| Group | Field    | Example                            |
| ----- | -------- | ---------------------------------- |
| 1     | file     | `src/foo.ts`                       |
| 2     | line     | `42`                               |
| 3     | column   | `1`                                |
| 4     | severity | `error`                            |
| 5     | message  | `Annotation expired on 2025-01-15` |
| 6     | code     | `expired`                          |

## Advanced Patterns

### A Chained annotate → verify Task

Run verify automatically after annotate and refresh the Problems panel:

```json
{
  "label": "shiori: Annotate + Verify",
  "dependsOrder": "sequence",
  "dependsOn": [
    "shiori: Annotate current line (apply)",
    "shiori: Verify (diagnostic)"
  ]
}
```

If you assign it to a keybinding, one key does both "add the annotation + check violations".

### Piping the JSON Output

The output of `--format json` has the following schema:

```json
{
  "file": "src/app.ts",
  "line": 10,
  "ref": "SUP-1234",
  "action": "insert",
  "lineInserted": true,
  "annotationLine": "// eslint-disable-next-line no-console -- shiori: SUP-1234",
  "registryEntry": {
    "reason": "workaround for issue",
    "expires": "2026-06"
  },
  "warnings": []
}
```

This is useful when consuming it from CI pipelines or custom scripts.

### Auto-verify on File Save

You can use VS Code's `runOn` feature to run verify on every save. However, a full scan runs on every save, so large projects will see delays. If you need real-time feedback, use "Real-time Feedback with watch --format diagnostic" below.

```json
{
  "label": "shiori: Verify on save",
  "type": "shell",
  "command": "pnpm shiori verify --format diagnostic",
  "runOptions": {
    "runOn": "folderOpen"
  },
  "problemMatcher": {
    "owner": "shiori",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "pattern": {
      "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
      "file": 1,
      "line": 2,
      "column": 3,
      "severity": 4,
      "message": 5,
      "code": 6
    }
  },
  "presentation": {
    "reveal": "never"
  }
}
```

### Real-time Feedback with watch --format diagnostic

`shiori watch --format diagnostic` re-runs the scan and verify every time it detects a file change, and prints diagnostic lines to stdout in a GCC-compatible format. Combined with a VS Code background task, governance violations appear in the Problems panel in real time just by saving.

```json
{
  "label": "shiori: Watch Diagnostic (real-time)",
  "type": "shell",
  "command": "pnpm shiori watch --format diagnostic",
  "isBackground": true,
  "problemMatcher": {
    "owner": "shiori-watch",
    "fileLocation": ["relative", "${workspaceFolder}"],
    "background": {
      "activeOnStart": true,
      "beginsPattern": "^\\[.*\\] refreshed \\(",
      "endsPattern": "^\\[.*\\] refreshed \\("
    },
    "pattern": {
      "regexp": "^(.+):(\\d+):(\\d+):\\s+(error|warning):\\s+(.+)\\s+\\[(.+)\\]$",
      "file": 1,
      "line": 2,
      "column": 3,
      "severity": 4,
      "message": 5,
      "code": 6
    }
  },
  "presentation": {
    "reveal": "never",
    "panel": "shared"
  }
}
```

**Flow**:

1. Start the task → `watch` begins watching files
2. Save a file → after a debounce (250ms), the scan and verify run again
3. `[timestamp] refreshed (filename)` is written to stderr (`beginsPattern` matches)
4. Diagnostic lines are written to stdout (`pattern` matches → reflected in the Problems panel)
5. On the next refresh, the previous problems are cleared and replaced with the latest results

**Differences from `runOn`**:

| Item               | `runOn: folderOpen`       | `watch --format diagnostic`                            |
| ------------------ | ------------------------- | ------------------------------------------------------ |
| Trigger            | Save event                | File system change                                     |
| Execution          | Start a process each time | Long-running process                                   |
| Debounce           | None                      | 250ms (configurable)                                   |
| Large projects     | Delays                    | Fast thanks to change detection                        |
| Use with dashboard | Possible                  | Mutually exclusive (cannot combine with `--dashboard`) |

## Position in the Governance Maturity Model

| Level | Name            | Mechanism                                 | Recipe                                                   |
| ----- | --------------- | ----------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible       | Violations are hidden by lint disable     | ---                                                      |
| 1     | Visible         | Diffs are reported in PR comments         | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced        | PR status checks block merges             | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured        | Governance score badge                    | [Governance Badge](./governance-badge.md)                |
| 4     | Inline          | Inline diagnostics in the editor          | [Code Scanning](./code-scanning.md)                      |
| **5** | **Interactive** | **Annotation operations from the editor** | **This recipe**                                          |

## Troubleshooting

### Nothing appears in the Problems panel

- Run `shiori verify --format diagnostic` directly in a terminal and confirm it produces output
- If there are 0 issues, the output is empty (this is normal)
- Check that the Problem Matcher's `fileLocation` is `["relative", "${workspaceFolder}"]`

### annotate fails with `Error: Invalid --target format`

- Make sure the file is saved (`${file}` may be empty for unsaved files)
- If the file path contains spaces, change `${file}` in `"command"` to `"\"${file}\""`

### The `ref` input prompt does not appear

- Check that the `inputs` section of `tasks.json` defines `ref`
- Restart VS Code to apply the settings

### `Ctrl+Shift+A` does not work on macOS

On macOS, change it to `Cmd+Shift+A`, or configure `keybindings.json` as follows:

```json
{
  "key": "cmd+shift+a",
  "command": "workbench.action.tasks.runTask",
  "args": "shiori: Annotate current line (dry-run)"
}
```

---

## Related

- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [Code Scanning recipe](./code-scanning.md) --- SARIF × GitHub Code Scanning integration
- [Local Dashboard recipe](./local-dashboard.md) --- Real-time dashboard
- [Checks Gate recipe](./github-checks-gate.md) --- PR status checks
