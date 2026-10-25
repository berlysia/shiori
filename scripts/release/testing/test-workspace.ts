// Temporary directories for tests that touch the file system. Test support
// only: nothing under lib/ may import this file.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceStore, nodeFs } from '../deps.ts';
import { createOutput } from '../output.ts';
import { main } from '../release.ts';

export const TEMP_DIR_PREFIX = 'shiori-release-fx-';

// A removal is only as safe as the path it is given, so the path is checked
// right before `rm -r`: it must sit directly in the OS temp directory and
// carry this helper's prefix. Anything else is left alone and fails the test.
export async function assertRemovableTempDir(path: string): Promise<string> {
  const real = await realpath(path);
  const root = await realpath(tmpdir());
  if (dirname(real) !== root || !basename(real).startsWith(TEMP_DIR_PREFIX)) {
    throw new Error(
      `refusing to remove a directory that is not a fixture: ${real}`,
    );
  }
  return real;
}

export async function withTempDir<T>(
  run: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
  try {
    return await run(dir);
  } finally {
    // finally: an assertion failure or a timeout must not leak the directory
    await rm(await assertRemovableTempDir(dir), {
      recursive: true,
      force: true,
    });
  }
}

// ---------------------------------------------------------------------------
// A small pnpm workspace to run the real `changeset` binary against: one
// published package, plus two packages listed in `ignore` (one of them depends
// on the published one, like the VS Code extension depends on the CLI).
// ---------------------------------------------------------------------------

const CHANGESET_BIN = fileURLToPath(
  new URL('../../../node_modules/.bin/changeset', import.meta.url),
);
const TIMEOUT_MS = 60_000;

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ChangesetFixture {
  // the git work tree; HOME and the git config live beside it, not in it
  readonly repo: string;
  // the complete environment of every child process
  readonly env: Readonly<Record<string, string>>;
  git(...args: string[]): CommandResult;
  changeset(...args: string[]): CommandResult;
  write(path: string, text: string): void;
  readJson(path: string): Record<string, unknown>;
  // names of the *.md files in .changeset/ other than README.md
  changesetFiles(): string[];
  commitAll(message: string): void;
  // `changeset status --output` parsed, for the given arguments
  status(): { result: CommandResult; json: StatusJson | undefined };
}

export interface StatusJson {
  readonly changesets: { readonly id: string }[];
  readonly releases: {
    readonly name: string;
    readonly type: string;
    readonly oldVersion: string;
    readonly newVersion: string;
    readonly changesets?: unknown;
  }[];
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// The child environment is built from an explicit set. Passing the parent's
// GIT_* or npm_config_* would let a developer's shell point the fixture's git
// at a real repository.
function childEnv(dir: string): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: join(dir, 'home'),
    GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    CI: '1',
  };
}

export async function withChangesetFixture<T>(
  run: (fixture: ChangesetFixture) => T | Promise<T>,
): Promise<T> {
  if (!existsSync(CHANGESET_BIN)) {
    throw new Error(
      `${CHANGESET_BIN} not found: run "pnpm install" so @changesets/cli is available`,
    );
  }
  return withTempDir(async (dir) => {
    const repo = join(dir, 'repo');
    const env = childEnv(dir);
    mkdirSync(join(dir, 'home'));
    writeFileSync(join(dir, 'gitconfig'), '');
    mkdirSync(repo);

    const exec = (command: string, args: string[]): CommandResult => {
      const result = spawnSync(command, args, {
        cwd: repo,
        env,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
      });
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    const git = (...args: string[]) => exec('git', args);
    const mustGit = (...args: string[]) => {
      const result = git(...args);
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
      }
    };
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };

    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    write(
      'package.json',
      `${JSON.stringify({ name: 'fixture-root', private: true }, null, 2)}\n`,
    );
    write('.gitignore', 'node_modules/\n');
    // same shape as the real .changeset/config.json, with the fixture's names
    mkdirSync(join(repo, '.changeset'));
    writeJson(join(repo, '.changeset', 'config.json'), {
      $schema: 'https://unpkg.com/@changesets/config@3.1.2/schema.json',
      changelog: false,
      commit: false,
      access: 'public',
      baseBranch: 'master',
      ignore: ['@fx/daemon', '@fx/vscode'],
      updateInternalDependencies: 'patch',
    });
    write('.changeset/README.md', 'fixture\n');
    for (const [dirName, manifest] of [
      ['cli', { name: '@fx/cli', version: '0.3.0' }],
      ['daemon', { name: '@fx/daemon', version: '0.1.0' }],
      [
        'vscode',
        {
          name: '@fx/vscode',
          version: '0.1.0',
          dependencies: { '@fx/cli': 'workspace:*' },
        },
      ],
    ] as const) {
      write(
        `packages/${dirName}/package.json`,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }
    mustGit('init', '-b', 'master');
    mustGit('config', 'user.name', 'Fixture');
    mustGit('config', 'user.email', 'fixture@example.com');
    mustGit('config', 'commit.gpgsign', 'false');
    mustGit('config', 'tag.gpgsign', 'false');
    mustGit('config', 'core.hooksPath', '/dev/null');

    const fixture: ChangesetFixture = {
      repo,
      env,
      git,
      changeset: (...args) => exec(CHANGESET_BIN, args),
      write,
      readJson: (path) =>
        JSON.parse(readFileSync(join(repo, path), 'utf8')) as Record<
          string,
          unknown
        >,
      changesetFiles: () =>
        readdirSync(join(repo, '.changeset'))
          .filter((name) => name.endsWith('.md') && name !== 'README.md')
          .sort(),
      commitAll: (message) => {
        mustGit('add', '-A');
        mustGit('commit', '-m', message);
      },
      status: () => {
        const output = join(dir, 'status.json');
        // changeset resolves --output against the repo root, so pass a relative path
        const result = exec(CHANGESET_BIN, [
          'status',
          `--output=${relative(repo, output)}`,
        ]);
        const json =
          result.status === 0 && existsSync(output)
            ? (JSON.parse(readFileSync(output, 'utf8')) as StatusJson)
            : undefined;
        return { result, json };
      },
    };
    fixture.commitAll('init');
    return run(fixture);
  });
}

