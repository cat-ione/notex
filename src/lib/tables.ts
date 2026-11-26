// Tables, as in a word processor: a table is a run of row blocks (kind 'tr'), the first its
// header (`head`, with the columns' alignment). A row's cells are separated by cell walls:
// '|' characters marked `cell`, which the editor never lets the caret onto or delete. A '|'
// typed in a cell is just a character. Outside the editor (files, the clipboard, LaTeX)
// tables are markdown: | a | b |, a separator line under the header, \| for a typed |.

import { block, ch, type Block, type Char, type Item } from './model';

export type Align = 'left' | 'center' | 'right' | null;
export type TableRow = {
  /** Which table (the index of its header's block). */
  table: number;
  role: 'head' | 'body';
  /** Its table's columns' alignment (kept on the header). */
  aligns: Align[];
  /** The last row of its table. */
  last: boolean;
};

/** A cell wall: the '|' between cells (never typed, never deleted). */
export const isWall = (it: Item | undefined): it is Char => it?.t === 'c' && !!it.cell;
export const wall = (): Char => Object.assign(ch('|'), { cell: true as const });

/** The rows of every table, by block index. */
export function findTables(blocks: Block[]): Map<number, TableRow> {
  const out = new Map<number, TableRow>();
  for (let b = 0; b < blocks.length; b++) {
    if (blocks[b].kind !== 'tr') continue;
    // a table: a header, then rows up to the next header or the first line that's no row
    let e = b + 1;
    while (blocks[e]?.kind === 'tr' && !blocks[e].head) e++;
    const aligns = blocks[b].aligns ?? [];
    for (let r = b; r < e; r++) out.set(r, { table: b, role: r === b ? 'head' : 'body', aligns, last: r === e - 1 });
    b = e - 1;
  }
  return out;
}

/** The table row block `b` is, if it is one (from its table only, not the whole note). */
export function tableRowAt(blocks: Block[], b: number): TableRow | null {
  if (blocks[b]?.kind !== 'tr') return null;
  let t = b;
  while (t > 0 && !blocks[t].head && blocks[t - 1]?.kind === 'tr') t--;
  let e = t + 1;
  while (blocks[e]?.kind === 'tr' && !blocks[e].head) e++;
  return { table: t, role: b === t ? 'head' : 'body', aligns: blocks[t].aligns ?? [], last: b === e - 1 };
}

/** A row's cells as item ranges [start, end): from after a wall to the next wall. */
export function cellSpans(items: Item[]): [number, number][] {
  const walls: number[] = [];
  items.forEach((it, o) => isWall(it) && walls.push(o));
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < walls.length; k++) out.push([walls[k] + 1, walls[k + 1]]);
  return out;
}

/** A row from its cells' contents: walls around and between them. */
export function rowItems(cells: Item[][]): Item[] {
  const out: Item[] = [wall()];
  for (const c of cells) out.push(...c, wall());
  return out;
}

/** A new row block of `n` empty cells. */
export const emptyRow = (n: number) => block(rowItems(Array.from({ length: Math.max(1, n) }, () => [])), 'tr');

// ── markdown ──

const textOf = (items: Item[]) => items.map((i) => (i.t === 'c' ? i.ch : '￼')).join('');

/** A markdown row line: it starts with | (after spaces). */
export const rowLike = (text: string) => /^\s*\|/.test(text);

/** A markdown separator line: | --- | :--: | --: | (dashes, optional colons, between pipes). */
export const isSeparator = (text: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(text) || /^\s*\|(\s*:?-+:?\s*\|)*\s*:?-+:?\s*$/.test(text);

/** A separator line's columns' alignment. */
export function aligns(text: string): Align[] {
  return text
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => {
      const s = c.trim();
      const l = s.startsWith(':'), r = s.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
    });
}

/**
 * A markdown row line's cells (its items between the unescaped pipes, spaces trimmed; \| is
 * a typed |, without its backslash). Items keep their ids (drawings stay on them).
 */
export function markdownCells(items: Item[]): Item[][] {
  const isCh = (it: Item | undefined, c: string) => it?.t === 'c' && it.ch === c;
  const cells: Item[][] = [];
  let cur: Item[] | null = null;
  for (let o = 0; o < items.length; o++) {
    const it = items[o];
    if (isCh(it, '\\') && isCh(items[o + 1], '|')) {
      cur?.push(items[++o]);
      continue;
    }
    if (isCh(it, '|')) {
      if (cur) cells.push(cur);
      cur = [];
      continue;
    }
    if (cur) cur.push(it);
  }
  // (a row typed without its closing |: its last cell runs to the end)
  if (cur && cur.some((i) => i.t !== 'c' || i.ch.trim())) cells.push(cur);
  const space = (i: Item | undefined) => i?.t === 'c' && !i.ch.trim();
  return cells.map((c) => {
    let s = 0, e = c.length;
    while (s < e && space(c[s])) s++;
    while (e > s && space(c[e - 1])) e--;
    return c.slice(s, e);
  });
}

/**
 * Markdown tables among paragraph blocks (a row line, a separator line, row lines) made
 * tables: row blocks with cell walls, the header holding the alignment. The rest as it is.
 */
export function structureTables(blocks: Block[]): Block[] {
  const out: Block[] = [];
  const row = (b: number) => blocks[b]?.kind === 'p' && rowLike(textOf(blocks[b].items));
  for (let b = 0; b < blocks.length; b++) {
    if (!(row(b) && row(b + 1) && isSeparator(textOf(blocks[b + 1].items)))) {
      out.push(blocks[b]);
      continue;
    }
    const al = aligns(textOf(blocks[b + 1].items));
    const head = markdownCells(blocks[b].items);
    const n = Math.max(head.length, al.length, 1);
    const make = (src: Block, cells: Item[][]) => {
      while (cells.length < n) cells.push([]);
      return Object.assign(src, { kind: 'tr' as const, items: rowItems(cells) });
    };
    const h = make(blocks[b], head);
    h.head = true;
    h.aligns = Array.from({ length: n }, (_, c) => al[c] ?? null);
    out.push(h);
    let e = b + 2;
    // (up to a line that isn't a row, or the next table's header)
    while (row(e) && !(row(e + 1) && isSeparator(textOf(blocks[e + 1].items)))) out.push(make(blocks[e], markdownCells(blocks[e].items))), e++;
    b = e - 1;
  }
  return out;
}

/** A row as a markdown line: | a | b |, a typed | as \|. */
export function rowMarkdown(items: Item[], text: (items: Item[]) => string): string {
  const cells = cellSpans(items).map(([s, e]) => text(items.slice(s, e)).replace(/\|/g, '\\|'));
  return `| ${cells.join(' | ')} |`;
}

/** The separator line for a header's alignment. */
export function separatorLine(al: Align[], n: number): string {
  const dash = (a: Align) => (a === 'center' ? ':-:' : a === 'right' ? '--:' : a === 'left' ? ':--' : '---');
  return `| ${Array.from({ length: Math.max(1, n) }, (_, c) => dash(al[c] ?? null)).join(' | ')} |`;
}
