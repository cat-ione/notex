import katex from 'katex';
import { describe, expect, it } from 'vitest';
import type { MRow } from '../model';
import * as M from './edit';
import { toLatex, type MCursor } from './latex';
import { cmd } from '../model';
import { MATH_PALETTE, SUB_GROUPS } from './defs';

const allSubs = Object.fromEntries(SUB_GROUPS.map((g) => [g.id, true]));
// most tests type names (alpha, sum, sqrt…): every substitution group on
M.setSubstitutions(allSubs);

/** Type a string into an empty formula. `‹` = backspace, `←`/`→` = left/right, `␣` = space, `⇥` = tab. */
function typed(keys: string) {
  const root: MRow = [];
  const cur: MCursor = { path: [], off: 0 };
  for (const k of keys) {
    if (k === '‹') M.backspace(root, cur);
    else if (k === '→') M.moveRight(root, cur);
    else if (k === '←') M.moveLeft(root, cur);
    else if (k === '␣') M.space(root, cur);
    else if (k === '⇥') M.nextSlot(root, cur);
    else M.typeChar(root, cur, k);
  }
  return { root, cur, tex: toLatex(root).replace(/\s+/g, ' ').trim() };
}

describe('typing math', () => {
  it.each([
    ['x^2', 'x^{2}'],
    ['x^2␣+1', 'x^{2}+1'],
    ['x_1^2', 'x_{1}^{2}'],
    ['x^2_1', 'x_{1}^{2}'],
    ['a/b', '\\frac{a}{b}'],
    ['12/b', '\\frac{12}{b}'],
    ['x+a/b', 'x+\\frac{a}{b}'],
    ['(a+b)/c', '\\frac{a+b}{c}'],
    ['x^2/2', '\\frac{x^{2}}{2}'],
    ['/', '\\frac{}{}'],
    ['f(x)', 'f(x)'],
    ['(a/b)', '\\left(\\frac{a}{b}\\right)'],
    ['alpha', '\\alpha'],
    ['theta', '\\theta'],
    ['beta', '\\beta'],
    ['epsilon', '\\epsilon'],
    ['sinh', '\\sinh'],
    ['arcsin', '\\arcsin'],
    ['a->b', 'a\\to b'],
    ['<=>', '\\iff'],
    ['x<=y', 'x\\le y'],
    ['oo', '\\infty'],
    ['"if x"', '\\text{if x}'],
  ])('%s → %s', (keys, tex) => {
    expect(typed(keys).tex).toBe(tex);
  });

  it('sum opens limits and tab moves between them (scripts that stay open)', () => {
    M.setLatexScripts(false);
    try {
      expect(typed('sumi=1⇥n').tex).toBe('\\sum _{i=1}^{n}');
      expect(typed('x^2+1').tex).toBe('x^{2+1}');
    } finally {
      M.setLatexScripts(true);
    }
  });

  it('closing paren leaves the delimiter', () => {
    expect(typed('(a)b').tex).toBe('(a)b');
  });
});

