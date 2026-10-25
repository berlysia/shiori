// Judges the repository configuration, the tool versions, and the npm and
// GitHub protections that the safety of a staged publish depends on. Each
// function takes the text a command printed and decides; the caller stops on
// anything but `ok` (fail closed), so an unexpected shape is never a pass.
import { compareVersions, parseVersion } from './semver.ts';
import type { RunResult } from './types.ts';

export type PrereqResult =
  | { readonly kind: 'ok' }
  // not JSON, or not the shape expected
  | { readonly kind: 'shape-unknown'; readonly detail: string }
  // the shape is right and the content is not; which fields differ
  | { readonly kind: 'mismatch'; readonly fields: readonly string[] }
  | { readonly kind: 'command-failed'; readonly detail: string }
  // only for trust: the 2FA grace period ran out
  | { readonly kind: 'eotp' };

const OK: PrereqResult = { kind: 'ok' };
const shape = (detail: string): PrereqResult => ({
  kind: 'shape-unknown',
  detail,
});
const mismatch = (...fields: string[]): PrereqResult => ({
  kind: 'mismatch',
  fields,
});

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// ---------------------------------------------------------------------------
// trust
// ---------------------------------------------------------------------------

const TRUST_STRING_FIELDS = [
  'id',
  'type',
  'file',
  'repository',
  'environment',
] as const;

function mentionsEotp(result: RunResult): boolean {
  if (result.stderrTail.includes('EOTP')) return true;
  const parsed = parseJson(result.stdout);
  if (!parsed.ok || !isRecord(parsed.value)) return false;
  const error = parsed.value['error'];
  return isRecord(error) && error['code'] === 'EOTP';
}

export function checkTrust(result: RunResult): PrereqResult {
  // 1 first: an expired grace period must never read as a pass, whatever else
  // the output says
  if (mentionsEotp(result)) return { kind: 'eotp' };
  if (result.code !== 0) {
    return {
      kind: 'command-failed',
      detail: `npm trust list exited with ${result.code}`,
    };
  }
  const parsed = parseJson(result.stdout);
  if (!parsed.ok) return shape('npm trust list --json did not print JSON');
  // npm prints one entry as an object and several as an array
  const entries: unknown[] = Array.isArray(parsed.value)
    ? parsed.value
    : [parsed.value];
  for (const entry of entries) {
    if (!isRecord(entry)) return shape('a trust entry is not an object');
    for (const field of TRUST_STRING_FIELDS) {
      if (typeof entry[field] !== 'string')
        return shape(`trust entry field "${field}" is not a string`);
    }
    if (!isStringArray(entry['permissions'])) {
      return shape('trust entry field "permissions" is not a list of strings');
    }
  }
  const fields: string[] = [];
  if (entries.length !== 1)
    fields.push(`entries: expected 1, found ${entries.length}`);
  const entry = entries[0];
  if (entries.length === 1 && isRecord(entry)) {
    const expected: [string, string][] = [
      ['type', 'github'],
      ['file', 'release.yml'],
      ['repository', 'berlysia/shiori'],
      ['environment', 'npm'],
    ];
    for (const [field, value] of expected) {
      if (entry[field] !== value) fields.push(`${field}: expected ${value}`);
    }
    if (
      !sameStrings(entry['permissions'] as string[], ['createStagedPackage'])
    ) {
      fields.push('permissions: expected exactly createStagedPackage');
    }
  }
  return fields.length === 0 ? OK : mismatch(...fields);
}

// ---------------------------------------------------------------------------
// GitHub: environment and tag ruleset
// ---------------------------------------------------------------------------

