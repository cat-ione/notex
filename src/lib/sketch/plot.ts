// Graphs of functions in a diagram: a box whose label says what to plot, one thing a line —
//
//   y = sin x
//   x^2/4 - 1
//   x: -2pi..2pi        (the x range; y: … the y range, else it fits the curves)
//
// — read here into functions of x (no eval: a small parser, as notes come from anywhere) and
// laid out as paths, axes, ticks and a legend in the box's own coordinates.

import type { Box } from './shapes';

/** A function of x, or why it isn't one. */
export type Fn = { src: string; f: ((x: number) => number) | null; err?: string };
export type PlotSpec = { fns: Fn[]; xr: [number, number]; yr: [number, number] | null; piTicks: boolean };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, log: Math.log10, lg: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sgn: Math.sign, sign: Math.sign, min: Math.min, max: Math.max,
};
const CONSTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI, 'τ': 2 * Math.PI };

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

/** LaTeX's ways of writing what this reads, as it reads them: \frac{a}{b}, \sqrt{x}, \cdot, \sin… */
function unlatex(s: string): string {
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))').replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
  }
  return s
    .replace(/\\left|\\right|\\,|\\;|\\!/g, '')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{[]/g, '(')
    .replace(/[}\]]/g, ')')
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*');
}

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  const s = unlatex(src);
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num && /[\d.]/.test(c)) {
      // (an `e` after a number that isn't an exponent is the constant: 2e is 2·e)
      const m = num[2] && /^e[+-]?\d/i.test(s.slice(i + num[1].length)) ? num[0] : num[1];
      out.push({ t: 'num', v: parseFloat(m) });
      i += m.length;
      continue;
    }
    const id = /^(arcsin|arccos|arctan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|floor|ceil|round|log2|sign|sin|cos|tan|sec|csc|cot|exp|abs|sgn|min|max|tau|ln|log|lg|pi|[a-zA-Zπτ])/.exec(s.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[1] });
      i += id[1].length;
      continue;
    }
    if ('+-*/^(),|'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '²' || c === '³') {
      out.push({ t: 'op', v: '^' }, { t: 'num', v: c === '²' ? 2 : 3 });
      i++;
      continue;
    }
    throw new Error(`what's “${c}”?`);
  }
  return out;
}

type Node = (x: number) => number;

/** An expression in x as a function, or an error saying what's wrong with it. */
export function compile(src: string): Node {
  const ts = tokens(src);
  let i = 0;
  const peek = () => ts[i];
  const isOp = (v: string) => ts[i]?.t === 'op' && ts[i].v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`a “${v}” missing`);
    i++;
  };
  const isFunc = (t: Tok | undefined) => t?.t === 'id' && t.v in FUNCS;
  /** Can this token start a factor (for a product written without ·: 2x, x(x+1), 2 sin x)? */
  const startsFactor = (t: Tok | undefined) => !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && (t.v === '(' || t.v === '|')));

  // sum := product (± product)*
  function sum(): Node {
    let a = product(false);
    while (isOp('+') || isOp('-')) {
      const op = ts[i++].v, l = a, r = product(false);
      a = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return a;
  }
  // product := unary (( * | / | nothing ) unary)*; as a function's argument without brackets, it
  // stops at the next function (sin x cos x is sin(x)·cos(x))
  function product(arg: boolean): Node {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = ts[i++].v, l = a, r = unary();
        a = op === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
      } else if (startsFactor(peek()) && !(arg && isFunc(peek())) && !(isOp('|') && inAbs > 0)) {
        const l = a, r = unary();
        a = (x) => l(x) * r(x);
      } else return a;
    }
  }
  // unary := -unary | power (so -x^2 is -(x^2))
  function unary(): Node {
    if (isOp('-')) {
      i++;
      const a = unary();
      return (x) => -a(x);
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    return power();
  }
  // power := atom (^ unary)?  (to the right: 2^3^2 is 2^9)
  function power(): Node {
    const a = atom();
    if (isOp('^')) {
      i++;
      const b = unary();
      return (x) => Math.pow(a(x), b(x));
    }
    return a;
  }
  let inAbs = 0;
  function atom(): Node {
    const t = ts[i];
    if (!t) throw new Error('it ends too soon');
    if (t.t === 'num') {
      i++;
      const v = t.v;
      return () => v;
    }
    if (t.t === 'op' && t.v === '(') {
      i++;
      const a = sum();
      expect(')');
      return a;
    }
    if (t.t === 'op' && t.v === '|') {
      i++;
      inAbs++;
      const a = sum();
      inAbs--;
      expect('|');
      return (x) => Math.abs(a(x));
    }
    if (t.t === 'id') {
      i++;
      if (t.v in FUNCS) {
        const f = FUNCS[t.v];
        // sin^2 x: the function's result squared
        let pow: Node | null = null;
        if (isOp('^')) {
          i++;
          pow = atom();
        }
        let args: Node[];
        if (isOp('(')) {
          i++;
          args = [sum()];
          while (isOp(',')) i++, args.push(sum());
          expect(')');
        } else args = [product(true)];
        const call: Node = args.length === 1 ? (x) => f(args[0](x)) : (x) => f(...args.map((a) => a(x)));
        return pow ? (x) => Math.pow(call(x), pow!(x)) : call;
      }
      if (t.v === 'x') return (x) => x;
      if (t.v in CONSTS) {
        const v = CONSTS[t.v];
        return () => v;
      }
      throw new Error(`what's “${t.v}”? (plot in x)`);
    }
    throw new Error(`a “${t.v}” out of place`);
  }
  const f = sum();
  if (i < ts.length) throw new Error(`a “${(ts[i] as { v: unknown }).v}” out of place`);
  return f;
}