describe('LaTeX-style scripts', () => {
  it.each([
    // one thing, then back on the line
    ['x^2+1', 'x^{2}+1'],
    ['x^10y', 'x^{10}y'],
    ['x^ab', 'x^{a}b'],
    ['e^-x', 'e^{-x}'],
    ['x_1^2', 'x_{1}^{2}'],
    ['a_0^2/2', '\\frac{a_{0}^{2}}{2}'],
    ['x^alpha+1', 'x^{\\alpha }+1'],
    ['x^infty', 'x^{\\infty }'],
    // a group in brackets that don't show
    ['e^(-x^2/2)', 'e^{-\\frac{x^{2}}{2}}'],
    ['x^{n+1}', 'x^{n+1}'],
    ['f(x^2)', 'f\\left(x^{2}\\right)'],
    // big operators: limits as you'd write them in LaTeX
    ['int_0^(2pi)', '\\int _{0}^{2\\pi }'],
    ['sum_(n=1)^oo a_n', '\\sum _{n=1}^{\\infty }a_{n}'],
    ['lim_(x->0)', '\\lim _{x\\to 0}'],
    ['int f', '\\int f'],
    // or filled in as boxes: space goes from the lower limit to the upper one, then on
    ['int0 1 f', '\\int _{0}^{1}f'],
    ['int0^1 f', '\\int _{0}^{1}f'],
    ['sumn=1 oo a_n', '\\sum _{n=1}^{\\infty }a_{n}'],
    ['limx->0 f', '\\lim _{x\\to 0}f'],
    ['prodk=1 n k', '\\prod _{k=1}^{n}k'],
    // a longer name goes on past the boxes: intop, sumop are bare; liminf, limsup
    ['intop_0^1 f', '\\int _{0}^{1}f'],
    ['sumop a', '\\sum a'],
    ['limop_n', '\\lim _{n}'],
    ['liminf a_n', '\\liminf a_{n}'],
    ['int x', '\\int x'],
    // spaces inside brackets don't leave them
    ['(a + b)/2', '\\frac{a+b}{2}'],
    ['(a_n^2 + b_n^2)', '\\left(a_{n}^{2}+b_{n}^{2}\\right)'],
    ['e^(a + b)', 'e^{a+b}'],
    // more symbols and functions
    ['1/pi', '\\frac{1}{\\pi }'],
    ['max f', '\\max f'],
    ['sgn x', '\\operatorname{sgn}x'],
  ])('%s → %s', (keys, tex) => {
    expect(typed(keys.replace(/ /g, '␣')).tex).toBe(tex);
  });

  it('a big operator from the palette: _ stays in the lower limit, ^ goes to the upper', () => {
    const root: MRow = [];
    const cur: MCursor = { path: [], off: 0 };
    M.insertNode(root, cur, cmd('subsup', [[], []]), 0);
    M.typeChar(root, cur, '_');
    M.typeChar(root, cur, '0');
    M.typeChar(root, cur, '^');
    M.typeChar(root, cur, '1');
    expect(toLatex(root).replace(/\s+/g, '')).toBe('{}_{0}^{1}');
  });

  it('\\int comes with empty limits, \\intop bare (limits from _ and ^)', () => {
    for (const [name, keys, tex] of [
      ['int', '0 1 f', '\\int_{0}^{1}f'],
      ['sum', 'i=1 n a', '\\sum_{i=1}^{n}a'],
      ['lim', 'n->oo a', '\\lim_{n\\to\\infty}a'],
      ['intop', '_0^1 f', '\\int_{0}^{1}f'],
      ['sumop', ' a', '\\sum a'],
      ['prodop', '_k', '\\prod_{k}'],
      ['limop', '_(n->oo)', '\\lim_{n\\to\\infty}'],
    ]) {
      const root: MRow = [];
      const cur: MCursor = { path: [], off: 0 };
      M.applyInserter(root, cur, MATH_PALETTE[name]);
      for (const k of keys) k === ' ' ? M.space(root, cur) : M.typeChar(root, cur, k);
      expect(toLatex(root).replace(/\s+/g, ' ').replace(/ ?([_^{}]) ?/g, '$1').replace(/(\\[a-z]+) (?=\\)/g, '$1').trim(), name).toBe(tex);
    }
  });
});

describe('empty scripts', () => {
  it('write nothing, and show their box only while the formula is edited', () => {
    const root: MRow = [{ k: 'sym', id: 's', v: '\\int' }, cmd('subsup', [[], []])];
    expect(toLatex(root).trim()).toBe('\\int');
    expect(toLatex(root, true)).not.toContain('nx-empty');
    expect(toLatex(root, true, { path: [], off: 2 })).toContain('nx-empty');
  });
});

describe('backspace', () => {
  it('undoes an auto-replacement one letter at a time', () => {
    expect(typed('alpha‹').tex).toBe('alph');
    expect(typed('<=‹').tex).toBe('<');
  });

  it('unwraps a structure from the start of its slot', () => {
    expect(typed('a/b←‹').tex).toBe('ab');
    expect(typed('a/b‹‹').tex).toBe('a');
  });

  it('deletes an empty structure', () => {
    expect(typed('x^‹').tex).toBe('x');
  });

  it('enters a non-empty structure instead of deleting it', () => {
    const { cur } = typed('x^2␣‹');
    expect(cur.path.length).toBe(1);
  });
});

