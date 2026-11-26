import { describe, expect, it } from 'vitest';
import { BOLD, CODE, HIGHLIGHT, ITALIC, LINK, MARK, STRIKE, closesFence, fenceOf, headingOf, parseInline } from './markdown';

/** Each character as: m marker, B bold, I italic, # both, C code, . plain. */
const show = (text: string) =>
  [...parseInline(text).flags].map((f) => (f & MARK ? 'm' : f & CODE ? 'C' : f & BOLD && f & ITALIC ? '#' : f & BOLD ? 'B' : f & ITALIC ? 'I' : '.')).join('');

describe('inline markdown', () => {
  it.each([
    ['a **b** c', '..mmBmm..'],
    ['a *b* c', '..mIm..'],
    ['***x***', 'mmm#mmm'],
    ['`co*de`', 'mCCCCCm'],
    ['``a`b``', 'mmCCCmm'],
    ['**bold *it* x**', 'mmBBBBBm##mBBmm'],
    ['**see `x`**', 'mmBBBBmCmmm'],
    ['_it_ and __b__', 'mIIm.....mmBmm'],
    ['snake_case_name', '...............'],
    ['a * b * c', '.........'],
    ['2*3*4', '.mIm.'],
    ['**open', '......'],
    ['`', '.'],
    ['``', '..'],
  ])('%s', (text, want) => {
    expect(show(text)).toBe(want);
  });
  it.each([
    ['a ~~no~~ b', '..mmSSmm..'],
    ['==key== x', 'mmHHHmm..'],
    ['~~**both**~~', 'mmmm####mmmm'],
    ['a ~~ b ~~', '.........'],
    ['x == y', '......'],
    ['~one~', '.....'],
  ])('strike and highlight: %s', (text, want) => {
    const f = parseInline(text).flags;
    const out = [...f].map((x) => (x & MARK ? 'm' : x & STRIKE && x & BOLD ? '#' : x & STRIKE ? 'S' : x & HIGHLIGHT ? 'H' : '.')).join('');
    expect(out).toBe(want);
  });
  it.each([
    ['see [[Fourier]] x', '....mmLLLLLLLmm..', [{ start: 4, end: 15, open: 2, close: 2, to: 'Fourier', note: true }]],
    ['[[Fourier series|it]]', 'mmmmmmmmmmmmmmmmmLLmm', [{ start: 0, end: 21, open: 17, close: 2, to: 'Fourier series', note: true }]],
    ['a [b](http://x.y) c', '..mLmmmmmmmmmmmmm..', [{ start: 2, end: 17, open: 1, close: 13, to: 'http://x.y', note: false }]],
    ['go https://a.b/c_d_e.', '...LLLLLLLLLLLLLLLLL.', [{ start: 3, end: 20, open: 0, close: 0, to: 'https://a.b/c_d_e', note: false }]],
    ['(https://a.b)', '.LLLLLLLLLLL.', [{ start: 1, end: 12, open: 0, close: 0, to: 'https://a.b', note: false }]],
    ['`[[not]]`', 'mCCCCCCCm', []],
    ['[[]] and [x]', '............', []],
  ])('links: %s', (text, want, links) => {
    const r = parseInline(text);
    expect([...r.flags].map((x) => (x & MARK ? 'm' : x & CODE ? 'C' : x & LINK ? 'L' : '.')).join('')).toBe(want);
    expect(r.links).toEqual(links);
  });
  it('gives the spans', () => {
    expect(parseInline('x **b** `c`').spans).toEqual([
      { start: 8, end: 11, open: 1, close: 1 },
      { start: 2, end: 7, open: 2, close: 2 },
    ]);
  });
});

describe('block markdown', () => {
  it('reads headings and fences', () => {
    expect(headingOf('## Notes')).toEqual({ level: 2, prefix: 3 });
    expect(headingOf('##Notes')).toBeNull();
    expect(fenceOf('```python')).toBe('python');
    expect(fenceOf('```')).toBe('');
    expect(fenceOf('``` x y')).toBeNull();
    expect(closesFence('```')).toBe(true);
    expect(closesFence('```py')).toBe(false);
  });
});
