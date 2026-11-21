// Registry of structural math commands (nodes with slots) and of the
// tables that drive fast typing: palette entries, auto-replacements and the
// greek leader key. These are plain data so they can later be extended from
// user config (snippets, custom commands).

import { cmd, sym, type MNode } from '../model';

export type CmdDef = {
  slots: number;
  /** Build LaTeX given the already-rendered slot strings. */
  latex: (s: string[], cols?: number, tall?: boolean) => string;
  /** Left/right walk through slots in order (otherwise left/right exits). */
  linear?: boolean;
  /** Vertical slot navigation: slot -> slot. */
  up?: Record<number, number>;
  down?: Record<number, number>;
  /** Script nodes attach to whatever precedes them. */
  script?: boolean;
  /** Paired delimiter: typing the closer inside exits the node. */
  close?: string;
  /** Slot contents are literal text rather than math. */
  text?: boolean;
  /** Grid of slots (matrices, cases...). */
  grid?: boolean;
};

const sep = (d: string) => (/\\[a-zA-Z]+$/.test(d) ? d + ' ' : d);
const delim = (l: string, r: string, close: string): CmdDef => ({
  slots: 1,
  // Only stretch when the contents are taller than a line, so `f(x)` keeps tight spacing.
  latex: ([a], _c, tall) => (tall ? `\\left${l}${a}\\right${r}` : `${sep(l)}${a}${sep(r)}`),
  close,
});
const wrap1 = (c: string): CmdDef => ({ slots: 1, latex: ([a]) => `${c}{${a}}` });
const env = (name: string): CmdDef => ({
  slots: 0,
  grid: true,
  linear: true,
  latex: (s, cols = 1) => {
    const rows: string[] = [];
    for (let i = 0; i < s.length; i += cols) rows.push(s.slice(i, i + cols).join(' & '));
    return `\\begin{${name}}${rows.join(' \\\\ ')}\\end{${name}}`;
  },
});

export const CMDS: Record<string, CmdDef> = {
  frac: { slots: 2, latex: ([a, b]) => `\\frac{${a}}{${b}}`, down: { 0: 1 }, up: { 1: 0 } },
  dfrac: { slots: 2, latex: ([a, b]) => `\\dfrac{${a}}{${b}}`, down: { 0: 1 }, up: { 1: 0 } },
  binom: { slots: 2, latex: ([a, b]) => `\\binom{${a}}{${b}}`, down: { 0: 1 }, up: { 1: 0 } },
  sqrt: wrap1('\\sqrt'),
  root: { slots: 2, latex: ([n, a]) => `\\sqrt[${n}]{${a}}`, linear: true },
  sup: { slots: 1, latex: ([a]) => `^{${a}}`, script: true },
  sub: { slots: 1, latex: ([a]) => `_{${a}}`, script: true },
  subsup: { slots: 2, latex: ([a, b]) => `_{${a}}^{${b}}`, script: true, up: { 0: 1 }, down: { 1: 0 } },
  paren: delim('(', ')', ')'),
  bracket: delim('[', ']', ']'),
  brace: delim('\\{', '\\}', '}'),
  abs: delim('|', '|', '|'),
  norm: delim('\\|', '\\|', ''),
  angle: delim('\\langle', '\\rangle', ''),
  floor: delim('\\lfloor', '\\rfloor', ''),
  ceil: delim('\\lceil', '\\rceil', ''),
  hat: wrap1('\\hat'),
  widehat: wrap1('\\widehat'),
  bar: wrap1('\\overline'),
  underline: wrap1('\\underline'),
  vec: wrap1('\\vec'),
  tilde: wrap1('\\widetilde'),
  dot: wrap1('\\dot'),
  ddot: wrap1('\\ddot'),
  mathbb: wrap1('\\mathbb'),
  mathcal: wrap1('\\mathcal'),
  mathfrak: wrap1('\\mathfrak'),
  mathbf: wrap1('\\mathbf'),
  mathrm: wrap1('\\mathrm'),
  boxed: wrap1('\\boxed'),
  cancel: wrap1('\\cancel'),
  operatorname: wrap1('\\operatorname'),
  text: { slots: 1, latex: ([a]) => `\\text{${a}}`, text: true },
  overset: { slots: 2, latex: ([t, b]) => `\\overset{${t}}{${b}}`, down: { 0: 1 }, up: { 1: 0 } },
  underset: { slots: 2, latex: ([b, t]) => `\\underset{${b}}{${t}}`, up: { 1: 0 }, down: { 0: 1 } },
  overbrace: { slots: 2, latex: ([a, l]) => `\\overbrace{${a}}^{${l}}`, up: { 0: 1 }, down: { 1: 0 } },
  underbrace: { slots: 2, latex: ([a, l]) => `\\underbrace{${a}}_{${l}}`, down: { 0: 1 }, up: { 1: 0 } },
  pmatrix: env('pmatrix'),
  bmatrix: env('bmatrix'),
  vmatrix: env('vmatrix'),
  matrix: env('matrix'),
  cases: env('cases'),
  aligned: env('aligned'),
};