describe('caret stops', () => {
  // every row the caret visits, checked at each step
  const walk = (keys: string) => {
    const { root } = typed(keys);
    const cur: MCursor = { path: [], off: 0 };
    const seen: string[] = [];
    const check = () => {
      expect(M.isStop(M.rowAt(root, cur.path), cur.off), `stop at ${JSON.stringify(cur)}`).toBe(true);
      seen.push(JSON.stringify(cur));
    };
    check();
    while (M.moveRight(root, cur)) check();
    const right = seen.length;
    while (M.moveLeft(root, cur)) check();
    return { root, right, back: seen.length - right };
  };

  it('never stops between a base and its scripts', () => {
    for (const keys of ['x^2␣+1', 'x_1^2␣y', 'int0⇥1⇥f', 'sumi=1⇥n⇥a_i', '(a+b)^2', 'e^x^2']) walk(keys);
  });

  it('goes from a base straight into its script and back to before the base', () => {
    const { root } = typed('x^2');
    const cur: MCursor = { path: [], off: 0 };
    M.moveRight(root, cur);
    expect(cur).toEqual({ path: [{ i: 1, s: 0 }], off: 0 });
    M.moveLeft(root, cur);
    expect(cur).toEqual({ path: [], off: 0 });
  });

  it('leaves a base past its scripts', () => {
    // inside the parens, closing them jumps past the existing square
    const { root } = typed('(a+b)^2');
    const cur: MCursor = { path: [{ i: 0, s: 0 }], off: 3 };
    M.typeChar(root, cur, ')');
    expect(cur).toEqual({ path: [], off: 2 });
  });

  it('treats primes as part of their base', () => {
    walk("f'(x)");
    walk("f''^2␣x");
    const { root } = typed("f'");
    const cur: MCursor = { path: [], off: 0 };
    M.moveRight(root, cur);
    expect(cur).toEqual({ path: [], off: 2 });
    M.moveLeft(root, cur);
    expect(cur).toEqual({ path: [], off: 0 });
    // Delete takes the base's primes along (else they would go to the y)
    const d = typed("y␣f'x");
    const c2: MCursor = { path: [], off: 1 };
    M.deleteForward(d.root, c2);
    expect(toLatex(d.root)).toBe('yx');
  });

  it('delete before a base with scripts goes into them instead of orphaning them', () => {
    const { root } = typed('y␣x^2');
    const cur: MCursor = { path: [], off: 1 };
    M.deleteForward(root, cur);
    expect(toLatex(root)).toBe('yx^{2}');
    expect(cur).toEqual({ path: [{ i: 2, s: 0 }], off: 0 });
  });
});

describe('rendering', () => {
  it('anchored LaTeX renders and tags every node', () => {
    const { root } = typed('sumi=1⇥n␣x_i^2/2');
    const tex = toLatex(root, true, { path: [], off: root.length });
    const html = katex.renderToString(tex, { trust: true, strict: 'ignore', throwOnError: true });
    const walk = (row: MRow): string[] => row.flatMap((n) => [n.id, ...(n.k === 'cmd' ? n.slots.flatMap(walk) : [])]);
    for (const id of walk(root)) expect(html).toContain(`data-nx="${id}"`);
    expect(html).toContain('nx-caret');
  });
});

