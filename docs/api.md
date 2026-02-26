# Programmatic API

shiori exposes a programmatic API for integration with editors, CI tools, and custom tooling.

## Installation

```bash
npm install @berlysia/shiori
# or
pnpm add @berlysia/shiori
```

## Exports

### `@berlysia/shiori` — Core Types

All shared type definitions used across the codebase.

```typescript
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
  | 'unrouted-ref';

type IssueSeverity = 'error' | 'warning';
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
import type { ShioriAnnotation, Registry } from '@berlysia/shiori';
import { show, isFound } from '@berlysia/shiori/commands/show';
import { resolveRefUrl } from '@berlysia/shiori/core/ref-pattern';

// Load data from scan result and registry files (via fs)
const scanResult = JSON.parse(
  await readFile('.config/shiori/scan-result.json', 'utf-8'),
);
const registry = JSON.parse(
  await readFile('.config/shiori/registry.json', 'utf-8'),
);

// Look up a ref under cursor
const result = show({
  ref: 'SUP-1234',
  registry,
  annotations: scanResult.annotations,
  refPatterns: undefined, // or load from config
});

if (isFound(result)) {
  // Show hover information, navigate to source, open URL
}
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

All exported functions are pure (no I/O, no exceptions). File loading and validation should be handled by the caller. The CLI commands (`shiori scan`, `shiori verify`, etc.) handle all I/O and error reporting.

Registry and scan result files can be loaded as plain JSON with standard `JSON.parse()`. See `RegistryEntry` for the expected shape of registry entries — validation is the caller's responsibility when using the programmatic API.
