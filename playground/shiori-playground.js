function E(n) {
  let r = {},
    s = [],
    i = n.trim();
  if (i.length === 0) return { ref: '', errors: s };
  let a = i.search(/\s/),
    d = a === -1 ? i : i.slice(0, a),
    f = '',
    o = i;
  d.includes('=') || ((f = d), (o = a === -1 ? '' : i.slice(a).trim()));
  let e = 0;
  for (; e < o.length; ) {
    for (; e < o.length && o[e] === ' '; ) e++;
    if (e >= o.length) break;
    let p = o.indexOf('=', e);
    if (p === -1) {
      let u = o.slice(e).trim();
      u && s.push(`unexpected bare token '${u}'`);
      break;
    }
    let c = o.slice(e, p);
    if (c === '') {
      for (
        s.push("missing key before '='"), e = p + 1;
        e < o.length && o[e] !== ' ';
      )
        e++;
      continue;
    }
    if (c === 'ref') {
      if (
        (s.push("'ref' is not a valid key; use positional syntax"),
        (e = p + 1),
        e < o.length && (o[e] === '"' || o[e] === "'"))
      ) {
        let u = o[e];
        e++;
        let g = o.indexOf(u, e);
        if (g === -1) break;
        e = g + 1;
      } else for (; e < o.length && o[e] !== ' '; ) e++;
      continue;
    }
    if (((e = p + 1), e < o.length && (o[e] === '"' || o[e] === "'"))) {
      let u = o[e];
      e++;
      let g = o.indexOf(u, e);
      if (g === -1) {
        (s.push(`unterminated quote for key '${c}'`), (r[c] = o.slice(e)));
        break;
      }
      ((r[c] = o.slice(e, g)), (e = g + 1));
    } else {
      let u = e;
      for (; e < o.length && o[e] !== ' '; ) e++;
      let g = o.slice(u, e);
      (g === '' && s.push(`empty value for key '${c}'`), (r[c] = g));
    }
  }
  return { ...r, ref: f, errors: s };
}
var P = {
    c: { line: ['//'], block: [{ open: '/*', close: '*/' }] },
    hash: { line: ['#'] },
    dashdash: { line: ['--'], block: [{ open: '/*', close: '*/' }] },
    html: { block: [{ open: '<!--', close: '-->' }] },
    lua: { line: ['--'], block: [{ open: '--[[', close: ']]' }] },
  },
  O = {
    '.js': 'c',
    '.ts': 'c',
    '.tsx': 'c',
    '.jsx': 'c',
    '.css': 'c',
    '.scss': 'c',
    '.pcss': 'c',
    '.less': 'c',
    '.java': 'c',
    '.go': 'c',
    '.rs': 'c',
    '.swift': 'c',
    '.kt': 'c',
    '.c': 'c',
    '.cpp': 'c',
    '.h': 'c',
    '.cs': 'c',
    '.php': 'c',
    '.py': 'hash',
    '.rb': 'hash',
    '.sh': 'hash',
    '.bash': 'hash',
    '.zsh': 'hash',
    '.fish': 'hash',
    '.yaml': 'hash',
    '.yml': 'hash',
    '.toml': 'hash',
    '.r': 'hash',
    '.pl': 'hash',
    '.pm': 'hash',
    '.ex': 'hash',
    '.exs': 'hash',
    '.sql': 'dashdash',
    '.lua': 'lua',
    '.html': 'html',
    '.xml': 'html',
    '.svg': 'html',
    '.vue': 'c',
  },
  M = 'c';
function T(n) {
  let r = n.lastIndexOf('.'),
    s = r > 0 ? n.slice(r) : '',
    i = O[s] ?? M;
  return P[i] ?? P[M];
}
var j = {
    eslint: {
      'disable-next-line': {
        pattern: '\\beslint-disable-next-line\\s+(.*)',
        rules: 'csv',
        separator: '--',
      },
      'disable-line': {
        pattern: '\\beslint-disable-line\\s+(.*)',
        rules: 'csv',
        separator: '--',
      },
    },
    stylelint: {
      'disable-next-line': {
        pattern: '\\bstylelint-disable-next-line\\s+([\\s\\S]+)',
        rules: 'csv',
        separator: '--',
      },
      'disable-line': {
        pattern: '\\bstylelint-disable-line\\s+([\\s\\S]+)',
        rules: 'csv',
        separator: '--',
      },
    },
    typescript: {
      'ts-ignore': { pattern: '@ts-ignore\\b(.*)' },
      'ts-expect-error': { pattern: '@ts-expect-error\\b(.*)' },
    },
    keywords: {
      todo: { pattern: '^TODO\\b:?\\s*(.*)', text: !0 },
      fixme: { pattern: '^FIXME\\b:?\\s*(.*)', text: !0 },
      hack: { pattern: '^HACK\\b:?\\s*(.*)', text: !0 },
      xxx: { pattern: '^XXX\\b:?\\s*(.*)', text: !0 },
    },
  },
  D = { eslint: !0, stylelint: !0, keywords: !1 };