/** A number as written in a range: 2, -1.5, pi, 2pi, pi/2, -3π/4. */
function rangeNum(s: string): number {
  const v = compile(s)(0);
  if (!Number.isFinite(v)) throw new Error(`“${s}” isn't a number`);
  return v;
}

/** A graph's label read: its functions (with their errors), its x range, its y range if set. */
export function parsePlot(src: string): PlotSpec {
  const fns: Fn[] = [];
  let xr: [number, number] = [-5, 5], yr: [number, number] | null = null, piTicks = false;
  for (const raw of src.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const range = /^([xy])\s*(?::|∈|in\b|=)\s*\[?\s*(.+?)\s*(?:\.\.|…|,|\bto\b)\s*(.+?)\s*\]?$/.exec(line);
    if (range && !/x/.test(range[2] + range[3])) {
      try {
        const a = rangeNum(range[2]), b = rangeNum(range[3]);
        if (a !== b) {
          const r: [number, number] = [Math.min(a, b), Math.max(a, b)];
          if (range[1] === 'x') (xr = r), (piTicks = /pi|π/.test(line));
          else yr = r;
        }
      } catch {}
      continue;
    }
    // y = …, f(x) = …, or just the expression
    const expr = line.replace(/^\s*(?:y|[a-zA-Z]\s*\(\s*x\s*\))\s*=\s*/, '');
    try {
      fns.push({ src: expr, f: compile(expr) });
    } catch (e) {
      fns.push({ src: expr, f: null, err: (e as Error).message });
    }
  }
  return { fns, xr, yr, piTicks };
}

/** Ticks at a round step (1, 2 or 5 times a power of ten; with π, multiples of π/2 or π…) across a range. */
export function ticks(a: number, b: number, want: number, pi = false): { v: number; label: string }[] {
  const span = b - a;
  if (!(span > 0)) return [];
  if (pi) {
    const steps = [Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI];
    const step = steps.find((s) => span / s <= want) ?? steps[steps.length - 1];
    const out: { v: number; label: string }[] = [];
    for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) out.push({ v: k * step, label: piLabel(k * step) });
    return out;
  }
  const raw = span / want, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: { v: number; label: string }[] = [];
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) {
    const v = k * step;
    out.push({ v, label: (Math.abs(v) < step / 2 ? 0 : v).toFixed(digits).replace('-', '−') });
  }
  return out;
}

/** A multiple of π as written: π/2, π, 3π/2, −π. */
function piLabel(v: number): string {
  const q = Math.round((v / Math.PI) * 4);
  if (q === 0) return '0';
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(Math.abs(q), 4), n = q / d, den = 4 / d;
  const num = Math.abs(n) === 1 ? 'π' : `${Math.abs(n)}π`;
  return `${n < 0 ? '−' : ''}${num}${den === 1 ? '' : `/${den}`}`;
}

export type PlotGeom = {
  /** Each function's curve (a path in box coordinates), in its order. */
  curves: { d: string; i: number }[];
  /** The axes (where 0 is, else the edge), and the box's frame. */
  axes: { x1: number; y1: number; x2: number; y2: number }[];
  grid: { x1: number; y1: number; x2: number; y2: number }[];
  xticks: { x: number; y: number; label: string }[];
  yticks: { x: number; y: number; label: string }[];
  /** What's wrong with a line that isn't a function. */
  errors: string[];
  /** The plotting area (inside the box, leaving room for tick labels). */
  area: Box;
  /** Data to box: where (x, y) goes. */
  at: (x: number, y: number) => { x: number; y: number };
};

