// Tables: rows of cells between wall characters (see tables.ts), as the editor types in them,
// moves through them and changes them. Part of the Editor (see editor.svelte.ts).

import { inlineItems } from '../paste';
import { cellSpans, emptyRow, findTables, isSeparator, isWall, markdownCells, rowItems, rowLike, structureTables, tableRowAt, wall } from '../tables';
import * as C from '../config';
import { block, chars, type Doc } from '../model';
import type { Editor, Pos } from '../editor.svelte';
import { NOTE_B, cmpPos, plainText } from '../editor.svelte';

export class Tables {
  constructor(private ed: Editor) {}

  // ── tables (row blocks with cell walls, see tables.ts) ──

  /** The table row a block is, if it is one. */
  tableRow(b = this.ed.b) {
    return tableRowAt(this.ed.doc.blocks, b);
  }

  /** A row's cells, [start, end) between its walls (null: not a row). */
  cellSpans(b: number): [number, number][] | null {
    const blk = this.ed.doc.blocks[b];
    return blk?.kind === 'tr' ? cellSpans(blk.items) : null;
  }

  /** Which cell of row `b` position `o` is in (-1: none). */
  cellAt(b: number, o: number): number {
    return this.cellSpans(b)?.findIndex(([s, e]) => o >= s && o <= e) ?? -1;
  }

  /** How many columns a table has: its header's cells. */
  private columns(table: number) {
    return Math.max(1, this.cellSpans(table)?.length ?? 0);
  }

  /** Select a cell's contents (typing replaces them), or put the caret in an empty one. */
  private toCell(b: number, [s, e]: [number, number]) {
    this.ed.b = b;
    this.ed.o = e;
    this.ed.anchor = s < e ? { b, o: s } : null;
  }

  /**
   * A position in a row moved into a cell: only before the first wall and after the last
   * are outside one; forward (`dir` 1) that's the next cell or line, back (-1) the
   * previous, and (0) the nearer.
   */
  private snapPos(pos: Pos, dir: -1 | 0 | 1 = 0): Pos {
    if (pos.b === NOTE_B) return pos;
    const spans = this.cellSpans(pos.b);
    if (!spans?.length || spans.some(([s, e]) => pos.o >= s && pos.o <= e)) return pos;
    const atStart = pos.o < spans[0][0];
    if (dir === 0 || (dir > 0 && atStart) || (dir < 0 && !atStart)) return { b: pos.b, o: atStart ? spans[0][0] : spans[spans.length - 1][1] };
    const b = pos.b + dir;
    if (b < 0 || b >= this.ed.doc.blocks.length) return { b: pos.b, o: dir > 0 ? spans[spans.length - 1][1] : spans[0][0] };
    return this.snapPos({ b, o: dir > 0 ? 0 : this.ed.doc.blocks[b].items.length }, dir);
  }

  /** A click in a row: into the cell under the pointer (its nearer end when beside its text). */
  snapClick(pos: Pos, x: number, y: number): Pos {
    const spans = this.cellSpans(pos.b);
    if (!spans) return pos;
    const td = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.td') as HTMLElement | null;
    const c = td ? Number(td.dataset.c) : -1;
    if (c >= 0 && spans[c] && td?.closest('.block')?.getAttribute('data-nx') === this.ed.doc.blocks[pos.b].id) {
      const [s, e] = spans[c];
      if (pos.o >= s && pos.o <= e) return pos;
      return { b: pos.b, o: pos.o < s ? s : e };
    }
    return this.snapPos(pos);
  }

  /** After a key: the caret in a cell (the direction the key went). */
  afterTableKey(k: string) {
    const dir = /(Right|End|Tab|Down|PageDown)$/.test(k) && !/S-Tab$/.test(k) ? 1 : /(Left|Home|Backspace|Up|PageUp)$/.test(k) || /S-Tab$/.test(k) ? -1 : 0;
    const p = this.snapPos({ b: this.ed.b, o: this.ed.o }, /(Up|Down|PageUp|PageDown)$/.test(k) ? 0 : dir);
    this.ed.b = p.b;
    this.ed.o = p.o;
    if (this.ed.anchor) this.ed.anchor = this.snapPos(this.ed.anchor);
  }

  /** When the tables were last looked over: the edits by then, and the note. */
  private tablesAt: { edits: number; doc: Doc | null } = { edits: -1, doc: null };

