import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterEnv } from './env.ts';

describe('filterEnv', () => {
  it('drops what loads other configuration or code and keeps the rest', () => {
    const { env, removed } = filterEnv({
      GH_HOST: 'evil',
      npm_config_registry: 'x',
      NPM_CONFIG_USERCONFIG: 'y',
      NODE_OPTIONS: '--require=z',
      GH_TOKEN: 't',
      GIT_DIR: '/tmp/g',
      PATH: '/usr/bin',
      HTTPS_PROXY: 'p',
      GH_CONFIG_DIR: '/c',
    });
    assert.deepEqual(removed, [
      'GH_HOST',
      'npm_config_registry',
      'NPM_CONFIG_USERCONFIG',
      'NODE_OPTIONS',
    ]);
    assert.deepEqual(Object.keys(env).sort(), [
      'GH_CONFIG_DIR',
      'GH_TOKEN',
      'GIT_DIR',
      'HTTPS_PROXY',
      'PATH',
    ]);
  });
  it('skips undefined values without listing them', () => {
    assert.deepEqual(filterEnv({ A: undefined }), { env: {}, removed: [] });
  });
});
