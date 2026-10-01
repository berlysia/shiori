export default {
  // --no-error-on-unmatched-pattern: oxfmt exits 2 when every staged file is ignored (e.g. only pnpm-lock.yaml).
  '*.{js,mjs,ts,tsx,jsx,json,jsonc,yaml,yml,md,css,scss,html}': [
    'oxfmt --write --no-error-on-unmatched-pattern',
  ],
};
