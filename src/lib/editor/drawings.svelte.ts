// Drawings on the note: choosing what an arrow or a mark goes on (by keys or a click), making
// them, moving their ends, and what can be done to one once it's selected. Part of the Editor
// (see editor.svelte.ts).

import { defaultBend, nextSide, sideName } from '../arrows';
import { MARK_KINDS } from '../marks';
import * as L from '../library';
import * as C from '../config';
import { type Rect } from '../geom';
import * as M from '../math/edit';
import { type MCursor } from '../math/latex';
import { block, cmd, isFigure, math, sym, uid, type Attach, type Arrow, type Mark, type MarkKind, type Id, type MathItem } from '../model';
import type { Editor, Loc, Pos, DrawingAction } from '../editor.svelte';
import { isSpace, findNode, round, groups, MARK_VERB, nextInk, cmpLoc } from '../editor.svelte';

export class Drawings {
  constructor(private ed: Editor) {}

  // ───────────────────────── arrows ─────────────────────────

  /** Targets at the top level, in reading order: words and top-level math groups. */
  level0(): Loc[] {
    const out: Loc[] = [];
    this.ed.doc.blocks.forEach((blk, b) => {
      if (isFigure(blk.kind)) out.push({ k: 'block', b }); // an image, then its caption's words
      let s = -1;
      blk.items.forEach((it, o) => {
        if (it.t === 'c' && !/\s/.test(it.ch)) {
          if (s < 0) s = o;
          return;
        }
        if (s >= 0) out.push({ k: 'word', b, s, e: o - 1 }), (s = -1);
        if (it.t === 'm') {
          if (!it.root.length) out.push({ k: 'item', b, o });
          for (const [i, j] of groups(it.root)) out.push({ k: 'node', b, o, path: [], i, j });
        }
      });
      if (s >= 0) out.push({ k: 'word', b, s, e: blk.items.length - 1 });
    });
    return out;
  }

  anchorIds(l: Loc): Id[] {
    const blk = this.ed.doc.blocks[l.b];
    if (!blk) return [];
    switch (l.k) {
      case 'block': return [blk.id];
      case 'word': return blk.items.slice(l.s, l.e + 1).map((i) => i.id);
      case 'ids': return l.ids;
      case 'item': return [blk.items[l.o].id];
      case 'node': {
        const m = blk.items[l.o] as MathItem;
        return M.nodeIds(M.rowAt(m.root, l.path), l.i, l.j);
      }
    }
  }

  private locFromCursor(): Loc {
    const blk = this.ed.blk;
    const it = blk.items[this.ed.o];
    if (it?.t === 'm') return { k: 'item', b: this.ed.b, o: this.ed.o };
    if (it && !isSpace(it)) {
      let s = this.ed.o, e = this.ed.o;
      while (s > 0 && blk.items[s - 1].t === 'c' && !isSpace(blk.items[s - 1])) s--;
      while (e < blk.items.length - 1 && blk.items[e + 1].t === 'c' && !isSpace(blk.items[e + 1])) e++;
      return { k: 'word', b: this.ed.b, s, e };
    }
    const l0 = this.level0();
    return l0.find((l) => l.b >= this.ed.b) ?? l0[0] ?? { k: 'block', b: this.ed.b };
  }

  /** A Loc for a text selection, trimmed of surrounding spaces. */
  private locFromSelection(r: { s: Pos; e: Pos } | null): Loc | null {
    if (!r) return null;
    const ids: Id[] = [];
    for (let b = r.s.b; b <= r.e.b; b++) {
      const items = this.ed.doc.blocks[b].items;
      const from = b === r.s.b ? r.s.o : 0, to = b === r.e.b ? r.e.o : items.length;
      ids.push(...items.slice(from, to).filter((i) => !isSpace(i)).map((i) => i.id));
    }
    if (!ids.length) return null;
    if (r.s.b === r.e.b) {
      const items = this.ed.doc.blocks[r.s.b].items;
      let s = r.s.o, e = r.e.o - 1;
      while (s < e && isSpace(items[s])) s++;
      while (e > s && isSpace(items[e])) e--;
      return { k: 'word', b: r.s.b, s, e };
    }
    return { k: 'ids', b: r.s.b, ids };
  }

  /** True while editing a formula (also with a menu open on top of it). */
  get inFormula(): boolean {
    return this.ed.mode === 'math' || ((this.ed.mode === 'palette' || this.ed.mode === 'hint') && this.ed.prevMode === 'math');
  }