// ---------------------------------------------------------------------------
// A repository shaped like this one, with a bare remote and fake npm, gh and
// pnpm, to run release.ts's main() against. git and the changeset binary are
// real; every other external command is a fake that never leaves the machine.
// ---------------------------------------------------------------------------

const REAL_CONFIG = fileURLToPath(
  new URL('../../../.changeset/config.json', import.meta.url),
);
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const REAL_ORIGIN_URL = 'https://github.com/berlysia/shiori.git';

export interface FakeToolState {
  // versions the fake npm reports as published
  npmVersions: string[];
  npmLatest: string | undefined;
  // `npm trust list ... --json`
  trust: { code: number; stdout: string; stderr: string };
  // overrides for `gh api` paths (after repos/berlysia/shiori/)
  ghOverrides: Record<string, { code: number; stdout: string }>;
  // the URL `git remote get-url` reports for origin
  originUrl: string;
  // `pnpm <args>` that fails, as the joined args
  failQuality: string | undefined;
  // runs when the quality check with these joined args runs
  onQuality: Record<string, () => void>;
  // extra environment for git (to model GIT_DIR in the developer's shell)
  gitEnv: Record<string, string>;
  // replaces the file `changeset status --output` would write (a fake status)
  statusOutput: string | undefined;
  // run when the y/N question is asked, before the answer is given
  onPrompt: (() => void) | undefined;
  // every command the fakes saw, as "cmd arg arg"
  calls: string[];
  answers: string[];
}

export interface ReleaseFixture {
  readonly dir: string;
  readonly repo: string;
  readonly remote: string;
  readonly tools: FakeToolState;
  git(...args: string[]): CommandResult;
  write(path: string, text: string): void;
  read(path: string): string;
  // a changeset file in .changeset/, committed and pushed to origin
  addChangeset(
    name: string,
    bump: string,
    heading: string,
    entry: string,
  ): void;
  // runs main() with a fake Deps; the lines printed and the exit code
  release(
    argv: string[],
    options?: { tty?: boolean; cwd?: string },
  ): Promise<{ code: number; out: string[]; err: string[] }>;
  originHead(): string;
  originTags(): string[];
  // the state that must not change when a run stops early
  snapshot(): string;
}

