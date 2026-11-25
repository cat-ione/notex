// Tables, as in markdown: lines starting with |, the second one a separator (| --- | :-: |).
// They are read from the text, like headings: rows stay ordinary paragraphs to edit, and the
// screen, the keys and the LaTeX export look them up here.

import type { Block, Item } from './model';

export type Align = 'left' | 'center' | 'right' | null;
export type TableRow = {
  /** Which table (the index of its first row's block). */
  table: number;
  /** The header row, the separator under it, or a row of the table's body. */
  role: 'head' | 'sep' | 'body';
  /** Its table's columns' alignment (from the separator). */
  aligns: Align[];
  /** The last row of its table. */
  last: boolean;
};

const textOf = (items: Item[]) => items.map((i) => (i.t === 'c' ? i.ch : '￼')).join('');

/** The first character that isn't a space ('' for a formula or nothing). */
function firstChar(items: Item[]): string {
  for (const it of items) {
    if (it.t !== 'c') return '';
    if (it.ch.trim()) return it.ch;
  }
  return '';
}

/** A line that can be a row: it starts with | (after spaces). */
export const rowLike = (text: string) => /^\s*\|/.test(text);

/** A separator line: | --- | :--: | --: | (dashes, optional colons, between pipes). */
export const isSeparator = (text: string) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(text) || /^\s*\|(\s*:?-+:?\s*\|)*\s*:?-+:?\s*$/.test(text);

/** A separator's columns' alignment. */
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
 * The rows of every table among the blocks, by block index. Only paragraphs can be rows (a
 * line in a list or a code block stays what it is).
 */
export function findTables(blocks: Block[]): Map<number, TableRow> {
  const out = new Map<number, TableRow>();
  // (only a line's first character is read: this runs as the note changes)
  const isRow = (b: number) => blocks[b]?.kind === 'p' && firstChar(blocks[b].items) === '|';
  for (let b = 0; b < blocks.length; b++) {
    if (!isRow(b) || !isRow(b + 1) || !isSeparator(textOf(blocks[b + 1].items))) continue;
    const al = aligns(textOf(blocks[b + 1].items));
    let e = b + 2;
    // (a row with a separator under it starts a table of its own: two tables stay two)
    while (isRow(e) && !(isRow(e + 1) && isSeparator(textOf(blocks[e + 1].items)))) e++;
    for (let r = b; r < e; r++) out.set(r, { table: b, role: r === b ? 'head' : r === b + 1 ? 'sep' : 'body', aligns: al, last: r === e - 1 });
    b = e - 1;
  }
  return out;
}

/**
 * The table row block `b` is, if it is one: looked up from the run of | lines around it
 * only (not the whole note, as findTables reads it), for lookups as the caret moves.
 */
export function tableRowAt(blocks: Block[], b: number): TableRow | null {
  const isRow = (k: number) => blocks[k]?.kind === 'p' && firstChar(blocks[k].items) === '|';
  if (!isRow(b)) return null;
  let s = b, e = b;
  while (isRow(s - 1)) s--;
  while (isRow(e + 1)) e++;
  const r = findTables(blocks.slice(s, e + 1)).get(b - s);
  return r ? { ...r, table: r.table + s } : null;
}

/**
 * A row's cells: [start, end) item ranges. A cell starts at its | (so the pipes line up as
 * the columns' edges); what comes before the first | is part of the first cell, and a
 * closing | is a cell of its own.
 */
export function cellRanges(items: Item[]): [number, number][] {
  const pipes: number[] = [];
  items.forEach((it, o) => it.t === 'c' && it.ch === '|' && pipes.push(o));
  if (!pipes.length) return [[0, items.length]];
  const out: [number, number][] = [];
  pipes.forEach((p, k) => out.push([k === 0 ? 0 : p, pipes[k + 1] ?? items.length]));
  return out;
}

/** The text of each cell between the pipes (for export and for new rows). */
export function cellTexts(items: Item[]): Item[][] {
  const pipes: number[] = [];
  items.forEach((it, o) => it.t === 'c' && it.ch === '|' && pipes.push(o));
  const out: Item[][] = [];
  for (let k = 0; k + 1 < pipes.length; k++) out.push(items.slice(pipes[k] + 1, pipes[k + 1]));
  // (a row typed without its closing |: its last cell runs to the end)
  const lastPipe = pipes[pipes.length - 1];
  if (lastPipe !== undefined && items.slice(lastPipe + 1).some((i) => i.t !== 'c' || i.ch.trim())) out.push(items.slice(lastPipe + 1));
  return out;
}