  /** What a drawing command acts on right away: the math selection or the text selection. */
  private drawTarget(): Loc | null {
    if (this.ed.prevMode === 'math' && this.ed.mathItem) {
      const r = this.ed.msel !== null && this.ed.msel !== this.ed.mc.off ? M.alignRange(M.rowAt(this.ed.mathItem.root, this.ed.mc.path), Math.min(this.ed.msel, this.ed.mc.off), Math.max(this.ed.msel, this.ed.mc.off)) : null;
      this.ed.msel = null;
      // afterwards, continue typing after the selection
      if (r && this.ed.drawReturn) this.ed.drawReturn.mc.off = r[1];
      return r ? { k: 'node', b: this.ed.b, o: this.ed.o, path: [...this.ed.mc.path], i: r[0], j: r[1] - 1 } : null;
    }
    return this.locFromSelection(this.ed.cmdSel ?? this.ed.selection);
  }

  /** Where picking starts: the piece of formula at the caret, or the word at the caret. */
  private pickStart(): Loc {
    const item = this.ed.prevMode === 'math' ? this.ed.mathItem : null;
    if (!item) return this.locFromCursor();
    const row = M.rowAt(item.root, this.ed.mc.path);
    const gs = groups(row);
    const off = this.ed.mc.off;
    // the thing just typed (left of the caret), else the one after it
    const g = gs.find(([i, j]) => off - 1 >= i && off - 1 <= j) ?? gs.find(([i]) => i >= off);
    return g ? { k: 'node', b: this.ed.b, o: this.ed.o, path: [...this.ed.mc.path], i: g[0], j: g[1] } : { k: 'item', b: this.ed.b, o: this.ed.o };
  }

  /** Remember the formula position so finishing the drawing goes back into it. */
  noteDrawReturn() {
    this.ed.drawReturn = this.ed.prevMode === 'math' && this.ed.mathItem ? { b: this.ed.b, o: this.ed.o, mc: $state.snapshot(this.ed.mc) as MCursor } : null;
  }

  /** Leave pick/style mode: back into the formula a drawing was started from, or to text. */
  endDrawing() {
    this.ed.styling = null;
    this.ed.pick = null;
    const r = this.ed.drawReturn;
    this.ed.drawReturn = null;
    const it = r && this.ed.doc.blocks[r.b]?.items[r.o];
    if (r && it?.t === 'm') {
      this.ed.b = r.b;
      this.ed.o = r.o;
      try {
        M.rowAt(it.root, r.mc.path);
        this.ed.mc = r.mc;
      } catch {
        this.ed.mc = { path: [], off: it.root.length };
      }
      this.ed.setMode('math');
    } else this.ed.setMode('text');
  }

  startArrow() {
    this.noteDrawReturn();
    const sel = this.drawTarget();
    this.ed.anchor = null;
    if (sel) {
      // Start at the selection and suggest the next thing after it as the end.
      const ids = this.anchorIds(sel);
      const l0 = this.level0();
      const next = l0.find((l) => cmpLoc(l, sel) > 0 && !this.anchorIds(l).some((i) => ids.includes(i)));
      this.ed.pick = { phase: 'to', from: sel, loc: next ?? l0[0] ?? sel, purpose: 'arrow' };
      this.ed.setMode('pick');
      this.ed.flash("choose the arrow's end");
      return;
    }
    this.ed.pick = { phase: 'from', loc: this.pickStart(), purpose: 'arrow' };
    this.ed.setMode('pick');
    this.ed.flash("choose the arrow's start");
  }

  /** Draw a shape around the selection, or choose what to draw it around. */
  startMark(kind: MarkKind) {
    this.noteDrawReturn();
    const sel = this.drawTarget();
    this.ed.anchor = null;
    if (sel) return this.addMark(kind, this.anchorIds(sel));
    this.ed.pick = { phase: 'from', loc: this.pickStart(), purpose: kind };
    this.ed.setMode('pick');
    this.ed.flash(`choose what to ${MARK_VERB[kind]}`);
  }

  private addMark(kind: MarkKind, at: Id[]) {
    if (!at.length) return;
    this.ed.checkpoint();
    const m: Mark = { id: uid(), kind, at, dash: false, label: '' };
    this.ed.lastMarkKind = kind;
    this.ed.tip('alt-shift-drag', `alt+shift+drag across text to draw a ${kind}`, 2);
    this.ed.doc.marks.push(m);
    this.ed.pick = null;
    this.selectDrawing(m.id);
  }

  /** Enter style mode for an arrow or mark. */
  selectDrawing(id: Id) {
    if (this.ed.noteEd.note) this.ed.noteEd.commitNote();
    this.ed.anchor = null;
    this.ed.hints = null;
    this.ed.palette = null;
    this.ed.menus.menu = null;
    this.ed.message = '';
    this.ed.styling = id;
    this.ed.setMode('style');
  }

