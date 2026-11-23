import { describe, expect, it } from 'vitest';
import { inlineItems, parsePaste } from './paste';
import { toLatex } from './math/latex';
import type { Item } from './model';

/** Items as text: formulas as $…$ / $$…$$, bold as [..], italic as {..}. */
const show = (items: Item[]) =>
  items
    .map((i) => (i.t === 'm' ? (i.display ? `$$${toLatex(i.root).trim()}$$` : `$${toLatex(i.root).trim()}$`) : i.b ? `[${i.ch}]` : i.i ? `{${i.ch}}` : i.ch))
    .join('');

describe('pasting', () => {
  it('reads math however it is written', () => {
    expect(show(parsePaste('area $\\pi r^2$ here')[0].items)).toBe('area $\\pi r^{2}$ here');
    expect(show(parsePaste('area \\(\\pi r^2\\) here')[0].items)).toBe('area $\\pi r^{2}$ here');
    expect(show(parsePaste('\\[\\int_0^1 x\\,dx\\]')[0].items)).toBe('$$\\int _{0}^{1}x\\,dx$$');
    // a display formula over several lines, as chat answers write them
    const b = parsePaste('so\n$$\na^2 + b^2\n= c^2\n$$\ndone');
    expect(b.map((x) => show(x.items))).toEqual(['so', '$$a^{2}+b^{2}=c^{2}$$', 'done']);
  });
  it('leaves prices alone', () => {
    expect(show(inlineItems('costs $5 and $10 now'))).toBe('costs $5 and $10 now');
    expect(show(inlineItems('a $x$ b'))).toBe('a $x$ b');
  });
  it('reads markdown as structure', () => {
    const b = parsePaste('# Title\n\nSome **bold** and *it* text.\n\n- one\n  - nested\n1. first\n2. second');
    expect(b.map((x) => [x.kind, x.indent ?? 0, show(x.items)])).toEqual([
      ['h1', 0, 'Title'],
      ['p', 0, 'Some [b][o][l][d] and {i}{t} text.'],
      ['li', 0, 'one'],
      ['li', 1, 'nested'],
      ['ol', 0, 'first'],
      ['ol', 0, 'second'],
    ]);
  });
  it('one line is just text', () => {
    expect(parsePaste('# not a heading')[0]).toMatchObject({ kind: 'p' });
  });
});

describe('pasting code', () => {
  it('keeps inline code as it is', () => {
    const items = inlineItems('run `a $x$ *b*` then $y$');
    expect(items.filter((i) => i.t === 'c' && i.c).map((i) => (i.t === 'c' ? i.ch : '')).join('')).toBe('a $x$ *b*');
    expect(items.filter((i) => i.t === 'm').length).toBe(1);
  });
  it('reads fenced code as code blocks', () => {
    const b = parsePaste('look:\n```python\ndef f(x):\n\n    return $x\n```\ndone');
    expect(b.map((x) => [x.kind, x.lang, show(x.items)])).toEqual([
      ['p', undefined, 'look:'],
      ['code', 'python', 'def f(x):'],
      ['code', undefined, ''],
      ['code', undefined, '    return $x'],
      ['p', undefined, 'done'],
    ]);
  });
});