  /**
   * After an edit, every table whole: walls at both ends of each row, the first row of a
   * table its header, a row with fewer cells than the header given empty ones. And the
   * caret in a cell.
   */
  tidyTables() {
    if (this.ed.edits !== this.tablesAt.edits || this.ed.doc !== this.tablesAt.doc) {
      const blocks = this.ed.doc.blocks;
      for (let b = 0; b < blocks.length; b++) {
        const blk = blocks[b];
        if (blk.kind !== 'tr') continue;
        const items = blk.items;
        if (!isWall(items[0])) items.unshift(wall());
        if (items.length < 2 || !isWall(items[items.length - 1])) items.push(wall());
        if (blocks[b - 1]?.kind !== 'tr' && !blk.head) blk.head = true;
        if (blk.head) {
          const n = cellSpans(items).length;
          if ((blk.aligns?.length ?? 0) !== n) blk.aligns = Array.from({ length: n }, (_, c) => blk.aligns?.[c] ?? null);
        } else {
          const t = this.tableRow(b);
          const want = t ? this.columns(t.table) : 0;
          for (let n = cellSpans(items).length; n < want; n++) items.push(wall());
        }
      }
      this.tablesAt = { edits: this.ed.edits, doc: this.ed.doc };
    }
    if (this.ed.mode === 'text' && !this.ed.note) {
      const p = this.snapPos({ b: this.ed.b, o: this.ed.o });
      this.ed.b = p.b;
      this.ed.o = p.o;
      if (this.ed.anchor) this.ed.anchor = this.snapPos(this.ed.anchor);
    }
  }

  /**
   * Backspace at the start of the line after a table, delete at the end of the line before
   * one: an empty line goes, a line with text stays as it is (it isn't joined to a row).
   */
  tableEdgeKey(k: string): boolean {
    if (this.ed.selection || this.tableRow()) return false;
    const blk = this.ed.blk;
    if ((k === 'Backspace' || k === 'C-Backspace') && this.ed.o === 0 && this.tableRow(this.ed.b - 1)) {
      if (!blk.items.length) {
        this.ed.checkpoint();
        this.ed.doc.blocks.splice(this.ed.b, 1);
      }
      const p = this.snapPos({ b: this.ed.b - 1, o: this.ed.doc.blocks[this.ed.b - 1].items.length }, -1);
      this.ed.b = p.b;
      this.ed.o = p.o;
      return true;
    }
    if ((k === 'Delete' || k === 'C-Delete') && this.ed.o === blk.items.length && this.tableRow(this.ed.b + 1)) {
      if (!blk.items.length) {
        this.ed.checkpoint();
        this.ed.doc.blocks.splice(this.ed.b, 1);
        this.ed.o = this.snapPos({ b: this.ed.b, o: 0 }, 1).o;
      }
      return true;
    }
    return false;
  }

  /** Keys that work differently in a table cell (false: not in one, or nothing different). */
  tableKey(k: string): boolean {
    const spans = this.cellSpans(this.ed.b);
    if (!spans) return false;
    const c = spans.findIndex(([s, e]) => this.ed.o >= s && this.ed.o <= e);
    if (c < 0) return false;
    const [s, e] = spans[c];
    const sel = this.ed.selection;
    switch (k) {
      // a cell's own start and end; there already, the row's (its first cell's start, its last's end)
      case 'Home': case 'End': case 'S-Home': case 'S-End': {
        if (k.startsWith('S-')) this.ed.anchor ??= { b: this.ed.b, o: this.ed.o };
        else this.ed.anchor = null;
        const home = k.endsWith('Home');
        this.ed.o = home ? (this.ed.o === s ? spans[0][0] : s) : this.ed.o === e ? spans[spans.length - 1][1] : e;
        this.ed.goalX = null;
        return true;
      }
      // out of the table at the end of the note: ↓ from its last row (→ from its last cell's
      // end) makes a line under it to go on in
      case 'Down': case 'Right': {
        const last = this.ed.b === this.ed.doc.blocks.length - 1;
        if (!last || (k === 'Right' && (this.ed.o !== e || c !== spans.length - 1)) || sel) return false;
        this.ed.checkpoint();
        this.ed.doc.blocks.push(block());
        this.ed.b++;
        this.ed.o = 0;
        this.ed.goalX = null;
        return true;
      }
      // a word at a time, within the cell: at its end (or start), on to the next cell (or
      // the one before); selecting, it stops there, rather than taking the cells after it
      case 'C-Right': case 'C-S-Right': case 'C-Left': case 'C-S-Left': {
        const dir = k.endsWith('Right') ? 1 : -1, shift = k.includes('S-');
        const edge = dir > 0 ? e : s;
        if (this.ed.o === edge) {
          if (shift) return true;
          const next = spans[c + dir];
          if (!next) return false;
          this.ed.moveTo({ b: this.ed.b, o: dir > 0 ? next[0] : next[1] }, false);
          return true;
        }
        const p = this.ed.wordPos(dir);
        this.ed.moveTo({ b: this.ed.b, o: p.b !== this.ed.b ? edge : dir > 0 ? Math.min(e, p.o) : Math.max(s, p.o) }, shift);
        return true;
      }
      // the walls stay: at a cell's start backspace does nothing (an empty last row goes)
      case 'Backspace': case 'C-Backspace': {
        if (sel) return false;
        if (this.ed.o > s) {
          if (k === 'Backspace') return false;
          const p = this.ed.wordPos(-1);
          const to = p.b === this.ed.b ? Math.max(s, p.o) : s;
          this.ed.checkpoint();
          this.ed.blk.items.splice(to, this.ed.o - to);
          this.ed.o = to;
          return true;
        }
        const row = this.tableRow()!;
        if (c === 0 && row.role === 'body' && row.last && spans.every(([a, z]) => a === z)) {
          this.ed.checkpoint();
          this.ed.doc.blocks.splice(this.ed.b, 1);
          this.ed.b--;
          const cs = this.cellSpans(this.ed.b)!;
          this.ed.o = cs[cs.length - 1][1];
        }
        return true;
      }
      case 'Delete': case 'C-Delete': {
        if (sel) return false;
        if (this.ed.o < e) {
          if (k === 'Delete') return false;
          const p = this.ed.wordPos(1);
          const to = p.b === this.ed.b ? Math.min(e, p.o) : e;
          this.ed.checkpoint();
          this.ed.blk.items.splice(this.ed.o, to - this.ed.o);
          return true;
        }
        return true;
      }
    }
    return false;
  }

