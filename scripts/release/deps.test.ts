import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIPE_CAP_BYTES,
  createEvidenceStore,
  createPrompt,
  createRunner,
  type ChildLike,
  type SpawnFn,
  type SpawnOptionsLike,
  type LineReader,
} from './deps.ts';
import { parseVersion, type ValidVersion } from './lib/semver.ts';
import { createOutput } from './output.ts';
import { withTempDir } from './testing/test-workspace.ts';

interface Call {
  cmd: string;
  args: string[];
  options: SpawnOptionsLike;
}

function fakeSpawn(script: (child: FakeChild) => void): {
  spawnFn: SpawnFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const spawnFn: SpawnFn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const child = new FakeChild();
    queueMicrotask(() => script(child));
    return child;
  };
  return { spawnFn, calls };
}

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill(): void {
    this.killed = true;
  }
  end(code: number): void {
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code);
  }
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    output: createOutput({
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
    }),
  };
}

const ENV = {
  PATH: '/usr/bin',
  GH_HOST: 'evil',
  npm_config_registry: 'x',
  'BAD\u001b[31mNAME': 'v',
  NODE_OPTIONS: '--require=z',
  GIT_DIR: '/tmp/g',
};

describe('createRunner', () => {
  it('drops the dangerous variables for pipe and inherit alike and names them once', async () => {
    const { out, output } = capture();
    const { spawnFn, calls } = fakeSpawn((child) => child.end(0));
    const run = createRunner({ spawnFn, output, env: ENV, cwd: '/r' });
    await run('git', ['status'], { stdio: 'pipe' });
    await run('pnpm', ['test'], { stdio: 'inherit' });
    for (const call of calls) {
      assert.equal('GH_HOST' in call.options.env, false);
      assert.equal('npm_config_registry' in call.options.env, false);
      assert.equal('NODE_OPTIONS' in call.options.env, false);
      assert.equal(call.options.env['GIT_DIR'], '/tmp/g');
    }
    assert.equal(out.length, 1);
    assert.match(out[0] ?? '', /GH_HOST, npm_config_registry, NODE_OPTIONS/);
    assert.equal(out.join('').includes('evil'), false);
  });

  it('adds GIT_LITERAL_PATHSPECS to git only', async () => {
    const { output } = capture();
    const { spawnFn, calls } = fakeSpawn((child) => child.end(0));
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    await run('git', ['add', '--', 'x'], { stdio: 'pipe' });
    await run('pnpm', ['x'], { stdio: 'pipe' });
    assert.equal(calls[0]?.options.env['GIT_LITERAL_PATHSPECS'], '1');
    assert.equal(
      'GIT_LITERAL_PATHSPECS' in (calls[1]?.options.env ?? {}),
      false,
    );
  });

  it('pins the registry for npm and the repository for gh, but not for gh api or raw', async () => {
    const { output } = capture();
    const { spawnFn, calls } = fakeSpawn((child) => child.end(0));
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    await run('npm', ['view', 'x'], { stdio: 'pipe' });
    await run('npm', ['--version'], { stdio: 'pipe', raw: true });
    await run('gh', ['run', 'list'], { stdio: 'pipe' });
    await run(
      'gh',
      ['api', '--method', 'GET', 'repos/berlysia/shiori/rulesets'],
      { stdio: 'pipe' },
    );
    assert.deepEqual(calls[0]?.args, [
      'view',
      'x',
      '--registry=https://registry.npmjs.org/',
      '--@berlysia:registry=https://registry.npmjs.org/',
    ]);
    assert.deepEqual(calls[1]?.args, ['--version']);
    assert.deepEqual(calls[2]?.args, [
      'run',
      'list',
      '--repo',
      'berlysia/shiori',
    ]);
    assert.deepEqual(calls[3]?.args, [
      'api',
      '--method',
      'GET',
      'repos/berlysia/shiori/rulesets',
    ]);
  });

  it('returns stdout, the exit code and the stderr tail', async () => {
    const { output } = capture();
    const { spawnFn } = fakeSpawn((child) => {
      child.stdout.write('hello');
      child.stderr.write('warn');
      child.end(3);
    });
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    assert.deepEqual(await run('x', [], { stdio: 'pipe' }), {
      code: 3,
      stdout: 'hello',
      stderrTail: 'warn',
    });
  });

  it('tees stderr to the person for inherit, sanitized, and still returns the tail', async () => {
    const { err, output } = capture();
    const { spawnFn } = fakeSpawn((child) => {
      child.stderr.write('E409 \u001b[31mnot yet');
      child.end(1);
    });
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    const result = await run('npm', [], { stdio: 'inherit' });
    assert.equal(result.stderrTail.includes('E409'), true);
    assert.equal(err.join('').includes('\u001b'), false);
    assert.match(err.join(''), /E409 \[31mnot yet/);
  });

  it('fails instead of returning a partial output above 64 MiB', async () => {
    const { output } = capture();
    let killed: FakeChild | undefined;
    const { spawnFn } = fakeSpawn((child) => {
      killed = child;
      child.stdout.write(Buffer.alloc(PIPE_CAP_BYTES + 1));
    });
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    const result = await run('x', [], { stdio: 'pipe' });
    assert.equal(result.code, null);
    assert.equal(result.stdout, '');
    assert.equal(killed?.killed, true);
  });

  it('reports a spawn error as a failure', async () => {
    const { output } = capture();
    const { spawnFn } = fakeSpawn((child) =>
      child.emit('error', new Error('ENOENT')),
    );
    const run = createRunner({ spawnFn, output, env: {}, cwd: '/r' });
    const result = await run('x', [], { stdio: 'pipe' });
    assert.equal(result.code, null);
    assert.match(result.stderrTail, /ENOENT/);
  });
});

describe('createPrompt', () => {
  function reader(answer: string | undefined): () => LineReader {
    return () => {
      const emitter = new EventEmitter();
      return {
        question: (_q, callback) => {
          if (answer === undefined) queueMicrotask(() => emitter.emit('close'));
          else callback(answer);
        },
        close: () => emitter.emit('close'),
        on: (event, listener) => emitter.on(event, listener),
      };
    };
  }
  for (const [answer, expected] of [
    ['y', true],
    ['Y', true],
    ['yes', false],
    [' y', false],
    ['', false],
    ['n', false],
    [undefined, false],
  ] as const) {
    it(`${JSON.stringify(answer)} -> ${expected}`, async () => {
      assert.equal(await createPrompt(reader(answer))('?'), expected);
    });
  }
});

describe('createEvidenceStore', () => {
  const parsed = parseVersion('0.3.1');
  const version: ValidVersion = parsed.ok
    ? parsed.version
    : ('' as ValidVersion);
  const mode = (path: string) => statSync(path).mode & 0o777;

  it('creates private directories and files, moves under the version, never overwrites', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, '.tmp', 'release');
      const store = createEvidenceStore({
        root,
        now: () => new Date('2026-11-01T01:02:03.456Z'),
      });
      const pending = await store.open();
      assert.equal(mode(root), 0o700);
      assert.equal(mode(pending), 0o700);
      const file = await store.save('status.json', '{}');
      assert.equal(mode(file), 0o600);
      await assert.rejects(store.save('status.json', 'again'));
      await assert.rejects(store.save('../escape', 'x'));
      await assert.rejects(store.save('..', 'x'));
      const moved = await store.moveTo(version);
      assert.equal(moved.includes('/v0.3.1/'), true);
      assert.equal(mode(join(root, 'v0.3.1')), 0o700);
      assert.equal(mode(moved), 0o700);
      const later = await store.save('after.txt', 'x');
      assert.equal(later.startsWith(moved), true);
    });
  });

  it('refuses a release root that is a symlink', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, '.tmp'));
      mkdirSync(join(dir, 'elsewhere'));
      symlinkSync(join(dir, 'elsewhere'), join(dir, '.tmp', 'release'));
      const store = createEvidenceStore({
        root: join(dir, '.tmp', 'release'),
        now: () => new Date(),
      });
      await assert.rejects(store.open());
    });
  });
});