describe('selection ranges', () => {
  it('never splits a base from its scripts', () => {
    const { root } = typed('a+x^2_1');
    // nodes: a + x subsup  → selecting just `x` widens to include its scripts
    expect(M.alignRange(root, 2, 3)).toEqual([2, 4]);
    expect(M.alignRange(root, 3, 4)).toEqual([2, 4]);
  });

  it('wraps a selection into a fraction numerator and moves to the denominator', () => {
    const { root, cur } = typed('a+b');
    M.wrapRange(root, cur, 0, 3, cmd('frac', [[], []]));
    expect(toLatex(root)).toBe('\\frac{a+b}{}');
    expect(cur).toEqual({ path: [{ i: 0, s: 1 }], off: 0 });
  });

  it('wraps a selection in brackets and continues after them', () => {
    const { root, cur } = typed('a+b');
    M.wrapRange(root, cur, 0, 3, cmd('paren', [[]]));
    expect(toLatex(root)).toBe('(a+b)');
    expect(cur).toEqual({ path: [], off: 1 });
  });

  it('keeps a big operator and its limits together with the caret between them', () => {
    const { root } = typed('int_0^1');
    // caret right after the operator, before its limits: emitted after the limits
    const tex = toLatex(root, true, { path: [], off: 1 });
    expect(tex).toMatch(/^\\htmlData\{nx=[^}]+\}\{\\int.*\}\\htmlClass\{nx-caret nx-caret-script\}\{\}$/);
  });

  it('marks the selection in rendered output', () => {
    const { root } = typed('a+b');
    expect(toLatex(root, true, null, { path: [], s: 1, e: 3 })).toMatch(/htmlClass\{nx-sel\}\{.*\+.*b.*\}$/);
  });
});

describe('Ctrl+arrows in math', () => {
  // the caret's offsets visited by repeated Ctrl+← from the end of the formula
  const stops = (keys: string, dir: 1 | -1) => {
    const { root, cur } = typed(keys);
    if (dir > 0) (cur.path = []), (cur.off = 0);
    const seen: number[] = [];
    while (M.wordMove(root, cur, dir)) seen.push(cur.path.length ? -1 : cur.off);
    return seen;
  };
  it('jump a run of letters or digits, or one symbol, scripts and all', () => {
    // x^2 + abc + 12: [x, sup, +, a, b, c, +, 1, 2]
    expect(stops('x^2+abc+12', -1)).toEqual([7, 6, 3, 2, 0]);
    expect(stops('x^2+abc+12', 1)).toEqual([2, 3, 6, 7, 9]);
  });
  it('jump a structure whole, and step out of a box at its edge', () => {
    const { root, cur } = typed('a+(b+c)/d');
    // inside the denominator, at its start: Ctrl+← leaves the fraction (to before it)
    cur.path = [{ i: 2, s: 1 }];
    cur.off = 0;
    expect(M.wordMove(root, cur, -1)).toBe(true);
    expect(cur).toEqual({ path: [], off: 2 });
    // from there: the fraction in one step
    expect(M.wordMove(root, cur, 1)).toBe(true);
    expect(cur.off).toBe(3);
  });
});

describe('typing the way notes are written', () => {
  it.each([
    // a space ends a word: no ξ out of `x in`
    ['x in RR', 'x\\in \\mathbb{R}'],
    ['A uu B nn C', 'A\\cup B\\cap C'],
    ['A sube B', 'A\\subseteq B'],
    ['neg p and q', '\\neg p\\text{ and }q'],
    // a space doesn't leave an empty box
    ['x^n / n!', '\\frac{x^{n}}{n!}'],
    ['del f / del x', '\\frac{\\partial f}{\\partial x}'],
    ['sqrt 2', '\\sqrt{2}'],
    // brackets right after a root, an accent or a fraction bar group without showing
    ['sqrt(v+1)', '\\sqrt{v+1}'],
    ['1/(2pi)', '\\frac{1}{2\\pi }'],
    ['vec(a+b)', '\\vec{a+b}'],
    // accents and more names
    ['vec v', '\\vec{v}'],
    ['hat x + bar z', '\\hat{x}+\\overline{z}'],
    ['hbar omega', '\\hbar \\omega'],
    ['1/sin x + 1', '\\frac{1}{\\sin x}+1'],
    ['1/2 + 1', '\\frac{1}{2}+1'],
    ['-del vec B / del t', '-\\frac{\\partial \\vec{B}}{\\partial t}'],
    // a subscript's letters are an index
    ['a_ij + b', 'a_{ij}+b'],
  ])('%s → %s', (keys, tex) => {
    expect(typed(keys.replace(/ /g, '␣')).tex).toBe(tex);
  });
});