export function checkEnvironment(
  environment: RunResult,
  policies: RunResult,
): PrereqResult {
  for (const result of [environment, policies]) {
    if (result.code !== 0) {
      return {
        kind: 'command-failed',
        detail: `gh api exited with ${result.code}`,
      };
    }
  }
  const env = parseJson(environment.stdout);
  const pol = parseJson(policies.stdout);
  if (!env.ok || !pol.ok) return shape('gh api did not print JSON');
  if (!isRecord(env.value)) return shape('the environment is not an object');
  if (!isRecord(pol.value) || !Array.isArray(pol.value['branch_policies'])) {
    return shape('"branch_policies" is not a list');
  }
  const fields: string[] = [];
  const branchPolicy = env.value['deployment_branch_policy'];
  if (
    !isRecord(branchPolicy) ||
    branchPolicy['custom_branch_policies'] !== true ||
    branchPolicy['protected_branches'] !== false
  ) {
    fields.push(
      'deployment_branch_policy: expected custom_branch_policies true and protected_branches false',
    );
  }
  const list = pol.value['branch_policies'] as unknown[];
  const only = list[0];
  if (
    list.length !== 1 ||
    !isRecord(only) ||
    only['name'] !== 'v*' ||
    only['type'] !== 'tag'
  ) {
    fields.push(
      'deployment branch policies: expected exactly one, { name: "v*", type: "tag" }',
    );
  }
  return fields.length === 0 ? OK : mismatch(...fields);
}

export function parseRulesetIds(
  list: RunResult,
):
  | { readonly kind: 'ok'; readonly ids: number[] }
  | Exclude<PrereqResult, { kind: 'ok' | 'eotp' | 'mismatch' }> {
  if (list.code !== 0) {
    return {
      kind: 'command-failed',
      detail: `gh api exited with ${list.code}`,
    };
  }
  const parsed = parseJson(list.stdout);
  if (!parsed.ok)
    return { kind: 'shape-unknown', detail: 'the ruleset list is not JSON' };
  if (!Array.isArray(parsed.value)) {
    return { kind: 'shape-unknown', detail: 'the ruleset list is not a list' };
  }
  const ids: number[] = [];
  for (const item of parsed.value as unknown[]) {
    if (!isRecord(item) || !Number.isSafeInteger(item['id'])) {
      return {
        kind: 'shape-unknown',
        detail: 'a ruleset in the list has no integer id',
      };
    }
    ids.push(item['id'] as number);
  }
  return { kind: 'ok', ids };
}

function isReleaseTagRuleset(detail: unknown): boolean {
  if (!isRecord(detail)) return false;
  if (detail['target'] !== 'tag' || detail['enforcement'] !== 'active')
    return false;
  const conditions = detail['conditions'];
  const refName = isRecord(conditions) ? conditions['ref_name'] : undefined;
  if (!isRecord(refName)) return false;
  const include = refName['include'];
  const exclude = refName['exclude'];
  if (!isStringArray(include) || !include.includes('refs/tags/v*'))
    return false;
  if (!Array.isArray(exclude) || exclude.length !== 0) return false;
  const rules = detail['rules'];
  if (!Array.isArray(rules)) return false;
  const types = rules.map((rule) =>
    isRecord(rule) ? rule['type'] : undefined,
  );
  if (
    !['creation', 'update', 'deletion'].every((type) => types.includes(type))
  ) {
    return false;
  }
  const bypass = detail['bypass_actors'];
  if (!Array.isArray(bypass) || bypass.length !== 1) return false;
  const actor = bypass[0];
  return (
    isRecord(actor) &&
    actor['actor_id'] === 5 &&
    actor['actor_type'] === 'RepositoryRole' &&
    actor['bypass_mode'] === 'always'
  );
}

export function checkRulesets(details: readonly RunResult[]): PrereqResult {
  const parsed: unknown[] = [];
  for (const result of details) {
    if (result.code !== 0) {
      return {
        kind: 'command-failed',
        detail: `gh api exited with ${result.code}`,
      };
    }
  }
  for (const result of details) {
    const json = parseJson(result.stdout);
    if (!json.ok) return shape('a ruleset detail is not JSON');
    parsed.push(json.value);
  }
  return parsed.some(isReleaseTagRuleset)
    ? OK
    : mismatch(
        'rulesets: none is an active tag ruleset on refs/tags/v* (no exclude) that restricts creation, update and deletion and lets only the admin role bypass, always',
      );
}

