import { describe, expect, it } from 'vitest';
import { aligns, cellRanges, cellTexts, findTables, isSeparator, rowLike, tableRowAt } from './tables';
import { block, chars, math, sym, type BlockKind, type Item } from './model';

const P = (s: string, kind: BlockKind = 'p') => block(chars(s), kind);
const text = (items: Item[]) => items.map((i) => (i.t === 'c' ? i.ch : '§')).join('');

describe('tables', () => {
  it('knows a separator line', () => {
    for (const s of ['| --- | --- |', '|---|---|', '| :-- | :-: | --: |', '  | - |', '| --- | ---']) expect(isSeparator(s), s).toBe(true);
    for (const s of ['| a | b |', '| --- | x |', '---', '| |', 'text']) expect(isSeparator(s), s).toBe(false);
  });

  it('reads the columns alignment from the separator', () => {
    expect(aligns('| :-- | :-: | --: | --- |')).toEqual(['left', 'center', 'right', null]);
  });

  it('a table: a row, a separator, then rows, up to the first line that is not one', () => {
    const blocks = [P('before'), P('| a | b |'), P('| - | - |'), P('| 1 | 2 |'), P('| 3 | 4 |'), P('after'), P('| x |')];
    const t = findTables(blocks);
    expect([...t.keys()]).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map((b) => t.get(b)!.role)).toEqual(['head', 'sep', 'body', 'body']);
    expect(t.get(4)!.last).toBe(true);
    expect(t.get(1)!.table).toBe(1);
  });

  it('no separator, no table: |x| at the start of a line stays text', () => {
    expect(findTables([P('|x| is the absolute value'), P('|y| too')]).size).toBe(0);
    expect(findTables([P('| a | b |')]).size).toBe(0);
  });

  it('only paragraphs are rows (not list items or code)', () => {
    expect(findTables([P('| a |', 'li'), P('| - |', 'li')]).size).toBe(0);
    expect(findTables([P('| a |', 'code'), P('| - |', 'code')]).size).toBe(0);
  });

  it('two tables apart', () => {
    const t = findTables([P('| a |'), P('| - |'), P('gap'), P('| b |'), P('| - |'), P('| 1 |')]);
    expect(t.get(0)!.table).toBe(0);
    expect(t.get(3)!.table).toBe(3);
    expect(t.get(1)!.last).toBe(true);
    expect(t.get(5)!.last).toBe(true);
  });

  it('two tables one under the other stay two', () => {
    const t = findTables([P('| a |'), P('| - |'), P('| 1 |'), P('| b | c |'), P('| - | - |'), P('| 2 | 3 |')]);
    expect([0, 1, 2, 3, 4, 5].map((b) => [t.get(b)!.table, t.get(b)!.role])).toEqual([
      [0, 'head'], [0, 'sep'], [0, 'body'], [3, 'head'], [3, 'sep'], [3, 'body'],
    ]);
    expect(t.get(2)!.last).toBe(true);
  });

  it('cells start at their pipes; a closing pipe is a cell of its own', () => {
    const items = chars('| a | bc |');
    expect(cellRanges(items).map(([s, e]) => text(items.slice(s, e)))).toEqual(['| a ', '| bc ', '|']);
    const loose = chars('  | a | b');
    expect(cellRanges(loose).map(([s, e]) => text(loose.slice(s, e)))).toEqual(['  | a ', '| b']);
  });

  it("cells' text between the pipes, with formulas", () => {
    const items = [...chars('| x '), math([sym('a')]), ...chars(' | y |')];
    expect(cellTexts(items).map(text)).toEqual([' x § ', ' y ']);
    expect(cellTexts(chars('| a | b')).map(text)).toEqual([' a ', ' b']);
  });

  it('looking up one row (from the lines around it) agrees with reading them all', () => {
    const blocks = [P('text'), P('| a |'), P('| - |'), P('| 1 |'), P('| b | c |'), P('| - | - |'), P('| 2 | 3 |'), P('gap'), P('|x| alone'), P('| y |'), P('| - |')];
    const all = findTables(blocks);
    for (let b = 0; b < blocks.length; b++) expect(tableRowAt(blocks, b), `block ${b}`).toEqual(all.get(b) ?? null);
  });

  it('rowLike', () => {
    expect(rowLike('  | a')).toBe(true);
    expect(rowLike('a | b')).toBe(false);
  });
});