describe('substitutions', () => {
  it('only symbols made of keys by default: names stay letters', () => {
    M.setSubstitutions({});
    try {
      expect(typed('a->b').tex).toBe(String.raw`a\to b`);
      expect(typed('x<=y').tex).toBe(String.raw`x\le y`);
      expect(typed('pi').tex).toBe('pi');
      expect(typed('sin').tex).toBe('sin');
      expect(typed('x␣in␣A').tex).toBe('xinA');
      expect(typed('x^alpha').tex).toBe('x^{a}lpha');
    } finally {
      M.setSubstitutions(allSubs);
    }
  });
  it('each group on its own', () => {
    M.setSubstitutions({ greek: true });
    try {
      expect(typed('pi').tex).toBe(String.raw`\pi`);
      expect(typed('sin').tex).toBe('sin');
    } finally {
      M.setSubstitutions(allSubs);
    }
  });
  it("the user's own win, with every group off", () => {
    M.setSubstitutions({ symbols: false });
    M.setMathSnippets({ RR: String.raw`\mathbb{R}` });
    try {
      expect(typed('RR').tex).toBe(String.raw`\mathbb{R}`);
      expect(typed('->').tex).toBe('->');
      expect(M.isSubstitution('RR')).toBe(true);
    } finally {
      M.setMathSnippets({});
      M.setSubstitutions(allSubs);
    }
  });
});

describe('matrices', () => {
  /** A matrix typed: `&` next column, `|` next row (Enter), `‹` backspace; then the LaTeX. */
  function matrix(keys: string, name = 'pmatrix') {
    const root: MRow = [];
    const cur: MCursor = { path: [], off: 0 };
    M.applyInserter(root, cur, MATH_PALETTE[name]);
    for (const k of keys) {
      if (k === '&') M.gridNext(root, cur, 'col');
      else if (k === '|') M.gridNext(root, cur, 'row');
      else if (k === '‹') M.backspace(root, cur);
      else M.typeChar(root, cur, k);
    }
    const tex = () => toLatex(root).replace(/\s+/g, ' ').trim();
    return { root, cur, tex };
  }
  const env = (rows: string[][]) => (String.raw`\begin{pmatrix}` + rows.map((r) => r.join(' & ')).join(String.raw` \\ `) + String.raw`\end{pmatrix}`).replace(/\s+/g, ' ');

  it('comes 2x2, or 3x3 and 4x4 when asked', () => {
    const m = matrix('', 'pmatrix3x3');
    const g = M.gridAt(m.root, m.cur)!;
    expect([g.rows, g.cols]).toEqual([3, 3]);
    expect(MATH_PALETTE.bmatrix4x4).toBeDefined();
    expect(MATH_PALETTE.pmatrix3x4).toBeUndefined();
    expect(MATH_PALETTE.pmatrix2x2).toBeUndefined();
  });

  it('backspace in an empty row takes the row, to the end of the row before', () => {
    const m = matrix('a&b|');
    expect(m.tex()).toBe(env([['a', 'b'], ['', '']]));
    M.backspace(m.root, m.cur);
    expect(m.tex()).toBe(env([['a', 'b']]));
    M.typeChar(m.root, m.cur, 'c');
    expect(m.tex()).toBe(env([['a', 'bc']]));
  });

  it('backspace in an empty column takes the column', () => {
    const m = matrix('a&&|b&');
    expect(m.tex()).toBe(env([['a', '', ''], ['b', '', '']]));
    M.backspace(m.root, m.cur);
    expect(m.tex()).toBe(env([['a', ''], ['b', '']]));
    // (the caret at the end of the cell before)
    M.typeChar(m.root, m.cur, 'x');
    expect(m.tex()).toBe(env([['a', ''], ['bx', '']]));
  });

  it('backspace at a cell start otherwise goes to the cell before, never unwrapping the matrix', () => {
    const m = matrix('a&b|c&d');
    M.backspace(m.root, m.cur); // d
    M.backspace(m.root, m.cur); // at d's cell start: to the end of c
    M.typeChar(m.root, m.cur, 'x');
    expect(m.tex()).toBe(env([['a', 'b'], ['cx', '']]));
  });

  it('backspace in an empty matrix shrinks it, then takes it away', () => {
    const m = matrix('');
    // 2x2, 1x2, 1x1, gone
    for (let i = 0; i < 2; i++) M.backspace(m.root, m.cur);
    expect(m.root.length).toBe(1);
    expect(m.tex()).toBe(String.raw`\begin{pmatrix}\end{pmatrix}`);
    M.backspace(m.root, m.cur);
    expect(m.root).toEqual([]);
  });

  it('rows and columns added and taken away where the caret is', () => {
    const m = matrix('a&b|c&d');
    M.gridEdit(m.root, m.cur, 'row+');
    M.typeChar(m.root, m.cur, 'e');
    expect(m.tex()).toBe(env([['a', 'b'], ['c', 'd'], ['', 'e']]));
    M.gridEdit(m.root, m.cur, 'col+');
    M.typeChar(m.root, m.cur, 'f');
    expect(m.tex()).toBe(env([['a', 'b', ''], ['c', 'd', ''], ['', 'e', 'f']]));
    M.gridEdit(m.root, m.cur, 'col-');
    expect(m.tex()).toBe(env([['a', 'b'], ['c', 'd'], ['', 'e']]));
    M.gridEdit(m.root, m.cur, 'row-');
    expect(m.tex()).toBe(env([['a', 'b'], ['c', 'd']]));
    // the last row and column stay
    const one = matrix('', 'pmatrix');
    M.gridEdit(one.root, one.cur, 'row-');
    expect(M.gridEdit(one.root, one.cur, 'row-')).toBe(false);
    M.gridEdit(one.root, one.cur, 'col-');
    expect(M.gridEdit(one.root, one.cur, 'col-')).toBe(false);
  });
});