  /** Tab / shift+tab in a table: the next / previous cell; past the last cell, a new row. */
  tableTab(dir: 1 | -1): boolean {
    const row = this.tableRow();
    if (!row) return false;
    const spans = this.cellSpans(this.ed.b)!;
    const pos = this.ed.selection ? this.ed.selection.s.o : this.ed.o;
    const at = Math.max(0, spans.findIndex(([s, e]) => pos >= s && pos <= e));
    if (spans[at + dir]) return this.toCell(this.ed.b, spans[at + dir]), true;
    const other = this.tableRow(this.ed.b + dir);
    if (other?.table === row.table) {
      const cs = this.cellSpans(this.ed.b + dir)!;
      return this.toCell(this.ed.b + dir, dir > 0 ? cs[0] : cs[cs.length - 1]), true;
    }
    if (dir > 0) this.addRow(this.ed.b, this.columns(row.table));
    return true;
  }

  /** A new empty row of `n` cells after block `b`, the caret in its first cell. */
  private addRow(b: number, n: number) {
    this.ed.checkpoint();
    this.ed.doc.blocks.splice(b + 1, 0, emptyRow(n));
    this.toCell(b + 1, this.cellSpans(b + 1)![0]);
  }

  /**
   * Enter in a table: a new row under this one, always (empty rows stay: it's a table, not a
   * list). Out of it is ↓ from its last row (see tableKey).
   */
  tableEnter(): boolean {
    const row = this.tableRow();
    if (!row) return false;
    this.ed.doc.blocks.splice(this.ed.b + 1, 0, emptyRow(this.columns(row.table)));
    this.ed.b++;
    this.ed.o = this.cellSpans(this.ed.b)![0][0];
    return true;
  }

  /** Enter after a markdown table's header and separator typed out: they become a table. */
  typedTable(): boolean {
    const blk = this.ed.blk, prev = this.ed.doc.blocks[this.ed.b - 1];
    if (blk.kind !== 'p' || prev?.kind !== 'p' || !isSeparator(plainText(blk.items)) || !rowLike(plainText(prev.items))) return false;
    const [head] = structureTables([prev, blk]);
    if (head?.kind !== 'tr') return false;
    this.ed.doc.blocks.splice(this.ed.b - 1, 2, head, emptyRow(cellSpans(head.items).length));
    this.ed.b = this.ed.b;
    this.ed.o = this.cellSpans(this.ed.b)![0][0];
    this.ed.anchor = null;
    return true;
  }