/** A graph laid out in box `b`: its curves sampled (broken where they jump off or aren't defined). */
export function plotGeometry(spec: PlotSpec, b: Box, samples = Math.max(120, Math.round(b.w * 1.5))): PlotGeom {
  const pad = { l: 6, r: 6, t: 6, b: 6 };
  const area: Box = { x: b.x + pad.l, y: b.y + pad.t, w: Math.max(10, b.w - pad.l - pad.r), h: Math.max(10, b.h - pad.t - pad.b) };
  const [x0, x1] = spec.xr;
  const fs = spec.fns.filter((f) => f.f);
  // the values, then the y range: as set, or what the curves cover (not their far reaches near
  // an asymptote: the middle 96% of what they reach), with a little room
  const vals = fs.map((fn) => Array.from({ length: samples + 1 }, (_, k) => {
    const x = x0 + ((x1 - x0) * k) / samples;
    const y = fn.f!(x);
    return Number.isFinite(y) ? y : NaN;
  }));
  let yr = spec.yr;
  if (!yr) {
    const all = vals.flat().filter((v) => !Number.isNaN(v)).sort((p, q) => p - q);
    if (!all.length) yr = [-1, 1];
    else {
      const lo = all[Math.floor(all.length * 0.02)], hi = all[Math.min(all.length - 1, Math.ceil(all.length * 0.98) - 1)];
      const span = hi - lo || Math.max(1, Math.abs(lo));
      yr = [lo - span * 0.08, hi + span * 0.08];
      // (a range near 0 includes it: the x axis shows)
      if (yr[0] > 0 && yr[0] < span * 0.5) yr[0] = 0;
      if (yr[1] < 0 && -yr[1] < span * 0.5) yr[1] = 0;
    }
  }
  const [y0, y1] = yr;
  const at = (x: number, y: number) => ({ x: area.x + ((x - x0) / (x1 - x0)) * area.w, y: area.y + area.h - ((y - y0) / (y1 - y0)) * area.h });
  const curves = fs.map((fn, i) => {
    let d = '', pen = false;
    const ys = vals[i];
    for (let k = 0; k <= samples; k++) {
      const x = x0 + ((x1 - x0) * k) / samples, y = ys[k];
      // off where it isn't defined, or jumps across the range (an asymptote), or is far off the box
      const jump = k > 0 && !Number.isNaN(ys[k - 1]) && Math.abs(y - ys[k - 1]) > (y1 - y0) * 0.9 && Math.sign(y - (y0 + y1) / 2) !== Math.sign(ys[k - 1] - (y0 + y1) / 2);
      if (Number.isNaN(y) || jump) {
        pen = false;
        if (Number.isNaN(y)) continue;
      }
      const c = Math.max(y0 - (y1 - y0) * 2, Math.min(y1 + (y1 - y0) * 2, y));
      const p = at(x, c);
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      pen = true;
    }
    return { d, i: spec.fns.indexOf(fn) };
  });
  // the axes where 0 is (else along the edge)
  const ax = y0 <= 0 && y1 >= 0 ? at(x0, 0).y : area.y + area.h;
  const ay = x0 <= 0 && x1 >= 0 ? at(0, y0).x : area.x;
  const axes = [
    { x1: area.x, y1: ax, x2: area.x + area.w, y2: ax },
    { x1: ay, y1: area.y, x2: ay, y2: area.y + area.h },
  ];
  const tx = ticks(x0, x1, Math.max(2, Math.round(area.w / 70)), spec.piTicks), ty = ticks(y0, y1, Math.max(2, Math.round(area.h / 45)));
  const grid = [
    ...tx.map((t) => ({ x1: at(t.v, 0).x, y1: area.y, x2: at(t.v, 0).x, y2: area.y + area.h })),
    ...ty.map((t) => ({ x1: area.x, y1: at(0, t.v).y, x2: area.x + area.w, y2: at(0, t.v).y })),
  ];
  // tick labels by the axes (not at 0, where the axes cross)
  const xticks = tx.filter((t) => Math.abs(t.v) > 1e-9 || ay === area.x).map((t) => ({ x: at(t.v, 0).x, y: Math.min(area.y + area.h - 2, ax + 12), label: t.label }));
  const yticks = ty.filter((t) => Math.abs(t.v) > 1e-9 || ax === area.y + area.h).map((t) => ({ x: Math.max(area.x + 2, ay - 4), y: at(0, t.v).y + 4, label: t.label }));
  return { curves, axes, grid, xticks, yticks, errors: spec.fns.filter((f) => f.err).map((f) => `${f.src}: ${f.err}`), area, at };
}
