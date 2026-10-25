# Changesets

Each pull request that changes what users see adds one changeset: a Markdown
file in this directory, created with `pnpm changeset` or by hand. The release
command reads the pending changesets to pick the version and to write the
`CHANGELOG.md` section, so nobody types a version number.

## Format

A changeset is a frontmatter with the bump level of `@berlysia/shiori`, then a
body in Keep a Changelog headings:

```md
---
'@berlysia/shiori': minor
---

### Added

- **`shiori example` command**: prints an example. Each entry is one line.

### Fixed

- **Example crash**: the example no longer crashes on empty input.
```

Rules, checked by `pnpm run check:changesets` in CI and before a release:

- The frontmatter has exactly one line, `'@berlysia/shiori': patch|minor|major`.
  No other package may appear there.
- The body is `### <heading>` lines, `- ` entries and blank lines only. The
  first non-blank line is a heading. Each heading has at least one entry and
  appears once.
- Headings: `Breaking Changes`, `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, `Security`.
- An entry is a single line. No continuation lines, nesting, code fences, HTML
  or other headings.
- No carriage returns, control characters, bidi controls or invisible format
  characters. The file stays within 64 KiB.

`CHANGELOG.md` keeps `## [Unreleased]` empty: the release command generates the
version section from the changesets.