  /** A table to start from (\table, the toolbar): two columns, the first header selected. */
  insertTable() {
    if (this.ed.mode !== 'text' || this.ed.note) return;
    this.ed.checkpoint();
    this.ed.anchor = null;
    const head = block(rowItems([chars('column'), chars('column')]), 'tr');
    head.head = true;
    head.aligns = [null, null];
    const here = this.ed.blk;
    const at = here.kind === 'p' && !here.items.length ? this.ed.b : this.ed.b + 1;
    this.ed.doc.blocks.splice(at, at === this.ed.b ? 1 : 0, head, emptyRow(2));
    this.toCell(at, this.cellSpans(at)![0]);
  }

  /**
   * The cells a selection covers, as in a word processor: from one cell of a table to
   * another, every cell in between (rows by columns). Null: not across cells of a table.
   */
  get cellSelection(): { table: number; rows: [number, number]; cols: [number, number] } | null {
    const r = this.ed.selection;
    if (!r) return null;
    const a = this.tableRow(r.s.b), z = this.tableRow(r.e.b);
    if (!a || !z || a.table !== z.table) return null;
    const ca = this.cellAt(r.s.b, r.s.o), cz = this.cellAt(r.e.b, r.e.o);
    if (r.s.b === r.e.b && ca === cz) return null;
    return { table: a.table, rows: [r.s.b, r.e.b], cols: [Math.min(ca, cz), Math.max(ca, cz)] };
  }

  /** Change the table at the caret: add or remove a row or column, or align a column. */
  tableCommand(what: 'row+' | 'row-' | 'col+' | 'col-' | 'left' | 'center' | 'right' | 'table-') {
    const row = this.tableRow();
    if (!row) return this.ed.flash('not in a table');
    const c = Math.max(0, this.cellAt(this.ed.b, this.ed.o));
    let last = row.table;
    while (this.tableRow(last + 1)?.table === row.table) last++;
    this.ed.checkpoint();
    this.ed.anchor = null;
    if (what === 'table-') {
      // (an empty line where it was: the caret there, nothing joined)
      this.ed.doc.blocks.splice(row.table, last - row.table + 1, block());
      this.ed.b = row.table;
      this.ed.o = 0;
      return;
    }
    const head = this.ed.doc.blocks[row.table];
    if (what === 'row+') return this.addRow(this.ed.b, this.columns(row.table));
    if (what === 'row-') {
      if (row.role === 'head') return this.ed.flash('the header row stays (delete the whole table by selecting it)');
      this.ed.doc.blocks.splice(this.ed.b, 1);
      this.ed.b = Math.min(this.ed.b, last - 1);
      this.ed.o = this.cellSpans(this.ed.b)![0][0];
      return;
    }
    if (what === 'col+' || what === 'col-') {
      if (what === 'col-' && this.columns(row.table) <= 1) return this.ed.flash('a table keeps one column');
      for (let b = row.table; b <= last; b++) {
        const items = this.ed.doc.blocks[b].items;
        const spans = cellSpans(items);
        const [s, e] = spans[Math.min(c, spans.length - 1)];
        if (what === 'col+') items.splice(e + 1, 0, wall());
        else items.splice(s - 1, e - s + 1);
      }
      if (what === 'col+') head.aligns = [...(head.aligns ?? []).slice(0, c + 1), null, ...(head.aligns ?? []).slice(c + 1)];
      else head.aligns = (head.aligns ?? []).filter((_, k) => k !== c);
      const spans = this.cellSpans(this.ed.b)!;
      this.ed.o = spans[Math.min(what === 'col+' ? c + 1 : c, spans.length - 1)][0];
      return;
    }
    const al = [...(head.aligns ?? [])];
    al[c] = what;
    head.aligns = al;
  }

