// Release guard run by bumpp's --execute, after the version bump and before the release commit.
// A stable release must ship with its CHANGELOG section, drafted beforehand with the
// /changelog Claude Code skill and committed separately. Prereleases (rc, beta) need none.
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

function main(): void {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  const changelogUrl = new URL('../../../CHANGELOG.md', import.meta.url);
  const { version } = JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as {
    version: string;
  };
  if (!requiresChangelogSection(version)) return;
  if (hasChangelogSection(readFileSync(changelogUrl, 'utf8'), version)) return;

  console.error(
    [
      `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section; the release stopped before committing.`,
      'undo the bump: git checkout -- packages/shiori-cli/package.json packages/shiori-cli/src/core/version.ts',
      `then: draft the section with /changelog ${version} in Claude Code, commit it, and run pnpm run release again`,
    ].join('\n'),
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