/** Big operators: their limits must stay attached, so they are anchored together with their scripts. */
export const BIG_OPS = new Set(
  '\\sum \\prod \\coprod \\int \\iint \\iiint \\oint \\lim \\limsup \\liminf \\max \\min \\sup \\inf \\bigcup \\bigcap \\bigoplus \\bigotimes \\bigvee \\bigwedge \\det \\gcd \\Pr \\argmax \\argmin'.split(
    ' ',
  ),
);

export type Inserter = { node: () => MNode; enter?: number } | { nodes: () => MNode[]; enterLast?: number };

const s = (v: string): Inserter => ({ node: () => sym(v) });
const c = (name: string, enter = 0): Inserter => ({ node: () => cmd(name, Array.from({ length: CMDS[name].slots }, () => [])), enter });
const grid = (name: string, rows: number, cols: number): Inserter => ({
  node: () => cmd(name, Array.from({ length: rows * cols }, () => []), cols),
  enter: 0,
});
const withScript = (v: string, script: 'sub' | 'subsup'): Inserter => ({
  nodes: () => [sym(v), cmd(script, script === 'sub' ? [[]] : [[], []])],
  enterLast: 0,
});

/** Palette entries for `\` inside math. Unknown names fall back to a raw `\name`. */
export const MATH_PALETTE: Record<string, Inserter> = {
  frac: c('frac'),
  dfrac: c('dfrac'),
  binom: c('binom'),
  sqrt: c('sqrt'),
  root: c('root'),
  hat: c('hat'),
  widehat: c('widehat'),
  bar: c('bar'),
  overline: c('bar'),
  underline: c('underline'),
  vec: c('vec'),
  tilde: c('tilde'),
  dot: c('dot'),
  ddot: c('ddot'),
  bb: c('mathbb'),
  mathbb: c('mathbb'),
  cal: c('mathcal'),
  mathcal: c('mathcal'),
  frak: c('mathfrak'),
  bf: c('mathbf'),
  rm: c('mathrm'),
  op: c('operatorname'),
  text: c('text'),
  boxed: c('boxed'),
  cancel: c('cancel'),
  abs: c('abs'),
  norm: c('norm'),
  angle: c('angle'),
  floor: c('floor'),
  ceil: c('ceil'),
  overset: c('overset'),
  underset: c('underset', 1),
  overbrace: c('overbrace'),
  underbrace: c('underbrace'),
  pmatrix: grid('pmatrix', 2, 2),
  bmatrix: grid('bmatrix', 2, 2),
  vmatrix: grid('vmatrix', 2, 2),
  matrix: grid('matrix', 2, 2),
  cases: grid('cases', 2, 2),
  aligned: grid('aligned', 2, 2),
  sum: withScript('\\sum', 'subsup'),
  prod: withScript('\\prod', 'subsup'),
  int: withScript('\\int', 'subsup'),
  oint: withScript('\\oint', 'subsup'),
  lim: withScript('\\lim', 'sub'),
  bigcup: withScript('\\bigcup', 'subsup'),
  bigcap: withScript('\\bigcap', 'subsup'),
  R: { node: () => cmd('mathbb', [[sym('R')]]) },
  N: { node: () => cmd('mathbb', [[sym('N')]]) },
  Z: { node: () => cmd('mathbb', [[sym('Z')]]) },
  Q: { node: () => cmd('mathbb', [[sym('Q')]]) },
  C: { node: () => cmd('mathbb', [[sym('C')]]) },
  inf: s('\\infty'),
  infty: s('\\infty'),
  to: s('\\to'),
  mapsto: s('\\mapsto'),
  implies: s('\\implies'),
  iff: s('\\iff'),
  in: s('\\in'),
  notin: s('\\notin'),
  subset: s('\\subset'),
  subseteq: s('\\subseteq'),
  supset: s('\\supset'),
  cup: s('\\cup'),
  cap: s('\\cap'),
  setminus: s('\\setminus'),
  empty: s('\\emptyset'),
  forall: s('\\forall'),
  exists: s('\\exists'),
  neg: s('\\neg'),
  land: s('\\land'),
  lor: s('\\lor'),
  partial: s('\\partial'),
  nabla: s('\\nabla'),
  cdot: s('\\cdot'),
  times: s('\\times'),
  div: s('\\div'),
  pm: s('\\pm'),
  mp: s('\\mp'),
  le: s('\\le'),
  ge: s('\\ge'),
  ne: s('\\ne'),
  approx: s('\\approx'),
  equiv: s('\\equiv'),
  sim: s('\\sim'),
  cong: s('\\cong'),
  propto: s('\\propto'),
  circ: s('\\circ'),
  otimes: s('\\otimes'),
  oplus: s('\\oplus'),
  dots: s('\\dots'),
  cdots: s('\\cdots'),
  vdots: s('\\vdots'),
  ddots: s('\\ddots'),
  quad: s('\\quad'),
  qquad: s('\\qquad'),
  ell: s('\\ell'),
  hbar: s('\\hbar'),
  langle: s('\\langle'),
  rangle: s('\\rangle'),
  mid: s('\\mid'),
  perp: s('\\perp'),
  parallel: s('\\parallel'),
  angle_: s('\\angle'),
  deg: s('\\deg'),
};
for (const g of 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' '))
  MATH_PALETTE[g] = s('\\' + g);

