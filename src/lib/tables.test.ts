import { describe, expect, it } from 'vitest';
import { aligns, cellSpans, emptyRow, findTables, isSeparator, isWall, markdownCells, rowItems, rowLike, rowMarkdown, separatorLine, structureTables, tableRowAt } from './tables';
import { deserialize, serialize } from './format';
import { block, chars, math, sym, type Block, type BlockKind, type Item } from './model';

const P = (s: string, kind: BlockKind = 'p') => block(chars(s), kind);
const text = (items: Item[]) => items.map((i) => (i.t === 'c' ? (i.cell ? '‖' : i.ch) : '§')).join('');
const plain = (items: Item[]) => items.map((i) => (i.t === 'c' ? i.ch : '§')).join('');
/** A table's rows as | cell | cell | from its cells. */
const rows = (blocks: Block[]) => blocks.map((b) => (b.kind === 'tr' ? `${b.head ? 'H' : ' '}${cellSpans(b.items).map(([s, e]) => text(b.items.slice(s, e))).join(' ‖ ')}` : `p ${plain(b.items)}`));

describe('markdown tables become tables', () => {
  it('a row, a separator, rows: a header with its alignment, and rows', () => {
    const out = structureTables([P('before'), P('| a | b |'), P('| :-- | --: |'), P('| 1 | 2 |'), P('| 3 | 4 |'), P('after')]);
    expect(rows(out)).toEqual(['p before', 'Ha ‖ b', ' 1 ‖ 2', ' 3 ‖ 4', 'p after']);
    expect(out[1].aligns).toEqual(['left', 'right']);
    // the separator line is gone: its alignment is on the header
    expect(out).toHaveLength(5);
  });

  it('no separator, no table: |x| at the start of a line stays text', () => {
    expect(rows(structureTables([P('|x| is the size'), P('|y| too')]))).toEqual(['p |x| is the size', 'p |y| too']);
  });

  it('a typed | is written \\| and stays a character', () => {
    const out = structureTables([P('| a \\| b | c |'), P('| - | - |')]);
    expect(rows(out)).toEqual(['Ha | b ‖ c']);
    const lit = out[0].items.filter((i) => i.t === 'c' && i.ch === '|' && !i.cell);
    expect(lit).toHaveLength(1);
  });

  it('short rows get empty cells; a row typed without its closing | still counts', () => {
    const out = structureTables([P('| a | b | c |'), P('|-|-|-|'), P('| 1 |'), P('| x | y')]);
    expect(rows(out)).toEqual(['Ha ‖ b ‖ c', ' 1 ‖  ‖ ', ' x ‖ y ‖ ']);
  });

  it('two tables one under the other stay two', () => {
    const out = structureTables([P('| a |'), P('| - |'), P('| 1 |'), P('| b |'), P('| - |'), P('| 2 |')]);
    expect(rows(out)).toEqual(['Ha', ' 1', 'Hb', ' 2']);
    const t = findTables(out);
    expect([...t.values()].map((r) => [r.table, r.role, r.last])).toEqual([
      [0, 'head', false], [0, 'body', true], [2, 'head', false], [2, 'body', true],
    ]);
  });

  it('cells keep their characters (drawings on them stay)', () => {
    const src = P('| ab | cd |');
    const ids = src.items.filter((i) => i.t === 'c' && /[a-d]/.test(i.ch)).map((i) => i.id);
    const [head] = structureTables([src, P('| - | - |')]);
    expect(head.items.filter((i) => !isWall(i)).map((i) => i.id)).toEqual(ids);
  });

  it('formulas in cells stay formulas', () => {
    const out = structureTables([block([...chars('| x | '), math([sym('a')]), ...chars(' |')]), P('| - | - |')]);
    expect(rows(out)).toEqual(['Hx ‖ §']);
  });

  it('only paragraphs: lines in a list or code stay what they are', () => {
    expect(structureTables([P('| a |', 'li'), P('| - |', 'li')]).every((b) => b.kind === 'li')).toBe(true);
  });
});

describe('rows and cells', () => {
  it('cells are between the walls', () => {
    const items = rowItems([chars('ab'), [], chars('c|d')]);
    expect(cellSpans(items).map(([s, e]) => plain(items.slice(s, e)))).toEqual(['ab', '', 'c|d']);
  });

  it('a new row has empty cells', () => {
    expect(cellSpans(emptyRow(3).items)).toHaveLength(3);
  });

  it('looking up one row agrees with reading the whole note', () => {
    const blocks = structureTables([P('text'), P('| a |'), P('| - |'), P('| 1 |'), P('| b | c |'), P('| - | - |'), P('| 2 | 3 |'), P('gap')]);
    const all = findTables(blocks);
    for (let b = 0; b < blocks.length; b++) expect(tableRowAt(blocks, b), `block ${b}`).toEqual(all.get(b) ?? null);
  });
});

describe('tables as markdown', () => {
  it('a row as a line, a typed | as \\|', () => {
    expect(rowMarkdown(rowItems([chars('a|b'), chars('c')]), plain)).toBe('| a\\|b | c |');
  });

  it('the separator line from the alignment', () => {
    expect(separatorLine(['left', 'center', 'right', null], 4)).toBe('| :-- | :-: | --: | --- |');
  });

  it('knows a separator line, and reads its alignment', () => {
    for (const s of ['| --- | --- |', '|---|---|', '| :-- | :-: | --: |', '| --- | ---']) expect(isSeparator(s), s).toBe(true);
    for (const s of ['| a | b |', '| --- | x |', '---', 'text']) expect(isSeparator(s), s).toBe(false);
    expect(aligns('| :-- | :-: | --: | --- |')).toEqual(['left', 'center', 'right', null]);
  });

  it('markdown row cells, trimmed', () => {
    expect(markdownCells(chars('|  a  | b\\|c |')).map(plain)).toEqual(['a', 'b|c']);
    expect(rowLike('  | a')).toBe(true);
    expect(rowLike('a | b')).toBe(false);
  });
});

describe('tables in a note file', () => {
  it('saved and opened again: walls, typed |, header and alignment as they were', () => {
    const blocks = structureTables([P('| a \\| b | c |'), P('| :-: | --: |'), P('| 1 | 2 |')]);
    const back = deserialize(serialize({ blocks, arrows: [], marks: [] }));
    expect(rows(back.blocks)).toEqual(rows(blocks));
    expect(back.blocks[0].head).toBe(true);
    expect(back.blocks[0].aligns).toEqual(['center', 'right']);
    expect(back.blocks[0].items.filter((i) => i.t === 'c' && i.ch === '|' && !i.cell)).toHaveLength(1);
  });

  it('a note with a markdown table (from before) opens as a table', () => {
    const file = serialize({ blocks: [P('| a | b |'), P('| - | - |'), P('| 1 | 2 |')], arrows: [], marks: [] });
    expect(rows(deserialize(file).blocks)).toEqual(['Ha ‖ b', ' 1 ‖ 2']);
  });
});