  /** The mark being styled, if the selected drawing is a mark. */
  get stylingMark(): Mark | undefined {
    return this.ed.styling ? this.ed.doc.marks.find((m) => m.id === this.ed.styling) : undefined;
  }

  sameLoc(a: Loc, b: Loc) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  pickKey(k: string): boolean {
    const pk = this.ed.pick!;
    const l = pk.loc;
    const l0 = this.level0();
    const idx = l0.findIndex((x) => this.sameLoc(x, l));
    const move = (d: number) => {
      if (idx >= 0) pk.loc = l0[Math.max(0, Math.min(l0.length - 1, idx + d))];
      else if (l.k === 'node') {
        const row = M.rowAt((this.ed.doc.blocks[l.b].items[l.o] as MathItem).root, l.path);
        const gs = groups(row);
        const gi = gs.findIndex(([i]) => i === l.i);
        const [i, j] = gs[Math.max(0, Math.min(gs.length - 1, gi + d))];
        pk.loc = { ...l, i, j };
      } else if (l.k === 'item' || l.k === 'block') {
        // jump back to the nearest top-level target
        const near = l0.find((x) => x.b === l.b && (l.k === 'block' || (x as any).o === l.o));
        if (near) pk.loc = near;
      } else {
        // an arbitrary range (from a selection or a saved drawing): step to the neighbouring target
        const ids = new Set(this.anchorIds(l));
        const outside = l0.filter((x) => !this.anchorIds(x).some((i) => ids.has(i)));
        const next = d > 0 ? outside.find((x) => cmpLoc(x, l) > 0) : outside.findLast((x) => cmpLoc(x, l) < 0);
        if (next) pk.loc = next;
      }
    };
    switch (k) {
      case 'Escape':
        if (pk.edit) return this.selectDrawing(pk.edit.id), (this.ed.pick = null), true;
        this.endDrawing();
        return true;
      case 'Left': case 'h': move(-1); return true;
      case 'Right': case 'l': move(1); return true;
      case 'Down': case 'j': this.pickVertical(1); return true;
      case 'Up': case 'k': this.pickVertical(-1); return true;
      case 'S-Up': case 'A-Up': case 'K': pk.loc = this.parentLoc(l); return true;
      case 'S-Down': case 'A-Down': case 'J': pk.loc = this.childLoc(l); return true;
      case 'S-Left': case 'H': pk.loc = this.extendLoc(l, -1); return true;
      case 'S-Right': case 'L': pk.loc = this.extendLoc(l, 1); return true;
      case 'Tab': case 'f': this.ed.hintTargets(); return true;
      case 'Home': case '0': this.pickLineEdge(-1); return true;
      case 'End': case '$': this.pickLineEdge(1); return true;
      case 'C-Home': if (l0.length) pk.loc = l0[0]; return true;
      case 'C-End': if (l0.length) pk.loc = l0[l0.length - 1]; return true;
      case 'Enter': case ' ':
        if (pk.edit) this.finishRetarget(pk.edit, this.anchorIds(l));
        else if (pk.purpose !== 'arrow') this.addMark(pk.purpose, this.anchorIds(l));
        else if (pk.phase === 'from') {
          const next = l0[idx + 1] ?? l;
          this.ed.pick = { phase: 'to', from: l, loc: idx >= 0 ? next : l, purpose: 'arrow' };
          this.ed.flash("choose the arrow's end");
        } else this.finishArrow();
        return true;
    }
    return true;
  }

  /** Target for a clicked element id: a word, or the math node (grouped with its scripts). */
  locFromId(id: Id): Loc | null {
    const direct = this.level0().find((l) => this.anchorIds(l).includes(id));
    if (direct) return direct;
    for (let b = 0; b < this.ed.doc.blocks.length; b++) {
      const items = this.ed.doc.blocks[b].items;
      for (let o = 0; o < items.length; o++) {
        const it = items[o];
        if (it.t !== 'm') continue;
        if (it.id === id) return { k: 'item', b, o };
        const f = findNode(it.root, id);
        if (!f) continue;
        const g = groups(M.rowAt(it.root, f.path)).find(([i, j]) => f.i >= i && f.i <= j)!;
        return { k: 'node', b, o, path: f.path, i: g[0], j: g[1] };
      }
    }
    return null;
  }