function readFixtureJson(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export async function withReleaseFixture<T>(
  run: (fixture: ReleaseFixture) => T | Promise<T>,
): Promise<T> {
  return withTempDir(async (dir) => {
    const repo = join(dir, 'repo');
    const remote = join(dir, 'remote.git');
    const baseEnv = childEnv(dir);
    mkdirSync(join(dir, 'home'));
    writeFileSync(join(dir, 'gitconfig'), '');
    mkdirSync(repo);

    const tools: FakeToolState = {
      npmVersions: ['0.3.0'],
      npmLatest: '0.3.0',
      trust: {
        code: 0,
        stdout: readFixtureJson('trust-list.json'),
        stderr: '',
      },
      ghOverrides: {},
      originUrl: REAL_ORIGIN_URL,
      failQuality: undefined,
      onQuality: {},
      gitEnv: {},
      statusOutput: undefined,
      onPrompt: undefined,
      calls: [],
      answers: [],
    };

    const spawnGit = (
      args: string[],
      extraEnv: Record<string, string> = {},
    ): CommandResult => {
      const result = spawnSync('git', args, {
        cwd: repo,
        env: { ...baseEnv, ...extraEnv },
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
      });
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    };
    const git = (...args: string[]) => spawnGit(args);
    const mustGit = (...args: string[]) => {
      const result = git(...args);
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
      }
      return result.stdout;
    };
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };

    const ghPaths: Record<string, string> = {
      'environments/npm': readFixtureJson('gh-environment.json'),
      'environments/npm/deployment-branch-policies': readFixtureJson(
        'gh-environment-policies.json',
      ),
      rulesets: readFixtureJson('gh-rulesets.json'),
      'rulesets/24324650': readFixtureJson('gh-ruleset-detail.json'),
      'rulesets/25818366': JSON.stringify({
        id: 25818366,
        name: 'master',
        target: 'branch',
        enforcement: 'active',
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [],
        bypass_actors: [],
      }),
    };

    // One entry point for every command the release script runs. Not the
    // production runner: git runs for real in the fixture repository, the
    // changeset binary stands in for `pnpm exec changeset`, and the rest is faked.
    const fakeRun = async (cmd: string, args: readonly string[]) => {
      tools.calls.push([cmd, ...args].join(' '));
      const ok = (stdout = '', code = 0, stderrTail = '') => ({
        code,
        stdout,
        stderrTail,
      });
      if (cmd === 'git') {
        if (args[0] === 'remote' && args[1] === 'get-url') {
          return ok(`${tools.originUrl}\n`);
        }
        const result = spawnGit([...args], {
          GIT_LITERAL_PATHSPECS: '1',
          ...tools.gitEnv,
        });
        return {
          code: result.status,
          stdout: result.stdout,
          stderrTail: result.stderr,
        };
      }
      if (cmd === 'pnpm') {
        if (
          args[0] === 'exec' &&
          args[1] === 'changeset' &&
          args[2] === 'status' &&
          tools.statusOutput !== undefined &&
          // only the stage-2 status; the entry and probe reads stay real
          (args[3] ?? '').endsWith('/status.json')
        ) {
          const target = (args[3] ?? '').replace('--output=', '');
          writeFileSync(join(repo, target), tools.statusOutput);
          return ok();
        }
        if (args[0] === 'exec' && args[1] === 'changeset') {
          const result = spawnSync(CHANGESET_BIN, args.slice(2), {
            cwd: repo,
            env: baseEnv,
            encoding: 'utf8',
            timeout: TIMEOUT_MS,
          });
          return {
            code: result.status,
            stdout: result.stdout ?? '',
            stderrTail: result.stderr ?? '',
          };
        }
        if (args[0] === 'exec' && args[1] === 'oxfmt') return ok();
        const key = args.join(' ');
        tools.onQuality[key]?.();
        return key === tools.failQuality ? ok('', 1, `${key} failed`) : ok();
      }
      if (cmd === 'npm') {
        const key = args.join(' ');
        if (key === '--version') return ok('12.2.0\n');
        if (key === 'config get registry')
          return ok('https://registry.npmjs.org/\n');
        if (args[0] === 'view' && args[2] === 'versions') {
          return ok(JSON.stringify(tools.npmVersions));
        }
        if (args[0] === 'view' && args[2] === 'dist-tags') {
          return ok(
            JSON.stringify(
              tools.npmLatest === undefined ? {} : { latest: tools.npmLatest },
            ),
          );
        }
        if (args[0] === 'trust' && args[1] === 'list') {
          return args.includes('--json')
            ? {
                code: tools.trust.code,
                stdout: tools.trust.stdout,
                stderrTail: tools.trust.stderr,
              }
            : ok();
        }
      }
      if (cmd === 'gh') {
        if (args[0] === '--version')
          return ok('gh version 2.102.0 (2026-10-01)\n');
        if (args[0] === 'api') {
          const path = (args[args.length - 1] ?? '').replace(
            'repos/berlysia/shiori/',
            '',
          );
          const override = tools.ghOverrides[path];
          if (override !== undefined) {
            return {
              code: override.code,
              stdout: override.stdout,
              stderrTail: '',
            };
          }
          const body = ghPaths[path];
          if (body !== undefined) return ok(body);
        }
      }
      return ok('', 127, `fake: unexpected command ${cmd} ${args.join(' ')}`);
    };

    // repository
    write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");
    write(
      'package.json',
      `${JSON.stringify({ name: 'fixture-root', private: true }, null, 2)}\n`,
    );
    write('.gitignore', 'node_modules/\n.tmp/\n');
    mkdirSync(join(repo, '.changeset'));
    writeFileSync(
      join(repo, '.changeset', 'config.json'),
      readFileSync(REAL_CONFIG, 'utf8'),
    );
    write('.changeset/README.md', 'fixture\n');
    write(
      'packages/shiori-cli/package.json',
      `${JSON.stringify({ name: '@berlysia/shiori', version: '0.3.0' }, null, 2)}\n`,
    );
    write(
      'packages/shiori-cli/src/core/version.ts',
      "// the VERSION constant\nexport const VERSION = '0.3.0';\n",
    );
    write(
      'packages/shiori-daemon/package.json',
      `${JSON.stringify({ name: '@berlysia/shiori-daemon', version: '0.1.0' }, null, 2)}\n`,
    );
    write(
      'packages/shiori-vscode/package.json',
      `${JSON.stringify(
        {
          name: '@berlysia/shiori-vscode',
          version: '0.1.0',
          dependencies: { '@berlysia/shiori': 'workspace:*' },
        },
        null,
        2,
      )}\n`,
    );
    write(
      'CHANGELOG.md',
      '# Changelog\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-25\n\n### Fixed\n\n- an old fix\n',
    );
    mustGit('init', '-b', 'master');
    mustGit('config', 'user.name', 'Fixture');
    mustGit('config', 'user.email', 'fixture@example.com');
    mustGit('config', 'commit.gpgsign', 'false');
    mustGit('config', 'tag.gpgsign', 'false');
    mustGit('config', 'core.hooksPath', '/dev/null');
    mustGit('add', '-A');
    mustGit('commit', '-m', 'chore: release v0.3.0');
    mustGit('tag', '-a', 'v0.3.0', '-m', 'chore: release v0.3.0');
    spawnSync('git', ['init', '--bare', '-b', 'master', remote], {
      env: baseEnv,
    });
    mustGit('remote', 'add', 'origin', remote);
    mustGit('push', 'origin', 'master', 'v0.3.0');
    mustGit('fetch', 'origin');

    let clockNow = new Date(2026, 10, 1, 12, 0, 0);
    const fixture: ReleaseFixture = {
      dir,
      repo,
      remote,
      tools,
      git,
      write,
      read: (path) => readFileSync(join(repo, path), 'utf8'),
      addChangeset: (name, bump, heading, entry) => {
        write(
          `.changeset/${name}.md`,
          `---\n"@berlysia/shiori": ${bump}\n---\n\n### ${heading}\n\n- ${entry}\n`,
        );
        mustGit('add', '-A');
        mustGit('commit', '-m', `feat: ${name}`);
        mustGit('push', 'origin', 'master');
      },
      release: async (argv, options = {}) => {
        const out: string[] = [];
        const err: string[] = [];
        const output = createOutput({
          stdout: (text) => out.push(text.replace(/\n$/, '')),
          stderr: (text) => err.push(text.replace(/\n$/, '')),
        });
        const answers = tools.answers;
        const deps = {
          run: fakeRun,
          fs: nodeFs,
          clock: { now: () => clockNow, sleep: async () => undefined },
          prompt: async (question: string) => {
            out.push(question);
            tools.onPrompt?.();
            return answers.shift() === 'y';
          },
          output,
          evidence: createEvidenceStore({
            root: join(repo, '.tmp', 'release'),
            now: () => clockNow,
          }),
          isTTY: { stdin: options.tty ?? true, stdout: options.tty ?? true },
          argv,
          cwd: options.cwd ?? repo,
        };
        // each run gets its own time so evidence directories never collide
        clockNow = new Date(clockNow.getTime() + 1000);
        const code = await main(deps);
        return { code, out, err };
      },
      originHead: () =>
        spawnSync(
          'git',
          ['--git-dir', remote, 'rev-parse', 'refs/heads/master'],
          {
            env: baseEnv,
            encoding: 'utf8',
          },
        ).stdout.trim(),
      originTags: () =>
        spawnSync('git', ['--git-dir', remote, 'tag', '--list'], {
          env: baseEnv,
          encoding: 'utf8',
        })
          .stdout.split('\n')
          .filter((line) => line !== '')
          .sort(),
      snapshot: () =>
        [
          mustGit('rev-parse', 'HEAD'),
          mustGit('status', '--porcelain=v1'),
          mustGit('tag', '--list'),
          spawnSync('git', ['--git-dir', remote, 'for-each-ref'], {
            env: baseEnv,
            encoding: 'utf8',
          }).stdout,
        ].join('\n'),
    };
    return run(fixture);
  });
}
