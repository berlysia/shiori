// Release guard: a stable release must ship with its CHANGELOG section, and the section must
// list at least one item. `pnpm run release` generates the section from the pending changesets
// and runs the same check; release.yml runs this file again as the last gate before packing.
// Prereleases (rc, beta) need none.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function requiresChangelogSection(version: string): boolean {
  return !version.includes('-');
}

export function hasChangelogSection(
  changelog: string,
  version: string,
): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(
    changelog,
  );
}

// The section under `## [version] - YYYY-MM-DD` has at least one `- ` item before the next
// `## ` heading (or the end of the file). A heading without items is a generation failure.
export function hasChangelogItems(changelog: string, version: string): boolean {
  const lines = changelog.split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('## ')) return false;
    if (line.startsWith('- ')) return true;
  }
  return false;
}

function main(): void {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const changelogUrl = new URL('../../../CHANGELOG.md', import.meta.url);
  const { version } = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as {
    version: string;
  };
  if (!requiresChangelogSection(version)) return;
  const changelog = readFileSync(changelogUrl, 'utf8');
  if (
    hasChangelogSection(changelog, version) &&
    hasChangelogItems(changelog, version)
  ) {
    return;
  }

  console.error(
    [
      `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section with at least one "- " item.`,
      '`pnpm run release` builds the section from the changesets in .changeset/.',
      'If the tag was pushed by hand, write a changeset and run `pnpm run release` to release again.',
    ].join('\n'),
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
