// Typing a drawing's note: it's edited as a little block of its own (text and math), with an
// undo of its own, then put back on the drawing. Part of the Editor (see editor.svelte.ts).

import { measureLabel, noteItems, noteText } from '../labels';
import * as C from '../config';
import { type MCursor, type Step } from '../math/latex';
import { block, ch, math, type Arrow, type Block, type Mark, type Id, type Item, type MathItem } from '../model';
import type { Editor, Pos, NoteSnap } from '../editor.svelte';
import { NOTE_B } from '../editor.svelte';

export class NoteTyping {
  constructor(private ed: Editor) {}

  // ── notes being typed ──

  /**
   * The note being typed, as a paragraph (letters and formulas) typed with the same text
   * and math code as the page: while it's open, the caret's block is NOTE_B, which stands
   * for it (see blockAt). It keeps its own undo history, and is saved as text with $…$
   * (noteText) when done.
   */
  note = $state<{ id: Id; blk: Block; from: Pos; undo: NoteSnap[]; redo: NoteSnap[]; lastKind: string; lastTime: number } | null>(null);

  /** The block at index `b`: the page's, or (NOTE_B) the note being typed. */
  blockAt(b: number): Block {
    return b === NOTE_B && this.note ? this.note.blk : this.ed.doc.blocks[b];
  }

  /** The element of the note being typed. */
  noteRoot(): HTMLElement | null {
    return this.ed.page?.querySelector<HTMLElement>('.dlabel.noting') ?? null;
  }

  /** Start typing the selected drawing's note, the caret at character `at` of its text (or at the end). */
  editNote(at?: number) {
    const d = this.ed.drawing(this.ed.styling ?? '');
    if (!d) return;
    const { items, index } = noteItems(d.label);
    this.note = { id: d.id, blk: block(items), from: { b: this.ed.b, o: this.ed.o }, undo: [], redo: [], lastKind: '', lastTime: 0 };
    this.ed.b = NOTE_B;
    this.ed.o = at === undefined ? items.length : index(at);
    this.ed.anchor = null;
    this.ed.msel = null;
    this.ed.island = null;
    this.ed.tip('note-math', 'type $ in a note to add math');
    this.ed.setMode('text');
  }

  /** Keep the note being typed and go back to its drawing. */
  commitNote() {
    const n = this.note;
    if (!n) return;
    const text = noteText(n.blk.items);
    this.endNote();
    const d = this.ed.drawing(n.id);
    if (d && d.label !== text) {
      this.ed.checkpoint();
      d.label = text;
    }
    if (n.blk.items.some((i) => i.t === 'm' && i.root.length)) this.ed.learned('note-math');
  }

  /** Drop what was typed in the note, back to its drawing. */
  private cancelNote() {
    if (this.note) this.endNote();
  }

  private endNote() {
    const n = this.note!;
    this.note = null;
    this.ed.b = Math.min(n.from.b, this.ed.doc.blocks.length - 1);
    this.ed.o = Math.min(n.from.o, this.ed.doc.blocks[this.ed.b].items.length);
    this.ed.anchor = null;
    this.ed.msel = null;
    this.ed.island = null;
    this.ed.mc = { path: [], off: 0 };
    this.ed.setMode('style');
  }

