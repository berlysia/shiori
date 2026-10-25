// The environment a child process gets. Variables that make npm, gh or node
// load other configuration or code are dropped; the ones git, gh and proxies
// legitimately need are kept (a developer's ssh setup, a corporate proxy).
const DROPPED_EXACT = new Set([
  'GH_HOST',
  'GH_REPO',
  'GH_ENTERPRISE_TOKEN',
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
]);

export interface FilteredEnv {
  readonly env: Record<string, string>;
  readonly removed: string[];
}

export function filterEnv(
  source: Readonly<Record<string, string | undefined>>,
): FilteredEnv {
  const env: Record<string, string> = {};
  const removed: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      DROPPED_EXACT.has(name) ||
      name.toLowerCase().startsWith('npm_config_')
    ) {
      removed.push(name);
    } else {
      env[name] = value;
    }
  }
  return { env, removed };
}