// ---------------------------------------------------------------------------
// config, origin, tools
// ---------------------------------------------------------------------------

const EXPECTED_CONFIG: Record<string, unknown> = {
  changelog: false,
  commit: false,
  access: 'public',
  baseBranch: 'master',
  ignore: ['@berlysia/shiori-daemon', '@berlysia/shiori-vscode'],
  updateInternalDependencies: 'patch',
};

// "$schema" is documentation for editors and runs no code.
export function checkChangesetConfig(text: string): PrereqResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return shape('.changeset/config.json is not JSON');
  if (!isRecord(parsed.value))
    return shape('.changeset/config.json is not an object');
  const { $schema: _schema, ...rest } = parsed.value;
  const fields: string[] = [];
  for (const key of new Set([
    ...Object.keys(rest),
    ...Object.keys(EXPECTED_CONFIG),
  ])) {
    if (JSON.stringify(rest[key]) !== JSON.stringify(EXPECTED_CONFIG[key])) {
      fields.push(key);
    }
  }
  return fields.length === 0 ? OK : mismatch(...fields);
}

const ORIGIN_URL =
  /^(https:\/\/github\.com\/|git@github\.com:)berlysia\/shiori(\.git)?$/;

export function checkOrigin(
  fetchUrl: RunResult,
  pushUrl: RunResult,
): PrereqResult {
  for (const result of [fetchUrl, pushUrl]) {
    if (result.code !== 0) {
      return {
        kind: 'command-failed',
        detail: `git remote get-url exited with ${result.code}`,
      };
    }
  }
  const fields: string[] = [];
  if (!ORIGIN_URL.test(fetchUrl.stdout.trim())) fields.push('origin fetch URL');
  if (!ORIGIN_URL.test(pushUrl.stdout.trim())) fields.push('origin push URL');
  return fields.length === 0 ? OK : mismatch(...fields);
}

export const NPM_MIN = '12.2.0';
export const NPM_BELOW = '13.0.0';
export const GH_MIN = '2.45.0';
export const REGISTRY = 'https://registry.npmjs.org/';

export function checkTools(
  npmVersion: RunResult,
  ghVersion: RunResult,
  registry: RunResult,
): PrereqResult {
  for (const [name, result] of [
    ['npm --version', npmVersion],
    ['gh --version', ghVersion],
    ['npm config get registry', registry],
  ] as const) {
    if (result.code !== 0) {
      return {
        kind: 'command-failed',
        detail: `${name} exited with ${result.code}`,
      };
    }
  }
  const npm = parseVersion(npmVersion.stdout.trim());
  const gh = /^gh version (\S+)/.exec(ghVersion.stdout.trim());
  const ghParsed = gh?.[1] === undefined ? undefined : parseVersion(gh[1]);
  if (!npm.ok) return shape('npm --version is not a version');
  if (ghParsed === undefined || !ghParsed.ok)
    return shape('gh --version is not "gh version X.Y.Z"');
  const fields: string[] = [];
  if (
    compareVersions(npm.version, NPM_MIN) < 0 ||
    compareVersions(npm.version, NPM_BELOW) >= 0
  ) {
    fields.push(`npm: expected >= ${NPM_MIN} and < ${NPM_BELOW}`);
  }
  if (compareVersions(ghParsed.version, GH_MIN) < 0) {
    fields.push(`gh: expected >= ${GH_MIN}`);
  }
  if (registry.stdout.trim() !== REGISTRY)
    fields.push(`npm registry: expected ${REGISTRY}`);
  return fields.length === 0 ? OK : mismatch(...fields);
}