function V(n) {
  let r = {};
  for (let [s, i] of Object.entries(n)) {
    if (i === void 0) continue;
    let a = j[s] ?? {};
    if (typeof i == 'boolean') {
      let d = { ...a };
      r[s] = Object.entries(d).map(([f, o]) => F(f, o, i));
    } else {
      let d = i._matchers ?? {},
        f = { ...a, ...d },
        o = [];
      for (let [e, p] of Object.entries(f)) {
        if (e === '_matchers') continue;
        let c = i[e],
          u;
        (typeof c == 'boolean' ? (u = c) : e in a ? (u = !0) : (u = !1),
          o.push(F(e, p, u)));
      }
      r[s] = o;
    }
  }
  return { entries: r };
}
function F(n, r, s) {
  return {
    name: n,
    enabled: s,
    pattern: new RegExp(r.pattern),
    rules: r.rules ?? null,
    separator: r.separator ?? null,
    captureText: r.text ?? !1,
  };
}
function R(n) {
  return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
var $ = /\bshiori:\s*/,
  L = /\bshiori:ignore\b/,
  N = V(D);
function B(n, r) {
  let s = [];
  if (r.block)
    for (let i of r.block) {
      let a = R(i.open),
        d = R(i.close),
        f = new RegExp(a + '[\\s\\S]*?' + d, 'g'),
        o = i.open.length,
        e = i.close.length;
      for (let p of n.matchAll(f)) {
        let c = n.slice(0, p.index).split(`
`).length,
          u = p[0].slice(o, -e);
        (i.open === '/*'
          ? (u = u
              .split(
                `
`,
              )
              .map((g) => g.replace(/^\s*\*\s?/, ''))
              .join(' ')
              .trim())
          : (u = u
              .split(
                `
`,
              )
              .map((g) => g.trim())
              .join(' ')
              .trim()),
          s.push({ text: u, line: c }));
      }
    }
  if (r.line) {
    let i = (r.block ?? []).map((f) => f.open),
      a = r.line.map((f) => {
        let o = R(f),
          e = i
            .filter((c) => c.startsWith(f) && c !== f)
            .map((c) => `(?!${R(c.slice(f.length))})`),
          p = e.length > 0 ? o + e.join('') + '.*' : o + '.*';
        return { prefix: f, regex: new RegExp(p) };
      }),
      d = n.split(`
`);
    for (let f = 0; f < d.length; f++) {
      let o = d[f];
      for (let { prefix: e, regex: p } of a) {
        let c = o.match(p);
        if (c) {
          let u = c[0].slice(e.length).trim();
          s.push({ text: u, line: f + 1 });
          break;
        }
      }
    }
  }
  return s;
}
function Y(n) {
  let r = n
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return r.length > 1 ? r : n.split(/\s+/).filter(Boolean);
}
function H(n, r) {
  let s, i;
  if (r.separator != null) {
    let c = n.indexOf(r.separator);
    c >= 0
      ? ((s = n.slice(0, c)), (i = n.slice(c + r.separator.length)))
      : ((s = n), (i = ''));
  } else ((s = ''), (i = n));
  let a = s.replace(/\s*\*\/\s*$/, '').trim(),
    d;
  if (
    (r.rules === 'csv'
      ? (d = a ? Y(a) : [])
      : r.rules === 'single'
        ? (d = a ? [a] : [])
        : (d = []),
    i.match(L))
  )
    return {
      rules: d,
      shioriFieldsStr: void 0,
      isIgnored: !0,
      capturedText: void 0,
    };
  let o = i.match($),
    e = o ? i.slice(o.index + o[0].length).trim() : void 0,
    p = (r.captureText && n.trim()) || void 0;
  return { rules: d, shioriFieldsStr: e, isIgnored: !1, capturedText: p };
}
var I = class {
  name = 'CommentProvider';
  scan(r, s) {
    let i = [],
      a = [],
      d = s?.candidatePatterns ?? N,
      f = T(r.path),
      o = B(r.content, f);
    for (let e of o) {
      let { text: p, line: c } = e,
        u = !1;
      for (let [S, v] of Object.entries(d.entries)) {
        if (u) break;
        for (let y of v) {
          let t = p.match(y.pattern);
          if (!t) continue;
          u = !0;
          let l = (t[1] ?? '').trim(),
            m = H(l, y);
          if (m.isIgnored) {
            let h = (x) => {
              i.push({
                ref: '',
                rule: x,
                tagged: !0,
                ignored: !0,
                location: { file: r.path, line: c },
              });
            };
            if (m.rules.length === 0) h(void 0);
            else for (let x of m.rules) h(x);
          } else if (m.shioriFieldsStr !== void 0) {
            let h = E(m.shioriFieldsStr),
              x = h.errors.length > 0 ? h.errors : void 0;
            if (m.rules.length === 0)
              i.push({
                ref: h.ref,
                rule: void 0,
                expires: h.expires,
                reason: h.reason,
                tagged: !0,
                ignored: !1,
                syntaxErrors: x,
                location: { file: r.path, line: c },
              });
            else
              for (let C of m.rules)
                i.push({
                  ref: h.ref,
                  rule: C,
                  expires: h.expires,
                  reason: h.reason,
                  tagged: !0,
                  ignored: !1,
                  syntaxErrors: x,
                  location: { file: r.path, line: c },
                });
          } else if (y.enabled) {
            let h = y.name !== 'default' ? y.name : void 0;
            if (m.rules.length === 0)
              a.push({
                pattern: S,
                directive: h,
                text: m.capturedText,
                location: { file: r.path, line: c },
              });
            else
              for (let x of m.rules)
                a.push({
                  pattern: S,
                  directive: h,
                  rule: x,
                  text: m.capturedText,
                  location: { file: r.path, line: c },
                });
          }
          break;
        }
      }
      if (u) continue;
      let g = p.match($);
      if (g) {
        let S = p.search(L);
        if (S >= 0 && S !== g.index) {
          i.push({
            ref: '',
            rule: void 0,
            tagged: !0,
            ignored: !0,
            location: { file: r.path, line: c },
          });
          continue;
        }
        let v = p.slice(g.index + g[0].length).trim(),
          y = E(v),
          t = y.errors.length > 0 ? y.errors : void 0;
        i.push({
          ref: y.ref,
          rule: void 0,
          expires: y.expires,
          reason: y.reason,
          tagged: !0,
          ignored: !1,
          syntaxErrors: t,
          location: { file: r.path, line: c },
        });
        continue;
      }
    }
    return { annotations: i, candidates: a };
  }
};
var w = [
  'missing-in-registry',
  'unused-in-source',
  'expired',
  'syntax-error',
  'ref-format',
  'ref-collision',
  'unrouted-ref',
  'registry-routing-mismatch',
  'expiring-soon',
  'ref-status-closed',
];
var _ = /^[A-Z][A-Z0-9]*(?:[-:][A-Za-z0-9][-A-Za-z0-9._]*)*$/;
function k(n) {
  return _.test(n);
}
function K(n) {
  let r = '{id}',
    s = n.indexOf(r);
  if (s === -1) return new RegExp(`^${R(n)}$`);
  let i = n.slice(0, s),
    a = n.slice(s + r.length);
  return new RegExp(`^${R(i)}(.+)${R(a)}$`);
}
function A(n, r) {
  if (!(!r || r.length === 0 || n === ''))
    for (let s of r) {
      let a = K(s.match).exec(n);
      if (a) {
        let d = a[1] ?? n;
        return { config: s, captures: { id: d } };
      }
    }
}
function b(n, r, s) {
  return r.includes(n) ? 'error' : (s.includes(n), 'warning');
}
function X(n) {
  let r = Object.fromEntries(w.map((a) => [a, 0])),
    s = 0,
    i = 0;
  for (let a of n) (r[a.type]++, a.severity === 'error' ? s++ : i++);
  return { total: n.length, errors: s, warnings: i, byType: r };
}
function U(n) {
  return n.length === 7 ? n + '-99' : n;
}
function q(n) {
  let { records: r, registry: s, failOn: i, warnOn: a, duplicates: d } = n,
    f = n.now ?? new Date(),
    o = f.toISOString().slice(0, 10),
    e = [],
    p = new Set();
  for (let t of r) t.ref !== '' && !t.ignored && p.add(t.ref);
  for (let t of r)
    t.ignored ||
      (t.tagged &&
        t.syntaxErrors &&
        t.syntaxErrors.length > 0 &&
        e.push({
          type: 'syntax-error',
          severity: b('syntax-error', i, a),
          ref: t.ref,
          message: `Syntax error: ${t.syntaxErrors.join('; ')}`,
          file: t.location.file,
          line: t.location.line,
        }));
  let c = new Set();
  for (let t of r)
    t.ref === '' ||
      t.ignored ||
      c.has(t.ref) ||
      k(t.ref) ||
      (c.add(t.ref),
      e.push({
        type: 'ref-format',
        severity: b('ref-format', i, a),
        ref: t.ref,
        message: `Invalid ref format "${t.ref}": expected uppercase prefix with alphanumeric segments (e.g. SUP-1234, ADR:0007)`,
        file: t.location.file,
        line: t.location.line,
      }));
  if (n.refPatterns && n.refPatterns.length > 0) {
    let t = new Set();
    for (let l of r)
      l.ref === '' ||
        l.ignored ||
        t.has(l.ref) ||
        A(l.ref, n.refPatterns) ||
        (t.add(l.ref),
        e.push({
          type: 'unrouted-ref',
          severity: b('unrouted-ref', i, a),
          ref: l.ref,
          message: `Ref "${l.ref}" does not match any configured refPatterns`,
          file: l.location.file,
          line: l.location.line,
        }));
  }
  let u = new Set();
  for (let t of r)
    t.ref === '' ||
      t.ignored ||
      u.has(t.ref) ||
      t.ref in s ||
      (u.add(t.ref),
      e.push({
        type: 'missing-in-registry',
        severity: b('missing-in-registry', i, a),
        ref: t.ref,
        message: `ID "${t.ref}" found in source but not in registry`,
        file: t.location.file,
        line: t.location.line,
      }));
  for (let t of Object.keys(s))
    p.has(t) ||
      e.push({
        type: 'unused-in-source',
        severity: b('unused-in-source', i, a),
        ref: t,
        message: `ID "${t}" exists in registry but not found in source`,
        file: void 0,
        line: void 0,
      });
  let g = new Set();
  for (let [t, l] of Object.entries(s))
    l.expires &&
      U(l.expires) < o &&
      (g.add(t),
      e.push({
        type: 'expired',
        severity: b('expired', i, a),
        ref: t,
        message: `ID "${t}" expired on ${l.expires}`,
        file: void 0,
        line: void 0,
      }));
  let S = n.expiringThresholdDays ?? 14,
    v = new Date(f);
  v.setDate(v.getDate() + S);
  let y = v.toISOString().slice(0, 10);
  for (let [t, l] of Object.entries(s)) {
    if (!l.expires || g.has(t)) continue;
    U(l.expires) <= y &&
      e.push({
        type: 'expiring-soon',
        severity: b('expiring-soon', i, a),
        ref: t,
        message: `ID "${t}" expires on ${l.expires} (within ${S} days)`,
        file: void 0,
        line: void 0,
      });
  }
  if (d && d.length > 0)
    for (let t of d)
      e.push({
        type: 'ref-collision',
        severity: b('ref-collision', i, a),
        ref: t.ref,
        message: `Ref "${t.ref}" defined in both ${t.defaultFile} and ${t.patternFile} (pattern file takes precedence)`,
        file: void 0,
        line: void 0,
      });
  if (n.refOrigins && n.refPatterns && n.refPatterns.length > 0)
    for (let t of Object.keys(s)) {
      let l = A(t, n.refPatterns);
      if (!l) continue;
      let m = l.config.registryFile ?? null,
        h = n.refOrigins.get(t) ?? null;
      if (m !== h) {
        let x = h ?? 'default registry',
          C = m ?? 'default registry';
        e.push({
          type: 'registry-routing-mismatch',
          severity: b('registry-routing-mismatch', i, a),
          ref: t,
          message: `Ref "${t}" is in ${x} but pattern "${l.config.match}" routes to ${C}`,
          file: void 0,
          line: void 0,
        });
      }
    }
  if (n.refStatuses) {
    let t = new Set();
    for (let l of r) {
      if (l.ref === '' || l.ignored || t.has(l.ref)) continue;
      n.refStatuses.get(l.ref) === 'closed' &&
        (t.add(l.ref),
        e.push({
          type: 'ref-status-closed',
          severity: b('ref-status-closed', i, a),
          ref: l.ref,
          message: `Ref "${l.ref}" references a closed issue/ticket \u2014 annotation may be removable`,
          file: l.location.file,
          line: l.location.line,
        }));
    }
  }
  return {
    timestamp: f.toISOString(),
    issues: e,
    summary: X(e),
    scannedRecords: r.length,
    registryEntries: Object.keys(s).length,
  };
}
export {
  P as COMMENT_SYNTAXES,
  I as CommentProvider,
  O as EXTENSION_MAP,
  _ as REF_PATTERN,
  w as VERIFY_ISSUE_TYPES,
  T as getCommentSyntax,
  k as isValidRef,
  E as parseShioriFields,
  q as verify,
};
//# sourceMappingURL=shiori-playground.js.map