  private parentLoc(l: Loc): Loc {
    if (l.k === 'node') {
      if (l.path.length) {
        const st = l.path[l.path.length - 1];
        const path = l.path.slice(0, -1);
        const row = M.rowAt((this.ed.doc.blocks[l.b].items[l.o] as MathItem).root, path);
        const g = groups(row).find(([i, j]) => st.i >= i && st.i <= j)!;
        return { ...l, path, i: g[0], j: g[1] };
      }
      return { k: 'item', b: l.b, o: l.o };
    }
    if (l.k === 'block') return l;
    return { k: 'block', b: l.b };
  }

  private childLoc(l: Loc): Loc {
    if (l.k === 'block') return this.level0().find((x) => x.b === l.b) ?? l;
    if (l.k === 'item') {
      const m = this.ed.doc.blocks[l.b].items[l.o] as MathItem;
      const g = groups(m.root)[0];
      return g ? { k: 'node', b: l.b, o: l.o, path: [], i: g[0], j: g[1] } : l;
    }
    if (l.k === 'node') {
      const m = this.ed.doc.blocks[l.b].items[l.o] as MathItem;
      const row = M.rowAt(m.root, l.path);
      if (l.j > l.i && row[l.i].k === 'sym' && l.i === l.j - 0) return l;
      const cands = [l.i, ...Array.from({ length: l.j - l.i }, (_, n) => l.i + 1 + n)];
      for (const i of cands) {
        const n = row[i];
        if (n.k !== 'cmd') continue;
        const s = n.slots.findIndex((sl) => sl.length);
        if (s < 0) continue;
        const g = groups(n.slots[s])[0];
        return { ...l, path: [...l.path, { i, s }], i: g[0], j: g[1] };
      }
    }
    return l;
  }

  /**
   * Where a dragged shape end is (window point): the piece of the same formula row, or
   * the word of the same paragraph, nearest to it (on the nearest line, then sideways),
   * so it follows the mouse along the shape, below or beside the text.
   */
  resizeTargetAt(fixed: Loc, x: number, y: number): Loc | null {
    let cands: Loc[] = [];
    if (fixed.k === 'word') cands = this.wordsIn(fixed.b);
    else if (fixed.k === 'node') {
      const row = M.rowAt((this.ed.doc.blocks[fixed.b].items[fixed.o] as MathItem).root, fixed.path);
      cands = groups(row).map(([i, j]) => ({ ...fixed, i, j }));
    }
    let best: Loc | null = null, bestD = Infinity;
    for (const c of cands) {
      const r = this.ed.rectOfIds(this.anchorIds(c));
      if (!r) continue;
      const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      // a display formula's pieces share one line: only sideways counts there
      const d = (fixed.k === 'node' ? 0 : dy * 1000) + dx;
      if (d < bestD) (bestD = d), (best = c);
    }
    return best;
  }

  /** The words of a block (as pick targets). */
  wordsIn(b: number): Extract<Loc, { k: 'word' }>[] {
    return this.level0().filter((x): x is Extract<Loc, { k: 'word' }> => x.k === 'word' && x.b === b);
  }

  /** The first / last single target (a word, a math group) of a range. */
  edgeUnit(l: Loc, end: 'start' | 'end'): Loc {
    if (l.k === 'word') {
      const ws = this.wordsIn(l.b).filter((w) => w.s >= l.s && w.e <= l.e);
      return (end === 'start' ? ws[0] : ws[ws.length - 1]) ?? l;
    }
    if (l.k === 'node') {
      const gs = groups(M.rowAt((this.ed.doc.blocks[l.b].items[l.o] as MathItem).root, l.path));
      const g = gs.find(([i, j]) => (end === 'start' ? l.i : l.j) >= i && (end === 'start' ? l.i : l.j) <= j);
      return g ? { ...l, i: g[0], j: g[1] } : l;
    }
    return l;
  }

  /**
   * The range from one target to another: words of one block (no math between them),
   * or pieces of one formula (in the deepest row holding both; an end inside a structure
   * stands for the structure). Null when they can't make one range.
   */
  spanLoc(a: Loc, b: Loc): Loc | null {
    if (a.k === 'word' && b.k === 'word' && a.b === b.b) {
      const s = Math.min(a.s, b.s), e = Math.max(a.e, b.e);
      return this.ed.doc.blocks[a.b].items.slice(s, e + 1).some((i) => i.t === 'm') ? null : { k: 'word', b: a.b, s, e };
    }
    if (a.k === 'node' && b.k === 'node' && a.b === b.b && a.o === b.o) {
      let d = 0;
      while (d < a.path.length && d < b.path.length && a.path[d].i === b.path[d].i && a.path[d].s === b.path[d].s) d++;
      const path = a.path.slice(0, d);
      const gs = groups(M.rowAt((this.ed.doc.blocks[a.b].items[a.o] as MathItem).root, path));
      const span = (l: typeof a): [number, number] => (l.path.length > d ? [l.path[d].i, l.path[d].i] : [l.i, l.j]);
      const lo = Math.min(span(a)[0], span(b)[0]), hi = Math.max(span(a)[1], span(b)[1]);
      const gi = gs.find(([x, y]) => lo >= x && lo <= y), gj = gs.find(([x, y]) => hi >= x && hi <= y);
      return gi && gj ? { k: 'node', b: a.b, o: a.o, path, i: gi[0], j: gj[1] } : null;
    }
    return null;
  }

