import { describe, expect, it } from 'vitest';
import { BOLD, CODE, ITALIC, MARK, closesFence, fenceOf, headingOf, parseInline } from './markdown';

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
