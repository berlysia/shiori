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