  /** Move one end of a shape by one target: out (grow) or in (shrink, down to one target). */
  private resizeMark(m: Mark, end: 'start' | 'end', d: 1 | -1) {
    const l = this.locForIds(m.at);
    let next: Loc | null = null;
    if (l.k === 'word') {
      const ws = this.wordsIn(l.b);
      const free = (s: number, e: number) => !this.ed.doc.blocks[l.b].items.slice(s, e + 1).some((i) => i.t === 'm');
      if (end === 'end') {
        const w = d > 0 ? ws.find((w) => w.s > l.e) : ws.findLast((w) => w.e < l.e && w.s >= l.s);
        if (w && (d < 0 || free(l.e, w.e))) next = { ...l, e: w.e };
      } else {
        const w = d < 0 ? ws.findLast((w) => w.e < l.s) : ws.find((w) => w.s > l.s && w.e <= l.e);
        if (w && (d > 0 || free(w.s, l.s))) next = { ...l, s: w.s };
      }
    } else if (l.k === 'node') {
      const gs = groups(M.rowAt((this.ed.doc.blocks[l.b].items[l.o] as MathItem).root, l.path));
      if (end === 'end') {
        const g = d > 0 ? gs.find(([i]) => i > l.j) : gs.findLast(([, j]) => j < l.j && j >= l.i);
        if (g) next = { ...l, j: g[1] };
      } else {
        const g = d < 0 ? gs.findLast(([, j]) => j < l.i) : gs.find(([i]) => i > l.i && i <= l.j);
        if (g) next = { ...l, i: g[0] };
      }
    } else return this.ed.flash("this shape can't be resized");
    if (!next) return;
    this.ed.checkpoint('style');
    m.at = this.anchorIds(next);
  }

  private extendLoc(l: Loc, d: 1 | -1): Loc {
    if (l.k === 'node') {
      const row = M.rowAt((this.ed.doc.blocks[l.b].items[l.o] as MathItem).root, l.path);
      const gs = groups(row);
      if (d === 1) {
        const g = gs.find(([i]) => i > l.j);
        return g ? { ...l, j: g[1] } : l;
      }
      const g = [...gs].reverse().find(([, j]) => j < l.i);
      return g ? { ...l, i: g[0] } : l;
    }
    if (l.k === 'word') {
      const ws = this.level0().filter((x): x is Extract<Loc, { k: 'word' }> => x.k === 'word' && x.b === l.b);
      if (d === 1) {
        const w = ws.find((w) => w.s > l.e);
        const blocked = w && this.ed.doc.blocks[l.b].items.slice(l.e + 1, w.s).some((i) => i.t === 'm');
        return w && !blocked ? { ...l, e: w.e } : l;
      }
      const w = [...ws].reverse().find((w) => w.e < l.s);
      const blocked = w && this.ed.doc.blocks[l.b].items.slice(w.e + 1, l.s).some((i) => i.t === 'm');
      return w && !blocked ? { ...l, s: w.s } : l;
    }
    return l;
  }

  /** Jump to the first / last target on the current visual line. */
  private pickLineEdge(dir: 1 | -1) {
    const pk = this.ed.pick!;
    const cur = this.ed.rectOfIds(this.anchorIds(pk.loc));
    if (!cur) return;
    const mid = cur.y + cur.h / 2;
    const onLine = this.level0()
      .map((l) => ({ l, r: this.ed.rectOfIds(this.anchorIds(l)) }))
      .filter((c): c is { l: Loc; r: Rect } => !!c.r && c.r.y <= mid && c.r.y + c.r.h >= mid);
    if (!onLine.length) return;
    onLine.sort((a, b) => (a.r.x - b.r.x) * dir);
    pk.loc = onLine[onLine.length - 1].l;
  }

