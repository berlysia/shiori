# Programmatic API

shiori exposes a programmatic API for integration with editors, CI tools, and custom tooling.

## Installation

```bash
npm install @berlysia/shiori
# or
pnpm add @berlysia/shiori
```

## Exports

### `@berlysia/shiori` — Core Types & Config

Shared type definitions, config loading, and registry loading.

```typescript
import {
  loadConfig,
  resolveConfig,
  loadRegistry,
  parseShioriFields,
  isValidRef,
  REF_PATTERN,
  resolveRefUrl,
  matchRefPattern,
} from '@berlysia/shiori';
import type {
  ShioriAnnotation,
  ShioriCandidate,
  ScanResult,
  Registry,
  RegistryEntry,
  VerifyResult,
  VerifyIssue,
  VerifyIssueType,
  IssueSeverity,
  ShioriConfig,
  ResolvedConfig,
  RegistryLoadResult,
  RegistryValidationError,
  ParsedShioriFields,
  RefPatternConfig,
  RefPatternMatch,
} from '@berlysia/shiori';
```

#### `ShioriAnnotation`

A single annotation extracted from source code.

```typescript
interface ShioriAnnotation {
  /** Reference ID (e.g. "SUP-1234", "ADR:0007"). Empty string if draft */
  ref: string;
  /** Lint rule name (e.g. "no-console") */
  rule?: string;
  /** Expiration date (YYYY-MM-DD or YYYY-MM) */
  expires?: string;
  /** Reason text */
  reason?: string;
  /** Whether the annotation has an explicit shiori: marker */
  tagged: boolean;
  /** Whether the annotation is ignored via shiori:ignore */
  ignored: boolean;
  /** Parser syntax errors, if any */
  syntaxErrors?: string[];
  /** Source location */
  location: { file: string; line: number };
}
```

#### `ShioriCandidate`

A candidate comment detected by pattern matching (no shiori: marker).

```typescript
interface ShioriCandidate {
  /** Detection pattern category (e.g. "eslint", "stylelint") */
  pattern: string;
  /** Directive type (e.g. "disable-next-line") */
  directive?: string;
  /** Lint rule name */
  rule?: string;
  /** Comment text (for TODO/FIXME patterns) */
  text?: string;
  /** Source location */
  location: { file: string; line: number };
}
```

#### `ScanResult`

Result of scanning source files. Returned by the `scan` command's JSON output.

```typescript
interface ScanResult {
  /** Extracted annotations (stably sorted by ref, location.file, location.line) */
  annotations: ShioriAnnotation[];
  /** Detected candidates (sorted by location.file, location.line) */
  candidates: ShioriCandidate[];
  /** Number of files scanned */
  filesScanned: number;
}
```

#### `Registry` / `RegistryEntry`

The annotation registry: a JSON/YAML file mapping ref IDs to structured metadata.

```typescript
type Registry = Record<string, RegistryEntry>;

interface RegistryEntry {
  reason: string;
  target: string | string[];
  expires: string | undefined;
  ticket: string | undefined;
  owner: string | undefined;
  notes: string | undefined;
  kind: string | undefined;
}
```

#### `VerifyResult` / `VerifyIssue`

Output of the `verify` command.

```typescript
interface VerifyResult {
  timestamp: string;
  issues: VerifyIssue[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    byType: Record<VerifyIssueType, number>;
  };
  scannedRecords: number;
  registryEntries: number;
}

interface VerifyIssue {
  type: VerifyIssueType;
  severity: IssueSeverity;
  ref: string;
  message: string;
  file: string | undefined;
  line: number | undefined;
}

type VerifyIssueType =
  | 'missing-in-registry'
  | 'unused-in-source'
  | 'expired'
  | 'syntax-error'
  | 'ref-format'
  | 'ref-collision'
  | 'unrouted-ref'
  | 'registry-routing-mismatch'
  | 'expiring-soon'
  | 'ref-status-closed';

type IssueSeverity = 'error' | 'warning';
```

#### `parseShioriFields(input)`

Parse a shiori field string with positional ref. The first token (before whitespace) is treated as the tracking reference. Remaining tokens are parsed as `key=value` pairs.

```typescript
function parseShioriFields(input: string): ParsedShioriFields;
```

**Example:**

```typescript
import { parseShioriFields } from '@berlysia/shiori';

const fields = parseShioriFields('SUP-1234 expires=2026-06 reason=workaround');
// → { ref: 'SUP-1234', expires: '2026-06', reason: 'workaround', errors: [] }
```

#### `ParsedShioriFields`

```typescript
interface ParsedShioriFields {
  ref: string;
  expires?: string;
  reason?: string;
  errors: string[];
  [key: string]: string | string[] | undefined;
}
```

#### `resolveRefUrl(ref, patterns)` / `matchRefPattern(ref, patterns)`