describe('display-size operators (\\dint, \\dsum, \\dlim…)', () => {
  it.each([
    ['dint', String.raw`{\displaystyle \int _{0}^{1}}`],
    ['dsum', String.raw`{\displaystyle \sum _{0}^{1}}`],
    ['dlim', String.raw`{\displaystyle \lim _{0}}1`],
  ])('\\%s: the operator at display size with its limits, as LaTeX writes it', (name, want) => {
    const root: MRow = [];
    const cur: MCursor = { path: [], off: 0 };
    M.applyInserter(root, cur, MATH_PALETTE[name]);
    M.typeChar(root, cur, '0');
    M.space(root, cur);
    M.typeChar(root, cur, '1');
    expect(toLatex(root).replace(/\s+/g, ' ').trim()).toBe(want);
  });

  it('on the page: in its own group with its limits, at display size', () => {
    const root: MRow = [];
    const cur: MCursor = { path: [], off: 0 };
    M.applyInserter(root, cur, MATH_PALETTE.dsum);
    const shown = toLatex(root, true);
    expect(shown).toContain(String.raw`\displaystyle \sum`);
    expect(() => katex.renderToString(shown, { trust: true, strict: 'ignore', throwOnError: true })).not.toThrow();
  });
});

describe('typing a character as itself (what Backspace puts back for a substitution)', () => {
  /** Type `keys`, the last one as itself. */
  const literal = (keys: string) => {
    const t = typed(keys.slice(0, -1));
    M.typeLiteral(t.root, t.cur, keys.slice(-1));
    return t;
  };
  it.each([
    ['xx', 'xx'],
    ['pi', 'pi'],
    ['a/', 'a/'],
    ['in', 'in'],
  ])('%s stays %s', (keys, tex) => {
    expect(toLatex(literal(keys).root).replace(/\s+/g, '')).toBe(tex);
  });
  it('and the letters after it start a word of their own', () => {
    const t = literal('xx');
    M.typeChar(t.root, t.cur, 'x');
    expect(toLatex(t.root).replace(/\s+/g, '')).toBe('xxx');
  });
  it('still leaves a script it ends, as typing does', () => {
    const t = literal('x^2+');
    expect(toLatex(t.root).replace(/\s+/g, '')).toBe('x^{2}+');
  });
});

describe('typing a character as itself, after a symbol it took into a longer name', () => {
  it('spells the symbol out: int, not ∈t', () => {
    const t = typed('in');
    M.typeLiteral(t.root, t.cur, 't', true);
    expect(toLatex(t.root).replace(/\s+/g, '')).toBe('int');
  });
});