  private pickVertical(dir: 1 | -1) {
    const pk = this.ed.pick!;
    const cur = this.ed.rectOfIds(this.anchorIds(pk.loc));
    if (!cur) return;
    const cx = cur.x + cur.w / 2;
    const cands = this.level0()
      .map((l) => ({ l, r: this.ed.rectOfIds(this.anchorIds(l)) }))
      .filter((c): c is { l: Loc; r: Rect } => !!c.r)
      .filter(({ r }) => (dir === 1 ? r.y + r.h / 2 > cur.y + cur.h : r.y + r.h / 2 < cur.y));
    if (!cands.length) return;
    // nearest line first, then nearest horizontally
    const lineY = dir === 1 ? Math.min(...cands.map((c) => c.r.y)) : Math.max(...cands.map((c) => c.r.y + c.r.h));
    const onLine = cands.filter(({ r }) => (dir === 1 ? r.y <= lineY + r.h / 2 : r.y + r.h >= lineY - r.h / 2));
    onLine.sort((a, b) => Math.abs(a.r.x + a.r.w / 2 - cx) - Math.abs(b.r.x + b.r.w / 2 - cx));
    pk.loc = onLine[0].l;
  }

  private finishArrow() {
    const pk = this.ed.pick!;
    const from = this.anchorIds(pk.from!);
    const to = this.anchorIds(pk.loc);
    const fr = this.ed.rectOfIds(from), tr = this.ed.rectOfIds(to);
    if (!fr || !tr || from.join() === to.join()) {
      this.ed.flash("an arrow can't start and end on the same thing");
      return;
    }
    this.ed.checkpoint();
    const a: Arrow = { id: uid(), from, to, bend: defaultBend(fr, tr), head: 'end', dash: false, boxed: false, label: '' };
    this.ed.doc.arrows.push(a);
    this.ed.pick = null;
    this.ed.tip('alt-drag', 'alt+drag between two things to draw an arrow');
    this.ed.styling = a.id;
    this.ed.setMode('style');
  }

  /** The best Loc for a set of anchor ids (so re-picking starts where the drawing is). */
  locForIds(ids: Id[]): Loc {
    const key = ids.join();
    const exact = this.level0().find((l) => this.anchorIds(l).join() === key);
    if (exact) return exact;
    const first = ids.length ? this.locFromId(ids[0]) : null;
    if (first && this.anchorIds(first).join() === key) return first;
    // several pieces of one formula (or words of one line): the range they make
    if (first && ids.length > 1) {
      let span: Loc | null = first;
      for (const id of ids.slice(1)) {
        const l = this.locFromId(id);
        span = span && l ? this.spanLoc(span, l) : null;
      }
      if (span && this.anchorIds(span).join() === key) return span;
    }
    const pos = ids.map((id) => this.ed.findItem(id));
    if (pos.length && pos.every((p) => p && p.b === pos[0]!.b)) {
      const os = pos.map((p) => p!.o);
      return { k: 'word', b: pos[0]!.b, s: Math.min(...os), e: Math.max(...os) };
    }
    return first ?? { k: 'ids', b: pos.find((p) => p)?.b ?? this.ed.b, ids };
  }

  /** Re-pick one end of an arrow, or the target of a mark. */
  retarget(id: Id, end: 'from' | 'to' | 'at') {
    const a = this.ed.doc.arrows.find((x) => x.id === id);
    const m = this.ed.doc.marks.find((x) => x.id === id);
    if (end === 'at' && m) {
      this.ed.tipLater('drag-shape', 'drag a shape to move it');
      this.ed.pick = { phase: 'from', loc: this.locForIds(m.at), purpose: m.kind, edit: { id, end } };
    } else if (a && end !== 'at') {
      const other = end === 'from' ? a.to : a.from;
      this.ed.pick = { phase: 'to', loc: this.locForIds(a[end]), from: this.locForIds(other), purpose: 'arrow', edit: { id, end } };
    } else return;
    this.ed.setMode('pick');
    this.ed.flash(end === 'at' ? 'choose the new target' : `choose the arrow's new ${end === 'from' ? 'start' : 'end'}`);
  }

  /**
   * Put a re-picked end in place. `drop`: it was dragged there, and attaches where it was
   * let go (near the target's middle: automatically); picked with the keys, a new target
   * starts out automatic.
   */
  finishRetarget(edit: { id: Id; end: 'from' | 'to' | 'at' }, ids: Id[], drop?: { at?: Attach }) {
    const a = this.ed.doc.arrows.find((x) => x.id === edit.id);
    const m = this.ed.doc.marks.find((x) => x.id === edit.id);
    if (a && edit.end !== 'at') {
      if ((edit.end === 'from' ? a.to : a.from).join() === ids.join()) return this.ed.flash("an arrow can't start and end on the same thing");
      const key = edit.end === 'from' ? 'fromAt' : 'toAt';
      const same = a[edit.end].join() === ids.join();
      const at = drop ? drop.at : same ? a[key] : undefined;
      if (same && JSON.stringify(at) === JSON.stringify(a[key])) {
        this.ed.pick = null;
        return this.selectDrawing(edit.id);
      }
      this.ed.checkpoint();
      a[edit.end] = ids;
      if (at) a[key] = at;
      else delete a[key];
    } else if (m) {
      this.ed.checkpoint();
      m.at = ids;
    }
    this.ed.pick = null;
    this.selectDrawing(edit.id);
  }