Also available from the root barrel for convenience. See [`@berlysia/shiori/core/ref-pattern`](#berlysiashioricoref-pattern--ref-pattern-matching) for full documentation.

```typescript
import { resolveRefUrl, matchRefPattern } from '@berlysia/shiori';
```

#### `isValidRef(ref)` / `REF_PATTERN`

Validate whether a ref string matches the expected format.

```typescript
import { isValidRef, REF_PATTERN } from '@berlysia/shiori';

isValidRef('SUP-1234'); // → true
isValidRef(''); // → false
REF_PATTERN; // → /^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/
```

#### `loadConfig(cwd, configDir?)`

Load shiori configuration from the project directory. Searches for `config.yaml` → `config.yml` → `config.json` inside `.config/shiori/` (or the specified `configDir`). Returns default config if no file exists.

```typescript
async function loadConfig(
  cwd: string,
  configDir?: string,
): Promise<ResolvedConfig>;
```

**Example:**

```typescript
import { loadConfig } from '@berlysia/shiori';

const config = await loadConfig(workspaceRoot);
// config.refPatterns → RefPatternConfig[] | undefined
// config.paths.registry → string | undefined
// config.paths.scanResult → string
```

#### `resolveConfig(raw)`

Merge partial config with defaults. Useful when config is already loaded or constructed programmatically.

```typescript
function resolveConfig(raw: ShioriConfig): ResolvedConfig;
```

#### `loadRegistry(filePath)`

Load and validate a registry file (JSON or YAML, auto-detected by extension).

```typescript
async function loadRegistry(filePath: string): Promise<RegistryLoadResult>;
```

**Example:**

```typescript
import { loadRegistry } from '@berlysia/shiori';

const { registry, errors } = await loadRegistry('.config/shiori/registry.json');
```

#### Config Types

```typescript
interface ShioriConfig {
  /** Candidate detection pattern overrides */
  candidates?: Partial<CandidatePatternConfig>;
  /** Pattern-based ref resolution (ADR 012) */
  refPatterns?: RefPatternConfig[];
  /** Default scan options */
  scan?: { patterns?: string[]; ignore?: string[] };
  /** Default file paths */
  paths?: { scanResult?: string; registry?: string };
  /** Verify command options */
  verify?: { expiringThresholdDays?: number };
}

interface ResolvedConfig {
  candidatePatterns: ResolvedCandidatePatterns;
  refPatterns: RefPatternConfig[] | undefined;
  scanPatterns: string[] | undefined;
  scanIgnore: string[] | undefined;
  paths: { scanResult: string; registry: string | undefined };
  verify: { expiringThresholdDays: number };
}

interface RegistryLoadResult {
  registry: Registry;
  errors: RegistryValidationError[];
}

interface RegistryValidationError {
  id: string;
  message: string;
}
```

---

### `@berlysia/shiori/core/ref-pattern` — Ref Pattern Matching

Functions to match ref IDs against configurable patterns and resolve URLs.

```typescript
import {
  matchRefPattern,
  resolveRefUrl,
} from '@berlysia/shiori/core/ref-pattern';
import type {
  RefPatternConfig,
  RefPatternMatch,
} from '@berlysia/shiori/core/ref-pattern';
```

#### `matchRefPattern(ref, patterns)`

Match a ref string against an array of patterns. Returns the first match with captured `{id}`, or `undefined`.

```typescript
function matchRefPattern(
  ref: string,
  patterns: RefPatternConfig[] | undefined,
): RefPatternMatch | undefined;
```

**Example:**

```typescript
const patterns: RefPatternConfig[] = [
  {
    match: 'JIRA-{id}',
    urlTemplate: 'https://jira.example.com/browse/JIRA-{id}',
  },
  { match: 'ADR-{id}' },
];

const result = matchRefPattern('JIRA-1234', patterns);
// → { config: { match: 'JIRA-{id}', urlTemplate: '...' }, captures: { id: '1234' } }

const noMatch = matchRefPattern('OTHER-001', patterns);
// → undefined
```

#### `resolveRefUrl(ref, patterns)`

Resolve a ref to a URL using pattern configuration. Returns `undefined` if no match or no `urlTemplate`.

```typescript
function resolveRefUrl(
  ref: string,
  patterns: RefPatternConfig[] | undefined,
): string | undefined;
```

**Example:**

```typescript
const url = resolveRefUrl('JIRA-1234', patterns);
// → 'https://jira.example.com/browse/JIRA-1234'
```

#### Types

```typescript
interface RefPatternConfig {
  /** Pattern to match, e.g. "JIRA-{id}" */
  match: string;
  /** URL template with {id} placeholder */
  urlTemplate?: string;
  /** Per-pattern registry file path */
  registryFile?: string;
}

interface RefPatternMatch {
  config: RefPatternConfig;
  captures: { id: string };
}
```

---

### `@berlysia/shiori/core/ref-status-providers` — Ref Status Provider Interface

Interface for implementing custom ref status providers that check the open/closed state of tracking references (e.g., issue trackers, project management tools).

```typescript
import type { RefStatusProvider } from '@berlysia/shiori/core/ref-status-providers';
```

#### `RefStatusProvider`

Abstraction for ref status resolution. Implement this interface to create a custom provider, then connect it via `--ref-status-command`.

```typescript
interface RefStatusProvider {
  /** Provider name for logging and diagnostics */
  readonly name: string;

  /**
   * Resolve statuses for the given refs.
   * Implementations should gracefully handle unknown refs by returning
   * status 'unknown' or omitting them from results.
   */
  resolve(refs: string[]): Promise<RefStatusEntry[]>;
}
```

`RefStatusEntry` is defined in the core types (`@berlysia/shiori`):

```typescript
interface RefStatusEntry {
  ref: string;
  status: 'open' | 'closed' | 'unknown';
}
```

**Usage — External command provider:**

External providers connect via `--ref-status-command`, receiving refs on stdin (newline-delimited) and returning JSONL on stdout:

```bash
shiori verify --ref-status-command ./my-jira-checker
```

See [ADR 025](./decisions/025-ref-status-provider-registry.md) for the provider selection priority chain and extensibility design.

---

### `@berlysia/shiori/commands/show` — Ref Lookup

Pure function to look up information about a specific ref.

```typescript
import { show, isFound } from '@berlysia/shiori/commands/show';
import type { ShowInput, ShowResult } from '@berlysia/shiori/commands/show';
```

#### `show(input)`

Look up a ref across registry and source annotations. Pure function — no I/O.

```typescript
function show(input: ShowInput): ShowResult;
```

**Example:**

```typescript
import { show, isFound } from '@berlysia/shiori/commands/show';

const result = show({
  ref: 'SUP-1234',
  registry: loadedRegistry,
  annotations: scanResult.annotations,
  refPatterns: config.refPatterns,
});

if (isFound(result)) {
  console.log('Registry:', result.registryEntry);
  console.log('Locations:', result.sourceLocations);
  console.log('URL:', result.url);
}
```

#### `isFound(result)`

Returns `true` if the show result found any information (registry entry or source locations).

```typescript
function isFound(result: ShowResult): boolean;
```

#### Types

```typescript
interface ShowInput {
  ref: string;
  registry: Registry;
  annotations: ShioriAnnotation[];
  refPatterns: RefPatternConfig[] | undefined;
}

interface ShowResult {
  ref: string;
  registryEntry: RegistryEntry | undefined;
  sourceLocations: Array<{ file: string; line: number }>;
  url: string | undefined;
}
```

---

## Usage Patterns

### Editor Integration (VSCode Extension)

For a VSCode extension that needs to read shiori annotations:

```typescript
import type { ScanResult } from '@berlysia/shiori';
import { loadConfig, loadRegistry } from '@berlysia/shiori';
import { show, isFound } from '@berlysia/shiori/commands/show';
import { resolveRefUrl } from '@berlysia/shiori/core/ref-pattern';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Load config to get refPatterns and registry path
const config = await loadConfig(workspaceRoot);
const registryPath = resolve(
  workspaceRoot,
  config.paths.registry ?? '.config/shiori/registry.json',
);
const { registry } = await loadRegistry(registryPath);

// Load scan result
const scanResult: ScanResult = JSON.parse(
  await readFile(resolve(workspaceRoot, config.paths.scanResult), 'utf-8'),
);

// Look up a ref under cursor (HoverProvider)
const result = show({
  ref: 'SUP-1234',
  registry,
  annotations: scanResult.annotations,
  refPatterns: config.refPatterns,
});

if (isFound(result)) {
  // Show hover information, navigate to source, open URL
}

// Resolve ref to external URL (DocumentLinkProvider)
const url = resolveRefUrl('SUP-1234', config.refPatterns);
```

### CI Integration

For custom CI tooling that reads verify results:

```typescript
import type { VerifyResult, VerifyIssueType } from '@berlysia/shiori';

// Parse output from `shiori verify -f json`
const result: VerifyResult = JSON.parse(verifyOutput);

// Check for specific issue types
const expired = result.issues.filter((i) => i.type === 'expired');
if (expired.length > 0) {
  // Fail the build or send notifications
}
```

## Error Handling

Pure functions (`show`, `isFound`, `resolveRefUrl`, `matchRefPattern`, `resolveConfig`) do not throw. I/O functions (`loadConfig`, `loadRegistry`) throw on file read errors; `loadRegistry` also returns validation errors in the `errors` array while still providing a best-effort registry.

Registry and scan result files can be loaded as plain JSON with standard `JSON.parse()`. See `RegistryEntry` for the expected shape of registry entries — validation is the caller's responsibility when using the programmatic API directly.
