# JetBrains IDE: Diagnostic Integration via External Tool

A recipe that integrates the GCC-compatible output of `shiori verify --format diagnostic` into JetBrains IDEs (IntelliJ IDEA, WebStorm, PhpStorm, etc.) with an External Tool + Output Filter, so you can jump straight from the results to the file.

## Overview

This recipe provides:

1. **External Tool** to run `shiori verify --format diagnostic` from the IDE
2. **Output Filter** to parse the diagnostic output and jump to files from links in the Run window
3. **Keyboard shortcut** to run it at any time

No new code is needed. It uses the existing `--format diagnostic` output as is.

## Prerequisites

- Node.js >= 22.6.0
- `shiori` installed in the project
- A registry file exists (`shiori init` has been run)
- IntelliJ IDEA / WebStorm / PhpStorm / other JetBrains IDEs

## Diagnostic Output Format

`shiori verify --format diagnostic` outputs a GCC-compatible one-line-per-issue format:

```
file:line:column: severity: message [type]
```

Example output:

```
src/foo.ts:42:1: error: Annotation expired on 2025-01-15 [expired]
src/bar.ts:10:1: warning: Not found in registry [missing-in-registry]
```

## External Tool Configuration

### Steps

1. Open **Settings** → **Tools** → **External Tools**
2. Add a new tool with the **+** button
3. Enter the following settings:

| Field                 | Value                               |
| --------------------- | ----------------------------------- |
| **Name**              | `shiori verify`                     |
| **Group**             | `shiori`                            |
| **Program**           | `npx`                               |
| **Arguments**         | `shiori verify --format diagnostic` |
| **Working directory** | `$ProjectFileDir$`                  |

If you use pnpm:

| Field         | Value                               |
| ------------- | ----------------------------------- |
| **Program**   | `pnpm`                              |
| **Arguments** | `shiori verify --format diagnostic` |

### Output Filter Configuration

Click the **Output Filters** button in the same dialog and add the following:

| Field | Value |
| ---------------------- | ------------------------------------ | -------------- |
| **Name** | `shiori diagnostic` |
| **Regular expression** | `$FILE_PATH$:$LINE$:$COLUMN$: (error | warning): .\*` |

With this setting, each diagnostic line shown in the Run window becomes a clickable link that jumps to the corresponding line in the file.

### Adding a shiori check Tool

To add `check` (the combined scan + verify command) as an External Tool in addition to `verify`:

| Field                 | Value                              |
| --------------------- | ---------------------------------- |
| **Name**              | `shiori check`                     |
| **Group**             | `shiori`                           |
| **Program**           | `npx`                              |
| **Arguments**         | `shiori check --format diagnostic` |
| **Working directory** | `$ProjectFileDir$`                 |

The Output Filter uses the same settings as `shiori verify`.

## Usage

### Run from the menu

Select **Tools** → **shiori** → **shiori verify**.

The diagnostic output appears in the Run window, and clicking a line jumps to the corresponding line in the file.

### Assigning a keyboard shortcut

1. Open **Settings** → **Keymap**
2. Type `shiori verify` in the search box
3. Right-click **External Tools** → **shiori** → **shiori verify**
4. Select **Add Keyboard Shortcut**
5. Set any key combination (e.g. `Ctrl+Shift+V`)

### Context menu

An External Tool can also be run from the right-click menu of a file or directory.

## XML Configuration File (Manual Import)

External Tool settings can be exported/imported as an XML file. Place the following content at `<IDE settings directory>/tools/shiori.xml`:

```xml
<toolSet name="shiori">
  <tool
    name="shiori verify"
    showInMainMenu="true"
    showInEditor="true"
    showInProject="true"
    showInSearchPopup="true"
    disabled="false"
    useConsole="true"
    showConsoleOnStdOut="true"
    showConsoleOnStdErr="true"
    synchronizeAfterRun="false">
    <exec>
      <option name="COMMAND" value="npx" />
      <option name="PARAMETERS" value="shiori verify --format diagnostic" />
      <option name="WORKING_DIRECTORY" value="$ProjectFileDir$" />
    </exec>
    <filter>
      <option
        name="NAME"
        value="shiori diagnostic" />
      <option
        name="DESCRIPTION"
        value="" />
      <option
        name="REGEXP"
        value="$FILE_PATH$:$LINE$:$COLUMN$: (error|warning): .*" />
    </filter>
  </tool>
  <tool
    name="shiori check"
    showInMainMenu="true"
    showInEditor="true"
    showInProject="true"
    showInSearchPopup="true"
    disabled="false"
    useConsole="true"
    showConsoleOnStdOut="true"
    showConsoleOnStdErr="true"
    synchronizeAfterRun="false">
    <exec>
      <option name="COMMAND" value="npx" />
      <option name="PARAMETERS" value="shiori check --format diagnostic" />
      <option name="WORKING_DIRECTORY" value="$ProjectFileDir$" />
    </exec>
    <filter>
      <option
        name="NAME"
        value="shiori diagnostic" />
      <option
        name="DESCRIPTION"
        value="" />
      <option
        name="REGEXP"
        value="$FILE_PATH$:$LINE$:$COLUMN$: (error|warning): .*" />
    </filter>
  </tool>
</toolSet>
```

Location of the IDE settings directory:

| OS      | Path                                                            |
| ------- | --------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/JetBrains/<IDE><version>/tools/` |
| Linux   | `~/.config/JetBrains/<IDE><version>/tools/`                     |
| Windows | `%APPDATA%\JetBrains\<IDE><version>\tools\`                     |

## File Watcher Integration (Optional)

To run `shiori verify` automatically when a file is saved, use a File Watcher.

1. Open **Settings** → **Tools** → **File Watchers**
2. Select **+** → **Custom**
3. Enter the following settings:

| Field                       | Value                               |
| --------------------------- | ----------------------------------- |
| **Name**                    | `shiori verify on save`             |
| **File type**               | `Any`                               |
| **Scope**                   | `Project Files`                     |
| **Program**                 | `npx`                               |
| **Arguments**               | `shiori verify --format diagnostic` |
| **Working directory**       | `$ProjectFileDir$`                  |
| **Output paths to refresh** | (empty)                             |
| **Auto-save edited files**  | Off (prevents infinite loops)       |

**Note**: A File Watcher runs on every file save, so it may affect performance in large projects. Consider using `shiori watch --format diagnostic` as well.

## Troubleshooting

### "npx: command not found" error

The JetBrains IDE may not recognize the Node.js path.

**Fix**:

1. Check the Node.js interpreter path in **Settings** → **Languages & Frameworks** → **Node.js**
2. Specify the full path in the External Tool's **Program** (e.g. `/usr/local/bin/npx`)

### The Output Filter does not generate links

Check that the regular expression is set correctly. In JetBrains Output Filters, `$FILE_PATH$`, `$LINE$`, and `$COLUMN$` are interpreted as macros.

To check the output manually:

```bash
npx shiori verify --format diagnostic
```

If there is no output, there are 0 verify issues (this is normal).

### `<unknown>:0:1` entries

Annotations whose file path or line number cannot be determined (for example, ones that exist only in the registry) are output as `<unknown>:0:1`. This is by design. JetBrains IDEs cannot generate a link for this line, but the message content is still shown.

## Related

- [VS Code Tasks Recipe](./vscode-annotate-task.md) — The equivalent integration in VS Code
- [Neovim Diagnostic Recipe](./neovim-diagnostic.md) — The equivalent integration in Neovim
- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md) — Design policy for structured output