/**
 * Auto-replacements applied while typing in math, matched against the
 * trailing typed characters. Longest match wins, so `theta` beats `eta`.
 */
export const AUTO_REPLACE: Record<string, string> = {
  '->': '\\to',
  '-->': '\\longrightarrow',
  '<-': '\\leftarrow',
  '|->': '\\mapsto',
  '=>': '\\implies',
  '<=>': '\\iff',
  '<=': '\\le',
  '>=': '\\ge',
  '!=': '\\ne',
  '~~': '\\approx',
  '~=': '\\cong',
  '+-': '\\pm',
  '-+': '\\mp',
  '**': '\\cdot',
  xx: '\\times',
  oo: '\\infty',
  '...': '\\dots',
  AA: '\\forall',
  EE: '\\exists',
  del: '\\partial',
  grad: '\\nabla',
};
for (const f of 'sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh log ln exp det dim ker deg arg gcd'.split(' '))
  AUTO_REPLACE[f] = '\\' + f;
for (const g of 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda sigma upsilon phi chi psi omega rho tau Gamma Delta Theta Lambda Sigma Phi Psi Omega'.split(' '))
  AUTO_REPLACE[g] = '\\' + g;

/** Auto-replacements that produce structure (big operators with limits). */
export const AUTO_STRUCT: Record<string, Inserter> = {
  sum: MATH_PALETTE.sum,
  prod: MATH_PALETTE.prod,
  int: MATH_PALETTE.int,
  lim: MATH_PALETTE.lim,
  RR: MATH_PALETTE.R,
  NN: MATH_PALETTE.N,
  ZZ: MATH_PALETTE.Z,
  QQ: MATH_PALETTE.Q,
  CC: MATH_PALETTE.C,
};

/** `;` + letter → greek (cdlatex-style). */
export const GREEK_LEADER: Record<string, string> = {
  a: 'alpha', b: 'beta', g: 'gamma', d: 'delta', e: 'varepsilon', z: 'zeta', h: 'eta', q: 'theta',
  i: 'iota', k: 'kappa', l: 'lambda', m: 'mu', n: 'nu', x: 'xi', p: 'pi', r: 'rho', s: 'sigma',
  t: 'tau', u: 'upsilon', f: 'varphi', c: 'chi', y: 'psi', w: 'omega', o: 'omega',
  G: 'Gamma', D: 'Delta', Q: 'Theta', L: 'Lambda', X: 'Xi', P: 'Pi', S: 'Sigma', F: 'Phi', Y: 'Psi', W: 'Omega',
};

/** Opening characters that create a delimiter node. */
export const OPENERS: Record<string, string> = { '(': 'paren', '[': 'bracket', '{': 'brace' };