  /**
   * Keys in the note being typed: the page's own text and math keys, except where a note
   * isn't a page: Enter keeps it, Esc (with nothing selected) drops it, ↑ ↓ go to its
   * ends, and nothing leads out of it into the page.
   */
  noteKey(k: string): boolean {
    const n = this.note!;
    if (this.ed.mode === 'math') return this.ed.mathKey(k);
    const end = n.blk.items.length;
    const bare = k.replace(/^(C-)?S-/, '$1');
    switch (bare) {
      case 'Up': case 'PageUp': case 'C-Home': return this.ed.textKey(k.replace(bare, 'Home'));
      case 'Down': case 'PageDown': case 'C-End': return this.ed.textKey(k.replace(bare, 'End'));
    }
    switch (k) {
      case 'Enter': case 'S-Enter': this.commitNote(); return true;
      case 'Escape':
        if (this.ed.selection) this.ed.anchor = null;
        else this.cancelNote();
        return true;
      case 'C-a': this.ed.anchor = { b: NOTE_B, o: 0 }; this.ed.o = end; return true;
      case 'Backspace': case 'C-Backspace': if (this.ed.o === 0 && !this.ed.selection) return true; break;
      case 'Delete': case 'C-Delete': if (this.ed.o === end && !this.ed.selection) return true; break;
      // (the page's command palette, draw menu and paragraph moves are for the page)
      case 'C-k': case 'C-d': case 'A-Up': case 'A-Down': return true;
      case '\\': this.ed.checkpoint('type'); this.ed.blk.items.splice(this.ed.o, 0, ch('\\')); this.ed.o++; return true;
    }
    return this.ed.textKey(k);
  }

  /** The note's undo history: checkpoints while a note is open land here, not on the page's. */
  noteCheckpoint(kind: string) {
    const n = this.note!;
    const now = Date.now();
    if (kind === 'type' && n.lastKind === 'type' && now - n.lastTime < 1000) {
      n.lastTime = now;
      return;
    }
    n.lastKind = kind;
    n.lastTime = now;
    n.undo.push(this.noteSnap());
    if (n.undo.length > 200) n.undo.shift();
    n.redo = [];
  }

  private noteSnap(): NoteSnap {
    return { items: $state.snapshot(this.note!.blk.items) as Item[], o: this.ed.o, mode: this.ed.mode === 'math' ? 'math' : 'text', mc: $state.snapshot(this.ed.mc) as MCursor, anchor: this.ed.anchor && { ...this.ed.anchor } };
  }

  /** Step back (-1) or forward (1) through the note's history. */
  noteUndo(d: -1 | 1) {
    const n = this.note!;
    const [from, to] = d < 0 ? [n.undo, n.redo] : [n.redo, n.undo];
    const s = from.pop();
    if (!s) return this.ed.flash(d < 0 ? 'nothing to undo in this note' : 'nothing to redo in this note');
    to.push(this.noteSnap());
    n.blk.items = s.items;
    this.ed.o = s.o;
    this.ed.mc = s.mc;
    this.ed.anchor = s.anchor;
    this.ed.msel = null;
    n.lastKind = '';
    this.ed.setMode(s.mode);
  }

  /**
   * A note's size as drawn: the one being typed is measured on the page (it's drawn with
   * the page's own formulas and caret); any other, from its text.
   */
  noteSize(d: Mark | Arrow, maxW = Infinity): { w: number; h: number } {
    if (this.note?.id === d.id) {
      const el = this.noteRoot();
      if (el) {
        const r = el.getBoundingClientRect();
        return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
      }
    }
    return measureLabel(d.label, maxW);
  }

  /** Where in the note being typed a point is: like hitTest on the page. */
  noteHit(x: number, y: number): { pos: Pos; math?: { item: MathItem; id: Id | null; after: boolean } } | null {
    const root = this.noteRoot(), n = this.note;
    if (!root || !n) return null;
    const hit = document.elementsFromPoint(x, y).find((e) => root.contains(e));
    const mel = hit?.closest('.math');
    if (hit && mel && root.contains(mel)) {
      const r = this.ed.mathAt(mel, hit, x, y);
      if (r) return r;
    }
    const items = n.blk.items;
    let best = { o: items.length, d: Infinity };
    for (let o = 0; o <= items.length; o++) {
      const r = this.ed.stopRect(NOTE_B, o);
      if (!r) continue;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dy * 1000 + Math.abs(r.left - x);
      if (d < best.d) best = { o, d };
      if (o < items.length) {
        const d2 = dy * 1000 + Math.abs(r.right - x);
        if (d2 < best.d) best = { o: o + 1, d: d2 };
      }
    }
    return { pos: { b: NOTE_B, o: best.o } };
  }

  /** The drawing whose note is being typed. */
  get typingLabel(): Id | null {
    return this.note?.id ?? null;
  }
}
