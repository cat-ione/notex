import katex from 'katex';
import { describe, expect, it } from 'vitest';
import type { MRow } from '../model';
import * as M from './edit';
import { toLatex, type MCursor } from './latex';
import { cmd } from '../model';

/** Type a string into an empty formula. `‹` = backspace, `←`/`→` = left/right, `␣` = space, `⇥` = tab. */
function typed(keys: string) {
  const root: MRow = [];
  const cur: MCursor = { path: [], off: 0 };
  for (const k of keys) {
    if (k === '‹') M.backspace(root, cur);
    else if (k === '→') M.moveRight(root, cur);
    else if (k === '←') M.moveLeft(root, cur);
    else if (k === '␣') M.exitStructure(root, cur);
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
    ['x^2/2', 'x^{\\frac{2}{2}}'],
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

  it('sum opens limits and tab moves between them', () => {
    expect(typed('sumi=1⇥n').tex).toBe('\\sum _{i=1}^{n}');
  });

  it('closing paren leaves the delimiter', () => {
    expect(typed('(a)b').tex).toBe('(a)b');
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
    const { root } = typed('int0⇥1⇥');
    // caret right after the operator, before its limits: emitted after the limits
    const tex = toLatex(root, true, { path: [], off: 1 });
    expect(tex).toMatch(/^\\htmlData\{nx=[^}]+\}\{\\int.*\}\\htmlClass\{nx-caret nx-caret-script\}\{\}$/);
  });

  it('marks the selection in rendered output', () => {
    const { root } = typed('a+b');
    expect(toLatex(root, true, null, { path: [], s: 1, e: 3 })).toMatch(/htmlClass\{nx-sel\}\{.*\+.*b.*\}$/);
  });
});