  /**
   * A selection touching a table, deleted (true when this handled it): the cells it covers
   * empty (as in a word processor, the walls stay); text around it goes as usual, without
   * joining a line to a row; a table it covers whole, from before it to after it, goes.
   */
  clearCells(r: { s: Pos; e: Pos }, cs: Tables['cellSelection']): boolean {
    const rows = findTables(this.ed.doc.blocks);
    let touches = false;
    for (let b = r.s.b; b <= r.e.b; b++) if (rows.has(b)) touches = true;
    if (!touches) return false;
    if (r.s.b === r.e.b && rows.has(r.s.b) && this.cellAt(r.s.b, r.s.o) === this.cellAt(r.e.b, r.e.o)) return false;
    const whole = new Set<number>();
    for (const [b, row] of rows) {
      if (row.role !== 'head') continue;
      let last = b;
      while (rows.get(last + 1)?.table === b) last++;
      // (from its first cell's start to its last cell's end: the caret can't go past the walls)
      const first = cellSpans(this.ed.doc.blocks[b].items)[0], end = cellSpans(this.ed.doc.blocks[last].items).at(-1);
      if (cmpPos(r.s, { b, o: first?.[0] ?? 0 }) <= 0 && cmpPos(r.e, { b: last, o: end?.[1] ?? this.ed.doc.blocks[last].items.length }) >= 0) whole.add(b);
    }
    const kept = (b: number) => rows.has(b) && !whole.has(rows.get(b)!.table);
    // (ends in a table that goes whole: from its first row's start, to its last row's end)
    const gone = (b: number) => rows.has(b) && !kept(b);
    if (gone(r.s.b)) r = { ...r, s: { b: r.s.b, o: 0 } };
    if (gone(r.e.b)) r = { ...r, e: { b: r.e.b, o: this.ed.doc.blocks[r.e.b].items.length } };
    if (![...Array(r.e.b - r.s.b + 1)].some((_, i) => kept(r.s.b + i)) && !gone(r.s.b) && !gone(r.e.b)) return false;
    // which columns: within one table, those between the ends; from outside it, all
    const cols = (b: number): [number, number] => (cs && rows.get(b)?.table === cs.table ? cs.cols : [0, Infinity]);
    let caret: Pos | null = null;
    let b = r.e.b;
    while (b >= r.s.b) {
      if (kept(b)) {
        const items = this.ed.doc.blocks[b].items;
        const [c0, c1] = cols(b);
        const spans = cellSpans(items);
        for (let c = Math.min(c1, spans.length - 1); c >= c0; c--) {
          const [s, e] = spans[c];
          if (e > s) items.splice(s, e - s);
        }
        caret = { b, o: cellSpans(items)[Math.min(c0, spans.length - 1)][0] };
        b--;
        continue;
      }
      let a = b;
      while (a > r.s.b && !kept(a - 1)) a--;
      const first = this.ed.doc.blocks[a], last = this.ed.doc.blocks[b];
      const so = a === r.s.b ? r.s.o : 0, eo = b === r.e.b ? r.e.o : last.items.length;
      first.items.splice(so, Infinity, ...last.items.slice(eo));
      // (a table's row whose table went: what's left of the lines is a paragraph)
      if (gone(a)) {
        first.kind = 'p';
        delete first.head;
        delete first.aligns;
      }
      if (b > a) this.ed.doc.blocks.splice(a + 1, b - a);
      if (a === r.s.b) caret = { b: a, o: so };
      b = a - 1;
    }
    const p = this.snapPos(caret ?? r.s, 1);
    this.ed.b = p.b;
    this.ed.o = p.o;
    return true;
  }

  /** A markdown table pasted onto a line: a table between the line's halves (true if it was one). */
  pasteTable(text: string): boolean {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2 || !lines.every(rowLike) || !isSeparator(lines[1])) return false;
    const blk = this.ed.blk;
    const tail = blk.items.splice(this.ed.o);
    const rows = structureTables(lines.map((l) => block(inlineItems(l.trim()))));
    const at = blk.items.length ? this.ed.b + 1 : this.ed.b;
    this.ed.doc.blocks.splice(at, blk.items.length ? 0 : 1, ...rows, ...(tail.length ? [block(tail)] : []));
    const lastRow = at + rows.length - 1;
    const cs = this.cellSpans(lastRow)!;
    this.ed.b = lastRow;
    this.ed.o = cs[cs.length - 1][1];
    this.ed.touch();
    return true;
  }

  /** Paste in a cell: a pasted table's rows go in as rows under this one, else one line of text. */
  pasteInTable(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const row = this.tableRow()!;
    if (lines.length > 1 && lines.every(rowLike)) {
      const n = this.columns(row.table);
      const rows = lines
        .filter((l) => !isSeparator(l))
        .map((l) => {
          const cells = markdownCells(inlineItems(l.trim())).slice(0, Math.max(n, 1));
          while (cells.length < n) cells.push([]);
          return block(rowItems(cells), 'tr');
        });
      this.ed.doc.blocks.splice(this.ed.b + 1, 0, ...rows);
      this.ed.b += rows.length;
      this.ed.o = this.cellSpans(this.ed.b)![0][0];
      return this.ed.touch();
    }
    const items = inlineItems(text.replace(/\s*\r?\n\s*/g, ' ').replace(/\t/g, ' '));
    this.ed.blk.items.splice(this.ed.o, 0, ...items);
    this.ed.o += items.length;
    this.ed.touch();
  }

  /** The welcome note, as it comes (a new copy: one made your own is kept as it is). */
}
