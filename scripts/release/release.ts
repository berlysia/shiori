// `pnpm run release`: the entry decision and the front half of a release, up
// to the push of the tag. Each step observes, asks a pure function in lib/ to
// judge, and performs one operation. There is no progress file: after any
// interruption the entry decision reads git, npm and the work tree again.
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANGELOG,
  IGNORED_PACKAGE_DIRS,
  PACKAGE_JSON,
  PRE_JSON,
  VERSION_TS,
  compareChangeSets,
  findViolations,
  planIgnoredRestore,
  planPreCommands,
  removeUntracked,
  type PreState,
  type ReleaseKind,
} from './lib/allowlist.ts';
import { insertSection, renderSection } from './lib/changelog.ts';
import {
  checkChangesetDirectory,
  parseChangeset,
  type ChangesetDirectoryEntry,
  type ParsedChangeset,
} from './lib/changeset.ts';
import { distTagFor } from './lib/dist-tag.ts';
import {
  checkGitDirection,
  expectedGitDir,
  type DotGit,
} from './lib/git-direction.ts';
import {
  adviseOnDirtyTree,
  decideEntry,
  pushRetryCommands,
  type EntryDecision,
  type EntryObservation,
  type NpmState,
  type StatusObservation,
} from './lib/entry.ts';
import {
  firstErrorLine,
  parseCommitSha,
  parseLsRemote,
  parseNameStatus,
  parseNpmView,
  parsePorcelain,
} from './lib/observe.ts';
import {
  checkPublishable,
  checkResume,
  checkVersionApplied,
  parseStatus,
} from './lib/preconditions.ts';
import {
  checkChangesetConfig,
  checkEnvironment,
  checkOrigin,
  checkRulesets,
  checkTools,
  checkTrust,
  parseRulesetIds,
  type PrereqResult,
} from './lib/prerequisites.ts';
import { parseVersion, type ValidVersion } from './lib/semver.ts';
import {
  SECTIONS,
  exitCodeOfRow,
  formatStopReport,
  type StopInfo,
} from './lib/stop-report.ts';
import type {
  ChangeEntry,
  Deps,
  Flags,
  Observed,
  RunResult,
  WorkingChange,
} from './lib/types.ts';
import { syncVersionConstant } from './lib/version-file.ts';
import { createDeps } from './deps.ts';
import { enterAfterPush } from './release-after-push.ts';

const PKG = '@berlysia/shiori';
const TAG_PATTERN = /^[a-z]+$/;
const MAX_DETAIL = 20;

const QUALITY_CHECKS: readonly (readonly string[])[] = [
  ['typecheck'],
  ['lint'],
  ['--filter', PKG, 'run', 'lint:boundaries'],
  ['--filter', PKG, 'run', 'lint:envelope'],
  ['format:check'],
  ['build'],
  ['test'],
];

// A stop carries its own report and exit code, so a stage can end the run
// from any depth without every caller passing a result up.
class ReleaseStop extends Error {
  info: StopInfo;
  exitCode: number;
  constructor(info: StopInfo, exitCode = 1) {
    super(info.reason);
    this.info = info;
    this.exitCode = exitCode;
  }
}

interface Ctx {
  readonly deps: Deps;
  readonly flags: Flags;
  evidenceDir: string | undefined;
  readonly saved: Map<string, number>;
}

// ---------------------------------------------------------------------------
// flags
// ---------------------------------------------------------------------------

