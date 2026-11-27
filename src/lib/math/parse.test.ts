import { describe, expect, it } from 'vitest';
import { toLatex } from './latex';
import { caretFor, looksLikeLatex, parseLatex } from './parse';

const tex = (s: string) => toLatex(parseLatex(s).row).replace(/\s+/g, ' ').trim();

describe('parseLatex', () => {
  it.each([
    ['x^2+1', 'x^{2}+1'],
    ['x^{10}', 'x^{10}'],
    ['x_1^2', 'x_{1}^{2}'],
    ['x^2_1', 'x_{1}^{2}'],
    ['\\frac{a+b}{c}', '\\frac{a+b}{c}'],
    ['\\frac12', '\\frac{1}{2}'],
    ['\\frac {a} {b}', '\\frac{a}{b}'],
    ['\\sqrt{x}', '\\sqrt{x}'],
    ['\\sqrt[3]{x}', '\\sqrt[3]{x}'],
    ['\\left( \\frac{a}{b} \\right)', '\\left(\\frac{a}{b}\\right)'],
    ['f(x)', 'f(x)'],
    ['[0, 1)', '[0,1)'],
    ['\\{x\\}', '\\{x\\}'],
    ['\\alpha+\\beta', '\\alpha +\\beta'],
    ['\\sum_{i=1}^{n} i', '\\sum _{i=1}^{n}i'],
    ['\\mathbb{R}^n', '\\mathbb{R}^{n}'],
    ['\\text{if } x > 0', '\\text{if }x>0'],
    ['\\hat x', '\\hat{x}'],
    ['\\overbrace{a+b}^{n}', '\\overbrace{a+b}^{n}'],
    ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}'],
    ['\\begin{cases} 1 & x>0 \\\\ 0 & \\text{else} \\\\ \\end{cases}', '\\begin{cases}1 & x>0 \\\\ 0 & \\text{else}\\end{cases}'],
    ['$x+y$', 'x+y'],
    ['\\[ E = mc^2 \\]', 'E=mc^{2}'],
    ['a % comment\n+b', 'a+b'],
  ])('%s', (src, out) => {
    expect(tex(src)).toBe(out);
  });

  it('round-trips its own output', () => {
    for (const src of ['\\frac{\\sqrt{x^{2}+1}}{\\left|y\\right|}', '\\int _{0}^{\\infty}e^{-x}dx', '\\vec{v}\\cdot \\hat{n}']) {
      const once = tex(src);
      expect(tex(once)).toBe(once);
    }
  });

  it('places the caret at # or the first empty slot', () => {
    expect(caretFor(parseLatex('\\left\\| # \\right\\|'))).toEqual({ path: [{ i: 0, s: 0 }], off: 0 });
    expect(caretFor(parseLatex('\\frac{}{}'))).toEqual({ path: [{ i: 0, s: 0 }], off: 0 });
    expect(caretFor(parseLatex('\\frac{1}{}'))).toEqual({ path: [{ i: 0, s: 1 }], off: 0 });
    expect(caretFor(parseLatex('ab'))).toEqual({ path: [], off: 2 });
  });

  it('detects LaTeX in pasted text', () => {
    expect(looksLikeLatex('\\frac{a}{b}')).toBe(true);
    expect(looksLikeLatex('x^{2}')).toBe(true);
    expect(looksLikeLatex('$x$')).toBe(true);
    expect(looksLikeLatex('just words')).toBe(false);
  });
});

describe('big operators at display size', () => {
  it('\\displaystyle before one makes it display size, its limits kept with it, and back', () => {
    expect(tex(String.raw`\displaystyle\int_0^1 f\,dx`)).toBe(String.raw`{\displaystyle \int _{0}^{1}}f\,dx`);
    expect(tex(String.raw`{\displaystyle \sum_{n=1}^{\infty}} a_n`)).toBe(String.raw`{\displaystyle \sum _{n=1}^{\infty }}a_{n}`);
    // (before anything else, still ignored)
    expect(tex(String.raw`\displaystyle x+1`)).toBe('x+1');
  });
});
