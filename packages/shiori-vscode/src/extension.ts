import * as vscode from 'vscode';
import {
  loadRegistry,
  loadConfig,
  resolveRefUrl,
  parseShioriFields,
} from '@berlysia/shiori';
import type {
  Registry,
  ResolvedConfig,
  RefPatternConfig,
} from '@berlysia/shiori';
import { extractShioriText, isDateExpired } from './shiori-text.ts';

// ── State management ──────────────────────────────────────────

interface ExtensionState {
  registry: Registry;
  config: ResolvedConfig | undefined;
  refPatterns: RefPatternConfig[] | undefined;
  registryPath: string | undefined;
}

const state: ExtensionState = {
  registry: {},
  config: undefined,
  refPatterns: undefined,
  registryPath: undefined,
};

// ── Registry loading ──────────────────────────────────────────

/**
 * Try to load registry from workspace.
 * Uses config-resolved path or falls back to default locations.
 */
async function loadWorkspaceRegistry(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  try {
    state.config = await loadConfig(workspaceRoot);
    state.refPatterns = state.config.refPatterns;
  } catch {
    // Config is optional; proceed without it
  }

  const configuredPath =
    vscode.workspace.getConfiguration('shiori').get<string>('registryPath') ||
    undefined;

  const registryPath = configuredPath ?? state.config?.paths.registry;

  const candidates = registryPath
    ? [registryPath]
    : [
        '.config/shiori/registry.json',
        '.config/shiori/registry.yaml',
        '.config/shiori/registry.yml',
      ];

  for (const candidate of candidates) {
    const fullPath = vscode.Uri.joinPath(
      vscode.Uri.file(workspaceRoot),
      candidate,
    ).fsPath;
    try {
      const result = await loadRegistry(fullPath);
      state.registry = result.registry;
      state.registryPath = fullPath;
      return;
    } catch {
      // Try next candidate
    }
  }
}

// ── HoverProvider ─────────────────────────────────────────────

class ShioriHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const lineText = document.lineAt(position.line).text;
    const extraction = extractShioriText(lineText);
    if (!extraction) return undefined;

    const parsed = parseShioriFields(extraction.fieldsText);
    if (!parsed.ref) return undefined;

    const entry = state.registry[parsed.ref];
    const url = resolveRefUrl(parsed.ref, state.refPatterns);

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    // Header: ref (linked if URL available)
    if (url) {
      md.appendMarkdown(`### 📌 [${parsed.ref}](${url})\n\n`);
    } else {
      md.appendMarkdown(`### 📌 ${parsed.ref}\n\n`);
    }

    // Registry entry details
    if (entry) {
      md.appendMarkdown(`**Reason:** ${entry.reason}\n\n`);

      if (entry.owner) {
        md.appendMarkdown(`**Owner:** ${entry.owner}\n\n`);
      }

      if (entry.kind) {
        md.appendMarkdown(`**Kind:** ${entry.kind}\n\n`);
      }

      const expires = parsed.expires ?? entry.expires;
      if (expires) {
        const expired = isDateExpired(expires);
        const prefix = expired ? '⚠️ **Expired:**' : '**Expires:**';
        md.appendMarkdown(`${prefix} ${expires}\n\n`);
      }

      if (entry.ticket) {
        md.appendMarkdown(`**Ticket:** ${entry.ticket}\n\n`);
      }

      if (entry.notes) {
        md.appendMarkdown(`**Notes:** ${entry.notes}\n\n`);
      }

      const target = Array.isArray(entry.target)
        ? entry.target.join(', ')
        : entry.target;
      md.appendMarkdown(`**Target:** \`${target}\`\n\n`);
    } else {
      md.appendMarkdown(`_Not found in registry_\n\n`);
    }

    // Inline fields from comment
    if (parsed.reason && (!entry || parsed.reason !== entry.reason)) {
      md.appendMarkdown(`**Inline reason:** ${parsed.reason}\n\n`);
    }

    if (parsed.errors.length > 0) {
      md.appendMarkdown(
        `⚠️ **Syntax errors:** ${parsed.errors.join(', ')}\n\n`,
      );
    }

    return new vscode.Hover(md);
  }
}

// ── DocumentLinkProvider ──────────────────────────────────────

class ShioriDocumentLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;
      const extraction = extractShioriText(lineText);
      if (!extraction) continue;

      const parsed = parseShioriFields(extraction.fieldsText);
      if (!parsed.ref) continue;

      const url = resolveRefUrl(parsed.ref, state.refPatterns);
      if (!url) continue;

      // Find the ref position relative to the "shiori:" prefix.
      // The ref is the first token in fieldsText, which starts after "shiori:" + optional whitespace.
      const shioriMarker = 'shiori:';
      const shioriIdx = lineText.indexOf(shioriMarker, extraction.shioriOffset);
      if (shioriIdx === -1) continue;

      const afterShiori = shioriIdx + shioriMarker.length;
      // Skip optional whitespace between "shiori:" and the ref
      let refStart = afterShiori;
      while (refStart < lineText.length && lineText[refStart] === ' ') {
        refStart++;
      }

      const range = new vscode.Range(
        new vscode.Position(i, refStart),
        new vscode.Position(i, refStart + parsed.ref.length),
      );

      const link = new vscode.DocumentLink(range, vscode.Uri.parse(url));
      link.tooltip = `Open ${parsed.ref}`;
      links.push(link);
    }

    return links;
  }
}

// ── Activation / Deactivation ─────────────────────────────────

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Load registry on activation
  await loadWorkspaceRegistry();

  // Register providers for all file types
  const selector: vscode.DocumentSelector = { scheme: 'file' };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new ShioriHoverProvider()),
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      selector,
      new ShioriDocumentLinkProvider(),
    ),
  );

  // Reload registry when registry file changes
  const registryWatcher = vscode.workspace.createFileSystemWatcher(
    '**/.config/shiori/registry.{json,yaml,yml}',
  );

  registryWatcher.onDidChange(() => loadWorkspaceRegistry());
  registryWatcher.onDidCreate(() => loadWorkspaceRegistry());
  registryWatcher.onDidDelete(() => {
    state.registry = {};
    state.registryPath = undefined;
  });

  context.subscriptions.push(registryWatcher);

  // Reload when config changes
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    '**/.config/shiori/config.{yaml,yml,json}',
  );

  configWatcher.onDidChange(() => loadWorkspaceRegistry());
  configWatcher.onDidCreate(() => loadWorkspaceRegistry());

  context.subscriptions.push(configWatcher);
}

export function deactivate(): void {
  // Cleanup handled by disposables in context.subscriptions
}
