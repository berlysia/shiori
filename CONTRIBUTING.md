# Contributing

## Development Setup

```bash
git clone https://github.com/berlysia/shiori.git
cd shiori
pnpm install
pnpm build
pnpm test          # Requires Node.js >= 22.6.0
```

## Commands

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `pnpm build`         | TypeScript compilation (tsc → dist/) |
| `pnpm test`          | Run all tests (node:test)            |
| `pnpm test:coverage` | Run tests with coverage report       |
| `pnpm typecheck`     | Type check without emitting          |
| `pnpm lint`          | Lint with oxlint                     |
| `pnpm link:local`    | Build and globally link local CLI    |
| `pnpm unlink:local`  | Remove global link for local CLI     |
| `pnpm format`        | Format with oxfmt                    |
| `pnpm format:check`  | Check formatting                     |

Run a single test file:

```bash
node --experimental-strip-types --test tests/parser.test.ts
```

## Pre-commit Hook

This project uses husky + lint-staged. oxfmt runs automatically on staged files at commit time.

## Code Style

- TypeScript strict mode, no `any` types
- Formatting enforced by oxfmt (via pre-commit hook)
- Linting by oxlint

## Testing

- Framework: `node:test` + `node:assert/strict`
- All tests must pass before committing
- Follow existing test patterns (see `tests/` for examples)

## Architecture

Each CLI command has two files:

- `src/commands/<name>.ts` — Pure business logic (testable without CLI)
- `src/commands/<name>-cli.ts` — CLI wrapper (argument parsing, I/O, formatting)

Core modules live in `src/core/`. Design decisions are documented as ADRs in `docs/decisions/`.

## Releasing

```bash
pnpm release patch   # or minor / major
```

Runs typecheck → lint → boundary check → format check → build → test, then bumps the version in `packages/shiori-cli/package.json`. Commit and push after the script completes.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`

## Reporting Issues

Use [GitHub Issues](https://github.com/berlysia/shiori/issues). Please include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