  /**
   * What can be done to a drawing: one table for its keys in style mode, the right-click
   * menu, the style palette (`\`) and the key hints, so they always agree. `menu: false`
   * keeps an entry out of the menu (a step that only makes sense repeated from the keys).
   */
  drawingActions(id: Id): DrawingAction[] {
    const a = this.ed.doc.arrows.find((x) => x.id === id);
    const m = this.ed.doc.marks.find((x) => x.id === id);
    const edit = (f: () => void) => () => { this.ed.checkpoint('style'); f(); };
    const note = (d: Arrow | Mark): DrawingAction =>
      ({ name: 'note', desc: d.label ? 'edit the note' : 'add a note', keys: ['l', 'i', '"'], run: () => this.ed.noteEd.editNote(), more: 'or double-click' });
    const remove = (f: () => void): DrawingAction =>
      ({ name: 'delete', desc: 'delete', keys: ['x', 'Delete', 'Backspace'], run: () => { this.ed.checkpoint(); f(); this.endDrawing(); }, more: 'or middle-click', sep: true });
    // a note can be moved by hand: Alt+arrows (Shift: by a pixel), Alt+0 puts it back
    const d = a ?? m;
    const placing: DrawingAction[] = d?.label
      ? [
          {
            name: 'nudge', desc: 'move the note', keys: ['A-Left', 'A-Right', 'A-Up', 'A-Down', 'A-S-Left', 'A-S-Right', 'A-S-Up', 'A-S-Down'], keyOnly: true,
            run: (k) => {
              const dir = k && /(Left|Right|Up|Down)$/.exec(k)?.[1];
              const o = dir && this.ed.noteOffset(id);
              if (!o) return;
              const step = k!.includes('S-') ? 1 : 4;
              this.ed.checkpoint('style');
              d.note = { dx: o.dx + (dir === 'Left' ? -step : dir === 'Right' ? step : 0), dy: o.dy + (dir === 'Up' ? -step : dir === 'Down' ? step : 0) };
            },
          },
          ...(d.note ? [{ name: 'autonote', desc: 'reset note position', keys: ['A-0'], run: () => { this.ed.checkpoint(); delete d.note; } }] : []),
        ]
      : [];
    const menu: DrawingAction = { name: 'menu', desc: 'show menu', keys: ['S-F10', 'ContextMenu'], run: () => this.ed.menus.openDrawingMenu(id), menu: false };
    if (a) {
      const dir = () => this.ed.arrowGeos[a.id]?.dir ?? 1;
      return [
        { name: 'bend', desc: 'bend', keys: ['Up', 'k'], run: edit(() => (a.bend = round(a.bend + 0.1 * dir()))), menu: false },
        { name: 'unbend', desc: 'bend opposite way', keys: ['Down', 'j'], run: edit(() => (a.bend = round(a.bend - 0.1 * dir()))), menu: false },
        {
          name: 'along', desc: 'shift the curve along the arrow', keys: ['Left', 'Right'], menu: false, more: 'or drag the middle handle',
          run: (k) => edit(() => {
            const s = round((a.skew ?? 0) + (k === 'Right' ? 0.1 : -0.1) * dir());
            if (Math.abs(s) < 0.03) delete a.skew;
            else a.skew = s;
          })(),
        },
        { name: 'straight', desc: 'straighten', keys: ['0', '='], run: edit(() => { a.bend = 0; delete a.skew; }) },
        { name: 'heads', desc: `arrowheads (${a.head === 'end' ? 'tip' : a.head})`, keys: ['t'], run: edit(() => (a.head = a.head === 'end' ? 'both' : a.head === 'both' ? 'none' : 'end')) },
        { name: 'reverse', desc: 'reverse', keys: ['r'], run: edit(() => { [a.from, a.to] = [a.to, a.from]; [a.fromAt, a.toAt] = [a.toAt, a.fromAt]; a.bend = -a.bend; if (a.skew) a.skew = -a.skew; if (!a.fromAt) delete a.fromAt; if (!a.toAt) delete a.toAt; }) },
        { name: 'dash', desc: a.dash ? 'solid line' : 'dashed line', keys: ['d'], run: edit(() => (a.dash = !a.dash)) },
        { name: 'boxes', desc: a.boxed ? 'unbox endpoints' : 'box endpoints', keys: ['b'], run: edit(() => (a.boxed = !a.boxed)) },
        { name: 'colour', desc: `colour (${a.color || 'default'})`, keys: ['c'], run: edit(() => (a.color = nextInk(a.color))), more: 'or shift+scroll over it' },
        note(a),
        { name: 'start', desc: 'move start', keys: ['s'], run: () => this.retarget(a.id, 'from'), more: 'or drag the start handle', sep: true },
        { name: 'tip', desc: 'move end', keys: ['e'], run: () => this.retarget(a.id, 'to'), more: 'or drag the end handle' },
        { name: 'startside', desc: `start anchor: ${sideName(a.fromAt)}`, keys: ['S'], run: edit(() => { const n = nextSide(a.fromAt); if (n) a.fromAt = n; else delete a.fromAt; }), menu: false, more: 'or drag the start handle' },
        { name: 'tipside', desc: `end anchor: ${sideName(a.toAt)}`, keys: ['E'], run: edit(() => { const n = nextSide(a.toAt); if (n) a.toAt = n; else delete a.toAt; }), menu: false, more: 'or drag the end handle' },
        ...placing,
        remove(() => this.ed.doc.arrows.splice(this.ed.doc.arrows.indexOf(a), 1)),
        menu,
      ];
    }
    if (m) {
      const shape = (d: number) => edit(() => (m.kind = MARK_KINDS[(MARK_KINDS.indexOf(m.kind) + d + MARK_KINDS.length) % MARK_KINDS.length]));
      return [
        { name: 'shape', desc: `next shape (${m.kind})`, keys: ['t', 'Right', 'Down'], run: (k) => { shape(1)(); if (k) this.ed.tip('wheel', 'scroll over a selected drawing to change it', 2); }, more: 'or scroll over it' },
        { name: 'prevshape', desc: 'previous shape', keys: ['S-t', 'T', 'Left', 'Up'], run: shape(-1), menu: false },
        { name: 'dash', desc: m.dash ? 'solid line' : 'dashed line', keys: ['d'], run: edit(() => (m.dash = !m.dash)) },
        { name: 'colour', desc: `colour (${m.color || 'default'})`, keys: ['c'], run: edit(() => (m.color = nextInk(m.color))), more: 'or shift+scroll over it' },
        note(m),
        { name: 'target', desc: 'change target', keys: ['e', 'm'], run: () => this.retarget(m.id, 'at'), more: 'or drag the shape', sep: true },
        {
          name: 'resize', desc: 'resize', keys: ['S-Right', 'S-Left', 'C-S-Left', 'C-S-Right'], keyOnly: true,
          run: (k) => k && this.resizeMark(m, k.startsWith('C-') ? 'start' : 'end', /Right$/.test(k) ? 1 : -1),
        },
        ...placing,
        remove(() => this.ed.doc.marks.splice(this.ed.doc.marks.indexOf(m), 1)),
        menu,
      ];
    }
    return [];
  }

