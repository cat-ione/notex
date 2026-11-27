// Find and replace (ctrl+f, ctrl+h): the matches in the note, going from one to the next,
// replacing them. Part of the Editor (see editor.svelte.ts); what's searched for is ed.find.

import * as F from '../files';
import { byLine, fromDOM, relTo, type Rect } from '../geom';
import { toLatex } from '../math/latex';
import { chars, math, type Char } from '../model';
import type { Editor, FindMatch } from '../editor.svelte';
import { round } from '../editor.svelte';

export class Finder {
  constructor(private ed: Editor) {}

  // ── find ──

  /**
   * Where the search text occurs, in reading order: runs of characters within a paragraph
   * (case-insensitive), formulas whose LaTeX contains it (as a whole), and the notes on
   * drawings (where the drawing starts).
   */
  findMatches = $derived.by((): FindMatch[] => {
    const q = this.ed.find?.q.toLowerCase();
    if (!q) return [];
    const out: FindMatch[] = [];
    this.ed.doc.blocks.forEach((blk, b) => {
      // characters, a formula standing in as one character nothing matches
      const text = blk.items.map((it) => (it.t === 'c' ? it.ch : '\u0000')).join('').toLowerCase();
      const hits: FindMatch[] = [];
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) hits.push({ b, s: i, e: i + q.length });
      blk.items.forEach((it, o) => {
        if (it.t === 'm' && toLatex(it.root).toLowerCase().includes(q)) hits.push({ b, s: o, e: o + 1, math: true });
      });
      out.push(...hits.sort((x, y) => x.s - y.s));
    });
    // notes: placed by where their drawing starts (after the text there)
    const notes: FindMatch[] = [];
    for (const d of [...this.ed.doc.marks, ...this.ed.doc.arrows]) {
      if (!d.label.toLowerCase().includes(q)) continue;
      const first = 'at' in d ? d.at[0] : d.from[0];
      const pos = first ? this.ed.findItem(first) : null;
      const b = pos?.b ?? (first ? this.ed.withFrame(() => this.ed.blockOf(first)) : -1);
      if (b >= 0) notes.push({ b, s: pos?.o ?? 0, e: (pos?.o ?? 0) + 1, note: d.id });
    }
    if (notes.length) {
      const key = (m: FindMatch) => m.b * 1e6 + m.s + (m.note ? 0.5 : 0);
      out.push(...notes);
      out.sort((x, y) => key(x) - key(y));
    }
    return out;
  });

  /** Open find (with the selected text, if a word or so is selected), or focus it again. */
  /** The draw menu (ctrl+d), from text or math: at the caret, or under `under` (a button). Whether it opened. */
  openFind(replace = false) {
    const s = this.ed.selection;
    let q = this.ed.find?.q ?? this.lastFind;
    if (s && s.s.b === s.e.b && s.e.o - s.s.o <= 60) {
      const t = this.ed.doc.blocks[s.s.b].items.slice(s.s.o, s.e.o);
      if (t.every((i) => i.t === 'c')) q = t.map((i) => (i as Char).ch).join('');
    }
    this.ed.find = { q, i: 0, replace: replace || !!this.ed.find?.replace, with: this.ed.find?.with ?? this.lastReplace };
    this.findFrom();
    this.findFocus++;
  }

  /** Find `q` (from the notes list, a note found by what it says): its first match selected. */
  findText(q: string) {
    this.ed.b = 0;
    this.ed.o = 0;
    this.ed.anchor = null;
    this.ed.find = { q, i: 0, replace: false, with: this.lastReplace };
    this.findFrom();
    this.findFocus++;
  }

  /** The last replacement typed (Ctrl+H starts from it). */
  private lastReplace = '';

  setReplaceText(t: string) {
    if (this.ed.find) this.ed.find.with = t;
    this.lastReplace = t;
  }

  /** Replace the current match (text; not a formula or a drawing's note) and go on to the next. */
  replaceOne() {
    const f = this.ed.find, m = this.findMatches[f?.i ?? -1];
    if (!f || !m) return;
    if (m.math || m.note) return this.findGo(1);
    this.ed.checkpoint();
    const blk = this.ed.doc.blocks[m.b];
    blk.items.splice(m.s, m.e - m.s, ...chars(f.with ?? ''));
    this.ed.forgetBlock(blk);
    this.ed.derive(m.b, m.b);
    // on from just after what was put in
    this.ed.b = m.b;
    this.ed.o = m.s + (f.with ?? '').length;
    this.ed.anchor = null;
    this.findFrom();
    this.ed.touch();
  }

  /** Replace every match in the text (formulas and notes are left as they are). */
  replaceAll() {
    const f = this.ed.find;
    if (!f) return;
    const ms = this.findMatches.filter((m) => !m.math && !m.note);
    if (!ms.length) return this.ed.flash('nothing to replace');
    this.ed.checkpoint();
    for (const m of [...ms].reverse()) {
      const blk = this.ed.doc.blocks[m.b];
      blk.items.splice(m.s, m.e - m.s, ...chars(f.with ?? ''));
      this.ed.forgetBlock(blk);
    }
    this.ed.derive(0, Infinity);
    this.ed.anchor = null;
    this.ed.o = Math.min(this.ed.o, this.ed.blk.items.length);
    this.ed.flash(`replaced ${ms.length}`);
    this.ed.touch();
  }

  /** The last thing searched for (F3 / Ctrl+F start from it). */
  private lastFind = '';

  /** Bumped to (re)focus the find field. */
  findFocus = $state(0);

  /** The search text changed: the first match from the caret on becomes current. */
  setFindQuery(q: string) {
    if (!this.ed.find) return;
    this.ed.find.q = q;
    this.findFrom();
  }

  private findFrom() {
    const ms = this.findMatches;
    if (!this.ed.find || !ms.length) return;
    const k = ms.findIndex((m) => m.b > this.ed.b || (m.b === this.ed.b && m.e > this.ed.o));
    this.ed.find.i = k < 0 ? 0 : k;
    this.showMatch();
  }

  /** Next (1) / previous (-1) match, round the end. */
  findGo(d: 1 | -1) {
    const ms = this.findMatches;
    if (!this.ed.find || !ms.length) return;
    this.ed.find.i = (this.ed.find.i + d + ms.length) % ms.length;
    this.showMatch();
  }

  /** Select the current match (in the text), which also scrolls it into view. */
  private showMatch() {
    const m = this.findMatches[this.ed.find?.i ?? -1];
    if (!m) return;
    if (m.note) {
      const id = m.note;
      return this.ed.withFrame(() => {
        this.ed.drawings.selectDrawing(id);
        // scroll it into view
        const r = this.ed.drawings.drawingRect(id), sc = this.ed.page?.parentElement, o = this.ed.page?.getBoundingClientRect();
        if (r && sc && o) {
          const y = o.top + r.y, v = sc.getBoundingClientRect();
          if (y < v.top + 60 || y > v.bottom - 80) sc.scrollTop += y - (v.top + v.height / 3);
        }
        this.ed.touch();
      });
    }
    this.ed.withFrame(() => {
      if (this.ed.mode !== 'text') {
        if (this.ed.note) this.ed.commitNote();
        this.ed.styling = null;
        this.ed.pick = null;
        this.ed.palette = null;
        this.ed.menus.menu = null;
        this.ed.setMode('text');
      }
      // (a match in a folded section: unfolded)
      this.ed.unfoldTo(m.b);
      this.ed.b = m.b;
      this.ed.anchor = { b: m.b, o: m.s };
      this.ed.o = m.e;
      this.ed.touch();
    });
  }

  /** Close find, leaving the current match selected. */
  closeFind() {
    this.lastFind = this.ed.find?.q ?? this.lastFind;
    this.ed.find = null;
    this.ed.touch();
  }

  findHitRects(origin: DOMRect): { r: Rect; cur: boolean }[] {
    const out: { r: Rect; cur: boolean }[] = [];
    const view = this.ed.page?.parentElement?.getBoundingClientRect();
    this.findMatches.forEach((m, k) => {
      if (out.length > 400) return;
      const el = this.ed.blockEl(m.b);
      const br = el?.getBoundingClientRect();
      // only what's near the screen
      if (!br || (view && (br.bottom < view.top - 400 || br.top > view.bottom + 400))) return;
      if (m.note) {
        const el = this.ed.noteEl(m.note);
        if (el) out.push({ r: relTo(fromDOM(el.getBoundingClientRect()), origin), cur: k === this.ed.find!.i });
        return;
      }
      const ids = this.ed.doc.blocks[m.b].items.slice(m.s, m.e).map((i) => i.id);
      for (const r of byLine(this.ed.rectsOfIds(ids))) out.push({ r: relTo(r, origin), cur: k === this.ed.find!.i });
    });
    return out;
  }
}