export function parseFlags(argv: readonly string[]): Flags | string {
  const args = argv.filter((arg) => arg !== '--');
  if (args.length === 0) return { mode: 'normal' };
  if (args.length === 1 && args[0] === '--exit-pre') {
    return { mode: 'exit-pre' };
  }
  if (args[0] === '--pre') {
    if (args.length !== 2) {
      return '--pre needs exactly one tag, for example --pre rc';
    }
    const tag = args[1] ?? '';
    return TAG_PATTERN.test(tag)
      ? { mode: 'pre', tag }
      : 'the --pre tag must be lowercase letters only, for example rc';
  }
  return `unknown argument(s): ${args.join(' ')}. Usage: pnpm run release [--pre <tag> | --exit-pre]`;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function sh(
  ctx: Ctx,
  cmd: string,
  args: readonly string[],
  options: { stdio?: 'pipe' | 'inherit'; raw?: boolean } = {},
): Promise<RunResult> {
  return ctx.deps.run(cmd, args, {
    stdio: options.stdio ?? 'pipe',
    ...(options.raw === undefined ? {} : { raw: options.raw }),
  });
}

function git(ctx: Ctx, ...args: string[]): Promise<RunResult> {
  return sh(ctx, 'git', args);
}

function stopAt(
  at: StopInfo['at'],
  reason: string,
  extra: Partial<StopInfo> = {},
  exitCode = 1,
): ReleaseStop {
  return new ReleaseStop(
    { at, reason, commands: [], section: SECTIONS.resume, ...extra },
    exitCode,
  );
}

function tailLines(result: RunResult, count = 5): string[] {
  return result.stderrTail
    .trim()
    .split('\n')
    .slice(-count)
    .filter((line) => line !== '');
}

// A git command that must succeed for the step to mean anything.
async function mustGit(
  ctx: Ctx,
  at: StopInfo['at'],
  ...args: string[]
): Promise<string> {
  const result = await git(ctx, ...args);
  if (result.code !== 0) {
    throw stopAt(at, `git ${args[0] ?? ''} failed`, {
      detail: tailLines(result),
    });
  }
  return result.stdout;
}

async function readText(ctx: Ctx, path: string): Promise<string | undefined> {
  const absolute = join(ctx.deps.cwd, path);
  if ((await ctx.deps.fs.lstat(absolute)) === undefined) return undefined;
  return ctx.deps.fs.readFile(absolute);
}

async function gitShow(
  ctx: Ctx,
  rev: string,
  path: string,
): Promise<string | undefined> {
  const result = await git(ctx, 'show', `${rev}:${path}`);
  return result.code === 0 ? result.stdout : undefined;
}

// The raw output of a command that decides something, kept for the person who
// has to check it by hand when its shape was not what the script expected.
async function saveRaw(
  ctx: Ctx,
  name: string,
  result: RunResult,
): Promise<void> {
  const count = (ctx.saved.get(name) ?? 0) + 1;
  ctx.saved.set(name, count);
  const file = count === 1 ? name : `${count}-${name}`;
  await ctx.deps.evidence.save(
    file,
    `exit: ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr (tail) ---\n${result.stderrTail}\n`,
  );
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function report(deps: Deps, info: StopInfo, exitCode: number): number {
  for (const line of formatStopReport(info)) {
    if (exitCode === 0) deps.output.emit(line);
    else deps.output.emitError(line);
  }
  return exitCode;
}

function describeChanges(changes: readonly ChangeEntry[]): string[] {
  const lines = changes
    .slice(0, MAX_DETAIL)
    .map((change) => `${change.state} ${change.path}`);
  if (changes.length > MAX_DETAIL) {
    lines.push(`... and ${changes.length - MAX_DETAIL} more`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// observation
// ---------------------------------------------------------------------------

async function readPreState(ctx: Ctx): Promise<PreState> {
  const text = await readText(ctx, PRE_JSON);
  if (text === undefined) return { active: false };
  try {
    const json = JSON.parse(text) as { mode?: unknown; tag?: unknown };
    if (json.mode === 'pre' && typeof json.tag === 'string') {
      return { active: true, tag: json.tag };
    }
    // mode "exit" is what `changeset pre exit` leaves until the next version
    return { active: false };
  } catch {
    throw stopAt('entry', '.changeset/pre.json is not valid JSON');
  }
}

// Only these files are judged by content, so only these are read.
const CONTENT_JUDGED = new Set([
  PACKAGE_JSON,
  VERSION_TS,
  CHANGELOG,
  ...IGNORED_PACKAGE_DIRS.map((dir) => `${dir}/package.json`),
]);

async function readWorkingTree(
  ctx: Ctx,
  at: StopInfo['at'],
): Promise<WorkingChange[]> {
  const stdout = await mustGit(
    ctx,
    at,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  const changes: WorkingChange[] = [];
  for (const change of parsePorcelain(stdout)) {
    let before: string | undefined;
    let after: string | undefined;
    if (CONTENT_JUDGED.has(change.path)) {
      if (change.state !== '??' && change.state !== 'A') {
        before = await gitShow(ctx, 'HEAD', change.path);
      }
      if (change.state !== 'D') after = await readText(ctx, change.path);
    }
    changes.push({ ...change, before, after });
  }
  return changes;
}

async function observeNpm(ctx: Ctx): Promise<NpmState> {
  const versions = await sh(ctx, 'npm', ['view', PKG, 'versions', '--json']);
  const distTags = await sh(ctx, 'npm', ['view', PKG, 'dist-tags', '--json']);
  await saveRaw(ctx, 'npm-view-versions.txt', versions);
  return parseNpmView(versions, distTags);
}

async function observeTags(
  ctx: Ctx,
  version: ValidVersion,
): Promise<{
  local: string | undefined;
  origin: Observed<string | undefined>;
}> {
  const tag = `v${version}`;
  const local = await git(
    ctx,
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/tags/${tag}^{commit}`,
  );
  const remote = await git(
    ctx,
    'ls-remote',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  );
  return {
    local: local.code === 0 ? parseCommitSha(local.stdout) : undefined,
    origin:
      remote.code === 0
        ? parseLsRemote(remote.stdout, tag)
        : { kind: 'error', error: `git ls-remote exited with ${remote.code}` },
  };
}

async function readPackageVersion(ctx: Ctx): Promise<Observed<ValidVersion>> {
  const text = await readText(ctx, PACKAGE_JSON);
  if (text === undefined) {
    return { kind: 'error', error: `${PACKAGE_JSON} is missing` };
  }
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    const parsed =
      typeof version === 'string' ? parseVersion(version) : undefined;
    return parsed?.ok
      ? { kind: 'ok', value: parsed.version }
      : {
          kind: 'error',
          error: 'the version in package.json is not a plain semver',
        };
  } catch {
    return { kind: 'error', error: `${PACKAGE_JSON} is not valid JSON` };
  }
}

async function observe(ctx: Ctx): Promise<EntryObservation> {
  const head = parseCommitSha(await mustGit(ctx, 'entry', 'rev-parse', 'HEAD'));
  if (head === undefined) {
    throw stopAt('entry', 'git rev-parse HEAD printed no commit');
  }
  const headMessage = (
    await mustGit(ctx, 'entry', 'log', '-1', '--format=%s')
  ).trim();
  const version = await readPackageVersion(ctx);
  const pre = await readPreState(ctx);
  const workingTree = await readWorkingTree(ctx, 'entry');
  const npm = await observeNpm(ctx);
  const tags =
    version.kind === 'ok'
      ? await observeTags(ctx, version.value)
      : { local: undefined, origin: { kind: 'ok', value: undefined } as const };
  return {
    flags: ctx.flags,
    head,
    headMessage,
    workingTree,
    version,
    localTag: tags.local,
    originTag: tags.origin,
    npm,
    preMode: pre.active,
  };
}

// The `ignore` list of .changeset/config.json. Stage 1 has checked it against
// its expected value; before that (entry) it is only used to skip releases
// that carry no changeset.
async function readIgnoredNames(ctx: Ctx): Promise<string[]> {
  try {
    const ignore = (
      JSON.parse((await readText(ctx, '.changeset/config.json')) ?? '') as {
        ignore?: unknown;
      }
    ).ignore;
    return Array.isArray(ignore)
      ? ignore.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

async function runStatus(
  ctx: Ctx,
  fileName: string,
): Promise<StatusObservation> {
  const dir = ctx.evidenceDir;
  if (dir === undefined)
    throw stopAt('entry', 'the evidence directory is not open');
  const relativeOutput = relative(ctx.deps.cwd, join(dir, fileName));
  // changeset resolves --output against the repository root
  const result = await sh(ctx, 'pnpm', [
    'exec',
    'changeset',
    'status',
    `--output=${relativeOutput}`,
  ]);
  await saveRaw(ctx, `${fileName}.log`, result);
  if (result.code !== 0) {
    const reason = firstErrorLine(`${result.stderrTail}\n${result.stdout}`);
    return {
      kind: 'failed',
      error: `changeset status exited with ${result.code}${reason === undefined ? '' : `: ${reason}`}`,
    };
  }
  const text = await readText(ctx, relativeOutput);
  if (text === undefined) {
    return { kind: 'failed', error: 'changeset status wrote no output file' };
  }
  return parseStatus(text, await readIgnoredNames(ctx));
}

// ---------------------------------------------------------------------------
// prerequisites (stage 1, and the GitHub half again before the push)
// ---------------------------------------------------------------------------

function prereqStop(
  ctx: Ctx,
  at: StopInfo['at'],
  what: string,
  result: PrereqResult,
  extra: Partial<StopInfo> = {},
): ReleaseStop {
  if (result.kind === 'eotp') {
    return stopAt(
      at,
      'npm asked for a one-time password again (the 2FA grace period ended). Nothing was changed',
      {
        commands: ['npm trust list @berlysia/shiori', 'pnpm run release'],
        section: SECTIONS.verifyByHand,
      },
    );
  }
  const detail: string[] = [];
  if (result.kind === 'mismatch') detail.push(...result.fields);
  else if (result.kind !== 'ok') detail.push(result.detail);
  if (ctx.evidenceDir !== undefined) {
    detail.push(`raw output saved under ${ctx.evidenceDir}`);
  }
  return stopAt(at, `${what}: ${result.kind}`, {
    detail,
    section: SECTIONS.verifyByHand,
    ...extra,
  });
}

async function checkGithubProtections(
  ctx: Ctx,
  at: StopInfo['at'],
  extra: Partial<StopInfo> = {},
): Promise<void> {
  const gh = (path: string) => sh(ctx, 'gh', ['api', '--method', 'GET', path]);
  const environment = await gh('repos/berlysia/shiori/environments/npm');
  const policies = await gh(
    'repos/berlysia/shiori/environments/npm/deployment-branch-policies',
  );
  await saveRaw(ctx, 'gh-environment.json', environment);
  await saveRaw(ctx, 'gh-environment-policies.json', policies);
  const env = checkEnvironment(environment, policies);
  if (env.kind !== 'ok')
    throw prereqStop(ctx, at, 'environment "npm"', env, extra);

  const list = await gh('repos/berlysia/shiori/rulesets');
  await saveRaw(ctx, 'gh-rulesets.json', list);
  const ids = parseRulesetIds(list);
  if (ids.kind !== 'ok') throw prereqStop(ctx, at, 'rulesets', ids, extra);
  const details: RunResult[] = [];
  for (const id of ids.ids) {
    const detail = await gh(`repos/berlysia/shiori/rulesets/${id}`);
    await saveRaw(ctx, `gh-ruleset-${id}.json`, detail);
    details.push(detail);
  }
  const rulesets = checkRulesets(details);
  if (rulesets.kind !== 'ok') {
    throw prereqStop(ctx, at, 'tag ruleset', rulesets, extra);
  }
}

async function checkTrustList(ctx: Ctx): Promise<void> {
  ctx.deps.output.emit(
    'npm will ask for a one-time password. Choose to skip 2FA for the next 5 minutes, so the machine-readable check that follows does not ask again.',
  );
  // The one command whose output is shown unsanitized: it must reach the
  // terminal for the 2FA prompt. It decides nothing; the --json call does.
  await sh(ctx, 'npm', ['trust', 'list', PKG], { stdio: 'inherit' });
  const json = await sh(ctx, 'npm', ['trust', 'list', PKG, '--json']);
  await saveRaw(ctx, 'trust-list.json', json);
  const result = checkTrust(json);
  if (result.kind !== 'ok') throw prereqStop(ctx, 1, 'npm trust', result);
}

async function stageOne(
  ctx: Ctx,
  options: { frontHalf: boolean },
): Promise<void> {
  const branch = (
    await mustGit(ctx, 1, 'rev-parse', '--abbrev-ref', 'HEAD')
  ).trim();
  if (branch !== 'master') {
    throw stopAt(1, `the current branch is "${branch}", not master`, {
      commands: ['git switch master'],
      section: SECTIONS.everyRelease,
    });
  }
  if (options.frontHalf) {
    const head = (await mustGit(ctx, 1, 'rev-parse', 'HEAD')).trim();
    const origin = (await mustGit(ctx, 1, 'rev-parse', 'origin/master')).trim();
    if (head !== origin) {
      throw stopAt(1, 'HEAD is not origin/master after fetching', {
        commands: ['git pull --ff-only'],
        section: SECTIONS.everyRelease,
      });
    }
  }
  const config = await readText(ctx, '.changeset/config.json');
  const configResult: PrereqResult =
    config === undefined
      ? { kind: 'shape-unknown', detail: '.changeset/config.json is missing' }
      : checkChangesetConfig(config);
  if (configResult.kind !== 'ok') {
    throw prereqStop(ctx, 1, '.changeset/config.json', configResult);
  }

  await checkTrustList(ctx);
  await checkGithubProtections(ctx, 1);

  if (!options.frontHalf) return;
  await checkChangesets(ctx);
  for (const args of QUALITY_CHECKS) {
    // inherit: repo-managed commands, shown as they run
    const result = await sh(ctx, 'pnpm', args, { stdio: 'inherit' });
    if (result.code !== 0) {
      throw stopAt(1, `pnpm ${args.join(' ')} failed`, {
        section: SECTIONS.everyRelease,
      });
    }
  }
  const dirty = await readWorkingTree(ctx, 1);
  if (dirty.length > 0) {
    throw stopAt(1, 'the quality checks changed the working tree', {
      detail: describeChanges(dirty),
      commands: ['git status --short'],
    });
  }
}

async function readChangesetEntries(
  ctx: Ctx,
): Promise<ChangesetDirectoryEntry[]> {
  const dir = join(ctx.deps.cwd, '.changeset');
  const entries: ChangesetDirectoryEntry[] = [];
  for (const name of (await ctx.deps.fs.readdir(dir)).sort()) {
    const stat = await ctx.deps.fs.lstat(join(dir, name));
    if (stat === undefined || !stat.isFile) {
      entries.push({ name, kind: 'other', size: 0, text: undefined });
      continue;
    }
    entries.push({
      name,
      kind: 'file',
      size: stat.size,
      // a file over the limit is reported by its size, not read
      text:
        stat.size > 65536
          ? undefined
          : await ctx.deps.fs.readFile(join(dir, name)),
    });
  }
  return entries;
}

async function checkChangesets(ctx: Ctx): Promise<void> {
  const changelog = await readText(ctx, CHANGELOG);
  if (changelog === undefined) throw stopAt(1, 'CHANGELOG.md is missing');
  const violations = checkChangesetDirectory(
    await readChangesetEntries(ctx),
    changelog,
  );
  if (violations.length > 0) {
    throw stopAt(
      1,
      'the changesets or the [Unreleased] block of CHANGELOG.md are not valid',
      {
        detail: violations.slice(0, MAX_DETAIL),
        commands: ['pnpm run check:changesets'],
        section: SECTIONS.everyRelease,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// stage 2: the version bump
// ---------------------------------------------------------------------------

// Stage 2 to 5 stops leave the bump in the work tree; the person is told how
// to undo it by the same rule as entry row 1.
async function stageStop(
  ctx: Ctx,
  at: number,
  reason: string,
  detail: string[] = [],
): Promise<ReleaseStop> {
  const workingTree = await readWorkingTree(ctx, at);
  if (workingTree.length === 0) return stopAt(at, reason, { detail });
  const advice = adviseOnDirtyTree(workingTree);
  return stopAt(at, reason, {
    commands: advice.commands,
    detail: [...detail, advice.reason, ...advice.detail],
  });
}

interface Bumped {
  readonly version: ValidVersion;
  readonly kind: ReleaseKind;
  readonly changes: ChangeEntry[];
}

function repoChangeset(ctx: Ctx, args: string[]): Promise<RunResult> {
  return sh(ctx, 'pnpm', ['exec', 'changeset', ...args], { stdio: 'inherit' });
}

async function stageTwo(ctx: Ctx): Promise<Bumped> {
  const { deps, flags } = ctx;
  const pre = await readPreState(ctx);

  // Refusals that need no change come first, so they leave nothing behind.
  const plan = planPreCommands(pre, flags);
  if (!plan.ok) {
    throw stopAt(2, plan.reason, { section: SECTIONS.everyRelease });
  }
  if (flags.mode === 'pre' && !pre.active) {
    // `changeset pre enter` writes pre.json even when nothing would be released
    const probe = await runStatus(ctx, 'status-probe.json');
    if (probe.kind !== 'release') {
      throw stopAt(
        2,
        'there is no pending changeset to release as a prerelease. Nothing was changed',
        { section: SECTIONS.everyRelease },
      );
    }
  }

  // Before status: with `--exit-pre`, status read in pre mode leaves out the
  // changesets the prereleases consumed and would announce a smaller version.
  for (const command of plan.commands) {
    const result = await repoChangeset(ctx, ['pre', ...command]);
    if (result.code !== 0) {
      throw await stageStop(
        ctx,
        2,
        `changeset pre ${command.join(' ')} failed`,
        tailLines(result),
      );
    }
  }

  const status = await runStatus(ctx, 'status.json');
  if (status.kind === 'failed') {
    throw await stageStop(ctx, 2, 'changeset status failed', [status.error]);
  }
  if (status.kind === 'none') {
    throw await stageStop(
      ctx,
      2,
      'changeset status announces no version: there is no new changeset since the last prerelease',
    );
  }
  const parsed = parseVersion(status.version);
  if (!parsed.ok) {
    throw await stageStop(
      ctx,
      2,
      `changeset status announced an invalid version: ${parsed.reason}`,
    );
  }
  const version = parsed.version;
  const kind: ReleaseKind = parsed.prerelease ? 'prerelease' : 'stable';
  ctx.evidenceDir = await deps.evidence.moveTo(version);

  // Read before `changeset version`, which deletes them. In pre mode they
  // stay until the stable version, which is why the stable section can list
  // every change since the previous stable release.
  const changesets: Extract<ParsedChangeset, { ok: true }>[] = [];
  if (kind === 'stable') {
    for (const entry of await readChangesetEntries(ctx)) {
      if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;
      const changeset = parseChangeset(
        entry.name.slice(0, -'.md'.length),
        entry.text ?? '',
      );
      if (!changeset.ok) {
        throw await stageStop(
          ctx,
          2,
          `.changeset/${entry.name} is not a valid changeset`,
        );
      }
      changesets.push(changeset);
    }
  }

  const versioned = await repoChangeset(ctx, ['version']);
  if (versioned.code !== 0) {
    throw await stageStop(
      ctx,
      2,
      'changeset version failed',
      tailLines(versioned),
    );
  }
  await restoreIgnoredPackages(ctx);

  const packageText = await readText(ctx, PACKAGE_JSON);
  let actual = '';
  try {
    actual = String(
      (JSON.parse(packageText ?? '') as { version?: unknown }).version,
    );
  } catch {
    // an unreadable package.json is reported by the comparison
  }
  const applied = checkVersionApplied({
    expected: version,
    actual,
    preMode: (await readPreState(ctx)).active,
  });
  if (applied.length > 0) {
    throw await stageStop(ctx, 2, 'the version bump is inconsistent', applied);
  }

  if (kind === 'stable') {
    const changelog = (await readText(ctx, CHANGELOG)) ?? '';
    const rendered = renderSection(
      version,
      localDate(deps.clock.now()),
      changesets,
    );
    if (!rendered.ok) throw await stageStop(ctx, 2, rendered.reason);
    const inserted = insertSection(changelog, rendered.section, version);
    if (!inserted.ok) throw await stageStop(ctx, 2, inserted.reason);
    await deps.fs.writeFile(join(deps.cwd, CHANGELOG), inserted.changelog);
  }

  const versionTs = (await readText(ctx, VERSION_TS)) ?? '';
  const synced = syncVersionConstant(versionTs, version);
  if (!synced.ok) throw await stageStop(ctx, 2, synced.reason);
  await deps.fs.writeFile(join(deps.cwd, VERSION_TS), synced.source);

  let changes = await allowedChanges(ctx, kind);
  const formatPaths = changes
    .filter((change) => change.state !== 'D')
    .map((change) => change.path);
  const formatted = await sh(ctx, 'pnpm', ['exec', 'oxfmt', ...formatPaths], {
    stdio: 'inherit',
  });
  if (formatted.code !== 0) throw await stageStop(ctx, 2, 'oxfmt failed');
  // again: formatting must not have widened the set of changed files
  changes = await allowedChanges(ctx, kind);
  return { version, kind, changes };
}

// The work tree changes once the ignored packages are restored; stops when
// any of them is outside the allow list.
async function allowedChanges(
  ctx: Ctx,
  kind: ReleaseKind,
): Promise<ChangeEntry[]> {
  const stdout = await mustGit(
    ctx,
    2,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  const changes = parsePorcelain(stdout);
  const violations = findViolations(changes, kind);
  if (violations.length > 0) {
    throw await stageStop(
      ctx,
      2,
      'the version bump changed files outside the allow list',
      violations,
    );
  }
  return changes;
}

// In pre mode `changeset version` raises the version of ignored packages that
// depend on a released one. The change is undone before anything is judged.
async function restoreIgnoredPackages(ctx: Ctx): Promise<void> {
  const stdout = await mustGit(
    ctx,
    2,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  );
  const plan = planIgnoredRestore(parsePorcelain(stdout));
  if (plan.checkout.length > 0) {
    const result = await git(ctx, 'checkout', '--', ...plan.checkout);
    if (result.code !== 0) {
      throw await stageStop(
        ctx,
        2,
        'could not restore the ignored packages',
        tailLines(result),
      );
    }
  }
  for (const path of plan.remove) {
    const dir =
      IGNORED_PACKAGE_DIRS.find((candidate) =>
        path.startsWith(`${candidate}/`),
      ) ?? '';
    const removed = await removeUntracked(ctx.deps.fs, ctx.deps.cwd, path, dir);
    if (!removed.ok) {
      throw await stageStop(
        ctx,
        2,
        `could not remove an untracked file in an ignored package: ${removed.reason}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// stages 3 to 6
// ---------------------------------------------------------------------------

async function stageThree(
  ctx: Ctx,
  version: ValidVersion,
  makeStop: (reason: string, detail: string[]) => Promise<ReleaseStop>,
): Promise<void> {
  const tags = await observeTags(ctx, version);
  const npm = await observeNpm(ctx);
  const changelog = (await readText(ctx, CHANGELOG)) ?? '';
  if (tags.origin.kind === 'error') {
    throw await makeStop('git ls-remote failed', [tags.origin.error]);
  }
  const reasons = checkPublishable({
    version,
    changelog,
    npm,
    localTag: tags.local,
    originTag: tags.origin.value,
  });
  if (reasons.length > 0) {
    throw await makeStop(`${version} cannot be released`, reasons);
  }
}

async function stageFour(ctx: Ctx, bumped: Bumped): Promise<boolean> {
  const { deps } = ctx;
  deps.output.emit(
    `About to release v${bumped.version} (npm dist-tag: ${distTagFor(bumped.version)})`,
  );
  deps.output.emit('Changed files:');
  for (const change of bumped.changes) {
    deps.output.emit(`  ${change.state} ${change.path}`);
  }
  return deps.prompt(
    `Commit, tag v${bumped.version} and push to origin? [y/N] `,
  );
}

async function stageFive(ctx: Ctx, bumped: Bumped): Promise<void> {
  const { version } = bumped;
  const paths = bumped.changes.map((change) => change.path);
  const added = await git(ctx, 'add', '--', ...paths);
  if (added.code !== 0) {
    throw await stageStop(ctx, 5, 'git add failed', tailLines(added));
  }

  const staged = parseNameStatus(
    await mustGit(
      ctx,
      5,
      'diff',
      '--cached',
      '--name-status',
      '--no-renames',
      '-z',
    ),
  );
  if (staged.kind === 'error') throw await stageStop(ctx, 5, staged.error);
  const stagedMatch = compareChangeSets(staged.value, bumped.changes);
  if (!stagedMatch.same) {
    throw await stageStop(
      ctx,
      5,
      'the staged changes are not exactly the release changes. No commit was made',
      [
        ...stagedMatch.missing.map((item) => `missing: ${item}`),
        ...stagedMatch.extra.map((item) => `extra: ${item}`),
      ],
    );
  }

  // --no-verify: the pre-commit hook regenerates and stages other files, and
  // the release commit must hold the allowed ones only. Formatting was done in
  // stage 2.
  const committed = await git(
    ctx,
    'commit',
    '--no-verify',
    '-m',
    `chore: release v${version}`,
  );
  if (committed.code !== 0) {
    throw await stageStop(ctx, 5, 'git commit failed', tailLines(committed));
  }

  const landed = parseNameStatus(
    await mustGit(
      ctx,
      5,
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      'HEAD',
    ),
  );
  const landedMatch =
    landed.kind === 'ok'
      ? compareChangeSets(landed.value, bumped.changes)
      : undefined;
  if (landedMatch === undefined || !landedMatch.same) {
    throw stopAt(
      5,
      'the release commit does not hold exactly the release changes (a hook may have changed it). No tag was made',
      {
        commands: ['git reset --hard origin/master'],
        detail:
          landedMatch === undefined
            ? []
            : [
                ...landedMatch.missing.map((item) => `missing: ${item}`),
                ...landedMatch.extra.map((item) => `extra: ${item}`),
              ],
      },
    );
  }
  await placeTag(ctx, version);
}

async function placeTag(ctx: Ctx, version: ValidVersion): Promise<void> {
  const tag = `v${version}`;
  const made = await git(
    ctx,
    'tag',
    '-a',
    tag,
    '-m',
    `chore: release v${version}`,
  );
  const head = (await mustGit(ctx, 5, 'rev-parse', 'HEAD')).trim();
  const tagged = (await git(ctx, 'rev-parse', `${tag}^{commit}`)).stdout.trim();
  if (made.code !== 0 || tagged !== head) {
    throw stopAt(5, `could not place ${tag} on the release commit`, {
      commands: [`git tag -d ${tag}`, 'git reset --hard origin/master'],
    });
  }
}

async function stageSix(ctx: Ctx, version: ValidVersion): Promise<number> {
  const tag = `v${version}`;
  // The tag exists locally now, so a stop here is row 5 on the next run.
  await checkGithubProtections(ctx, 6, {
    commands: pushRetryCommands(version),
  });
  const pushed = await git(
    ctx,
    'push',
    '--atomic',
    'origin',
    'refs/heads/master:refs/heads/master',
    `refs/tags/${tag}:refs/tags/${tag}`,
  );
  if (pushed.code !== 0) {
    throw stopAt(6, 'the push was refused or failed. origin did not change', {
      detail: tailLines(pushed),
      commands: pushRetryCommands(version),
    });
  }
  ctx.deps.output.emit(
    `${tag} was pushed. Continue with docs/releasing.md "${SECTIONS.waitForRelease}" and the sections after it.`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// row 6: a release commit whose tag was never placed
// ---------------------------------------------------------------------------

async function resumeFromTag(ctx: Ctx, version: ValidVersion): Promise<number> {
  const undo = ['git reset --hard origin/master'];
  const parent = parseCommitSha(
    await mustGit(ctx, 'entry', 'rev-parse', 'HEAD^'),
  );
  const originMaster = parseCommitSha(
    await mustGit(ctx, 'entry', 'rev-parse', 'origin/master'),
  );
  const headChanges = parseNameStatus(
    await mustGit(
      ctx,
      'entry',
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '-z',
      'HEAD',
    ),
  );
  if (headChanges.kind === 'error') {
    throw stopAt('entry', headChanges.error, { commands: undo });
  }
  let headPackageVersion = '';
  try {
    headPackageVersion = String(
      (
        JSON.parse((await gitShow(ctx, 'HEAD', PACKAGE_JSON)) ?? '') as {
          version?: unknown;
        }
      ).version,
    );
  } catch {
    // an unreadable package.json fails the comparison below
  }
  const pair = async (path: string) => ({
    before: await gitShow(ctx, 'HEAD^', path),
    after: await gitShow(ctx, 'HEAD', path),
  });
  const reasons = checkResume({
    version,
    headMessage: (
      await mustGit(ctx, 'entry', 'log', '-1', '--format=%s')
    ).trim(),
    headParent: parent,
    originMaster,
    headPackageVersion,
    headChanges: headChanges.value,
    packageJson: await pair(PACKAGE_JSON),
    versionTs: await pair(VERSION_TS),
    changelog: await pair(CHANGELOG),
  });
  if (reasons.length > 0) {
    throw stopAt(
      'entry',
      'the release commit is not the one this script would have made, so it is not tagged',
      { detail: reasons, commands: undo },
    );
  }
  await stageOne(ctx, { frontHalf: false });
  await stageThree(ctx, version, (reason, detail) =>
    Promise.resolve(stopAt(3, reason, { detail, commands: undo })),
  );
  await placeTag(ctx, version);
  return stageSix(ctx, version);
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

async function checkRepositoryRoot(ctx: Ctx): Promise<void> {
  const { deps } = ctx;
  const toplevel = await git(ctx, 'rev-parse', '--show-toplevel');
  const gitDir = await git(ctx, 'rev-parse', '--absolute-git-dir');
  if (toplevel.code !== 0 || gitDir.code !== 0) {
    throw stopAt(
      'entry',
      'this is not a git work tree, or git works on a repository other than the one in the current directory (GIT_DIR set?). Nothing was changed',
      {
        section: SECTIONS.everyRelease,
      },
    );
  }
  const dotGitPath = join(deps.cwd, '.git');
  const stat = await deps.fs.lstat(dotGitPath).catch(() => undefined);
  let dotGit: DotGit;
  if (stat === undefined) dotGit = { kind: 'unreadable' };
  else if (stat.isDirectory) dotGit = { kind: 'directory' };
  else if (stat.isFile) {
    dotGit = await deps.fs
      .readFile(dotGitPath)
      .then((content): DotGit => ({ kind: 'file', content }))
      .catch((): DotGit => ({ kind: 'unreadable' }));
  } else dotGit = { kind: 'other' };

  const expected = expectedGitDir(deps.cwd, dotGit);
  if (!expected.ok) {
    throw stopAt('entry', `${expected.reason}. Nothing was changed`, {
      section: SECTIONS.everyRelease,
    });
  }
  // realpath on all of them: /tmp-style symlinks must not read as a mismatch
  const real = (path: string) => deps.fs.realpath(path).catch(() => path);
  const reasons = checkGitDirection({
    realCwd: await real(deps.cwd),
    realToplevel: await real(toplevel.stdout.trim()),
    realExpectedGitDir: await real(expected.path),
    realActualGitDir: await real(gitDir.stdout.trim()),
  });
  if (reasons.length > 0) {
    // GIT_DIR or GIT_WORK_TREE would make the files read and the commits
    // written belong to different repositories
    throw stopAt(
      'entry',
      'git works on a repository other than the one in the current directory (GIT_DIR or GIT_WORK_TREE set?). Nothing was changed',
      {
        detail: reasons,
        section: SECTIONS.everyRelease,
      },
    );
  }
}

async function checkTooling(ctx: Ctx): Promise<void> {
  const npm = await sh(ctx, 'npm', ['--version'], { raw: true });
  const gh = await sh(ctx, 'gh', ['--version'], { raw: true });
  const registry = await sh(ctx, 'npm', ['config', 'get', 'registry'], {
    raw: true,
  });
  const tools = checkTools(npm, gh, registry);
  if (tools.kind !== 'ok')
    throw prereqStop(ctx, 'entry', 'tool versions', tools);
  const origin = checkOrigin(
    await git(ctx, 'remote', 'get-url', 'origin'),
    await git(ctx, 'remote', 'get-url', '--push', 'origin'),
  );
  if (origin.kind !== 'ok') throw prereqStop(ctx, 'entry', 'origin', origin);
}

async function runFront(ctx: Ctx): Promise<number> {
  await stageOne(ctx, { frontHalf: true });
  const bumped = await stageTwo(ctx);
  await stageThree(ctx, bumped.version, (reason, detail) =>
    stageStop(ctx, 3, reason, detail),
  );
  if (!(await stageFour(ctx, bumped))) {
    ctx.deps.output.emit(
      'Declined. Nothing was committed or pushed. To discard the version bump:',
    );
    const advice = adviseOnDirtyTree(await readWorkingTree(ctx, 4));
    for (const command of advice.commands) ctx.deps.output.emit(`  ${command}`);
    return 0;
  }
  await stageFive(ctx, bumped);
  return stageSix(ctx, bumped.version);
}

export async function main(deps: Deps): Promise<number> {
  // before any side effect: a wrong flag or a missing terminal changes nothing
  const flags = parseFlags(deps.argv);
  if (typeof flags === 'string') {
    deps.output.emitError(`release: ${flags}`);
    return 1;
  }
  if (!deps.isTTY.stdin || !deps.isTTY.stdout) {
    deps.output.emitError(
      'release: stdin and stdout must both be a terminal (the 2FA prompts need one). Nothing was changed',
    );
    return 1;
  }
  const ctx: Ctx = { deps, flags, evidenceDir: undefined, saved: new Map() };
  try {
    ctx.evidenceDir = await deps.evidence.open();
    await checkRepositoryRoot(ctx);
    await checkTooling(ctx);
    const fetched = await git(ctx, 'fetch', 'origin');
    if (fetched.code !== 0) {
      throw stopAt('entry', 'git fetch origin failed', {
        detail: tailLines(fetched),
      });
    }

    const observed = await observe(ctx);
    let decision: EntryDecision = decideEntry(observed);
    if (decision.kind === 'need-status') {
      decision = decideEntry(
        observed,
        await runStatus(ctx, 'status-entry.json'),
      );
    }
    const version =
      observed.version.kind === 'ok' ? observed.version.value : undefined;
    switch (decision.kind) {
      case 'stop':
        return report(
          deps,
          {
            at: 'entry',
            row: decision.row,
            reason: decision.reason,
            commands: decision.commands,
            section: decision.section,
            ...(decision.detail === undefined
              ? {}
              : { detail: decision.detail }),
          },
          exitCodeOfRow(decision.row),
        );
      case 'after-push':
      case 'check-only':
        if (version === undefined) return 1;
        return await enterAfterPush(deps, { kind: decision.kind, version });
      case 'resume-tag':
        if (version === undefined) return 1;
        return await resumeFromTag(ctx, version);
      case 'front':
        return await runFront(ctx);
      case 'need-status':
        throw stopAt('entry', 'the entry decision could not be made');
    }
  } catch (error) {
    if (error instanceof ReleaseStop) {
      return report(deps, error.info, error.exitCode);
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = createDeps({
    cwd: process.cwd(),
    argv: process.argv.slice(2),
    env: process.env,
  });
  main(deps).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      deps.output.emitError(
        `release: unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    },
  );
}