  styleKey(k: string): boolean {
    const id = this.ed.styling;
    const acts = id ? this.drawingActions(id) : [];
    if (!acts.length) { this.ed.setMode('text'); return true; }
    switch (k) {
      case 'Escape': case 'Enter': this.endDrawing(); return true;
      case 'C-z': this.ed.styling = null; this.ed.undo(); return true;
      case 'C-y': case 'C-S-z': this.ed.styling = null; this.ed.redo(); return true;
      case '\\': case ':': this.ed.commands.openPalette('style'); return true;
    }
    acts.find((x) => x.keys.includes(k))?.run(k);
    return true;
  }

  /** A drawing's box on the page (page coordinates): a shape's bounds, an arrow's middle. */
  drawingRect(id: Id): Rect | null {
    const g = this.ed.markGeos[id];
    if (g) return g.bounds;
    const a = this.ed.arrowGeos[id];
    return a ? { x: a.mid.x - 6, y: a.mid.y - 6, w: 12, h: 12 } : null;
  }

  /** Where the palette opens (page coordinates): at the caret, or under the selected drawing. */
  get paletteAnchor(): Rect | null {
    if (this.ed.palette && this.ed.paletteAt) return this.ed.paletteAt;
    if (this.ed.caret) return this.ed.caret.r;
    return this.ed.styling ? this.drawingRect(this.ed.styling) : null;
  }
}
