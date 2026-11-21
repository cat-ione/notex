// Editor state and keyboard/mouse handling.
//
// Editing works like an ordinary editor: there is always a live caret, the
// mouse places it, Shift extends a selection, Ctrl+C/X/V work. Extra modes
// only exist for focused tasks:
//   text    — the default: typing prose; `$` starts inline math, `\` opens commands
//   math    — structural math editing inside one math item
//   pick    — choosing an arrow endpoint (arrow keys, or click)
//   style   — adjusting the arrow just drawn / selected
//   hint    — jump labels; type a label to jump (transient)
//   palette — command palette (transient)
//   label   — typing an arrow label (transient)

import { tick } from 'svelte';
import { arrowGeo, defaultBend, type ArrowGeo } from './arrows';
import { docToLatex } from './export';
import * as F from './files';
import { measure, relTo, union, type Rect } from './geom';
import * as M from './math/edit';
import { CMDS, GREEK_LEADER, MATH_PALETTE } from './math/defs';
import { parseLatex } from './math/parse';
import { toLatex, type MCursor, type Step } from './math/latex';
import { allIds, block, ch, chars, cloneRow, cmd, math, sym, uid, type Arrow, type Block, type BlockKind, type Doc, type Id, type Item, type MathItem, type MCmd, type MRow } from './model';

export type Mode = 'text' | 'math' | 'pick' | 'style' | 'hint' | 'palette' | 'label';

export type Loc =
  | { k: 'word'; b: number; s: number; e: number }
  | { k: 'item'; b: number; o: number }
  | { k: 'node'; b: number; o: number; path: Step[]; i: number; j: number }
  | { k: 'block'; b: number };

export type Pos = { b: number; o: number };

type PaletteEntry = { name: string; desc: string; run: () => void };
type Hint = { label: string; rect: Rect; act: () => void };
type Snap = { doc: Doc; b: number; o: number };

export const THEMES = ['midnight', 'phosphor', 'paper'] as const;

const STORAGE_KEY = 'notex.doc.v1';

export class Editor {
  doc = $state<Doc>({ blocks: [block()], arrows: [] });
  mode = $state<Mode>('text');
  /** Block index and item offset of the text caret (0..items.length). */
  b = $state(0);
  o = $state(0);
  /** Selection anchor; the selection spans anchor..caret. */
  anchor = $state<Pos | null>(null);
  /** Math cursor (valid in math mode; the math item is items[o]). */
  mc = $state<MCursor>({ path: [], off: 0 });

  palette = $state<{ ctx: 'math' | 'text'; query: string; sel: number } | null>(null);
  pick = $state<{ phase: 'from' | 'to'; loc: Loc; from?: Loc } | null>(null);
  styling = $state<Id | null>(null);
  hints = $state<{ list: Hint[]; typed: string } | null>(null);
  label = $state<{ text: string } | null>(null);
  message = $state('');
  showHelp = $state(false);
  theme = $state<(typeof THEMES)[number]>('midnight');

  /** The note's file (path is null for unsaved notes or in the browser). */
  file = $state<{ path: string | null; name: string }>({ path: null, name: 'untitled' });
  dirty = $state(false);
  private edits = 0;

  /** Bumped on every mutation so layout-dependent overlays recompute. */
  version = $state(0);

  // Layout results (page-relative), recomputed after each render.
  caret = $state<{ r: Rect; shape: 'bar' | 'math' } | null>(null);
  pickRects = $state<{ cur: Rect | null; from: Rect | null }>({ cur: null, from: null });
  arrowGeos = $state<Record<Id, ArrowGeo>>({});

  page: HTMLElement | null = null;

  private prevMode: Mode = 'text';
  private pending = '';
  private goalX: number | null = null;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private lastKind = '';
  private lastTime = 0;
  private msgTimer: ReturnType<typeof setTimeout> | undefined;
  private dragging = false;
  /** Last internal copy, so pasting it back keeps math intact. */
  private clip: { text: string; blocks: Item[][] } | null = null;

  constructor() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.doc = JSON.parse(saved);
      else (this.doc = welcomeDoc()), (this.file.name = 'welcome');
      const f = localStorage.getItem('notex.file');
      if (f) {
        const j = JSON.parse(f);
        this.file = { path: j.path ?? null, name: j.name ?? 'untitled' };
        this.dirty = !!j.dirty;
      }
      const t = localStorage.getItem('notex.theme');
      if (t && (THEMES as readonly string[]).includes(t)) this.theme = t as any;
    } catch {
      this.doc = welcomeDoc();
    }
  }

  // ───────────────────────── helpers ─────────────────────────

  get blk(): Block {
    return this.doc.blocks[this.b];
  }
  get mathItem(): MathItem | null {
    const it = this.blk?.items[this.o];
    return it?.t === 'm' ? it : null;
  }

  touch() {
    this.version++;
  }

  flash(msg: string) {
    this.message = msg;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.message = ''), 3500);
  }

  /** Session backup (survives reloads/crashes) plus autosave to the note's file if it has one. */
  async persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(this.doc)));
      localStorage.setItem('notex.file', JSON.stringify({ ...this.file, dirty: this.dirty }));
    } catch {}
    if (this.file.path && this.dirty) await this.writeTo(this.file.path, true);
  }

  private async writeTo(path: string, quiet = false) {
    const edits = this.edits;
    try {
      await F.writeNote(path, $state.snapshot(this.doc) as Doc);
      if (edits === this.edits) this.dirty = false;
      if (!quiet) this.flash(`saved ${F.baseName(path)}`);
      return true;
    } catch (e) {
      this.flash(String(e));
      return false;
    }
  }

  async saveNote() {
    if (this.file.path) return this.writeTo(this.file.path);
    return this.saveNoteAs();
  }

  async saveNoteAs() {
    if (!F.isDesktop()) {
      F.downloadNote(this.file.name, $state.snapshot(this.doc) as Doc);
      this.dirty = false;
      return true;
    }
    const path = await F.chooseSavePath(this.file.name);
    if (!path) return false;
    if (!(await this.writeTo(path))) return false;
    this.file = { path, name: F.baseName(path) };
    return true;
  }

  /** Untitled notes with changes would be lost; ask before replacing them. */
  private async okToReplace(): Promise<boolean> {
    if (!this.dirty || this.file.path) return true;
    const msg = `"${this.file.name}" has unsaved changes. Discard them?`;
    if (F.isDesktop()) {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return ask(msg, { title: 'notex', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Keep' });
    }
    return confirm(msg);
  }

  private load(doc: Doc, file: { path: string | null; name: string }) {
    this.doc = doc;
    this.file = file;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.b = 0;
    this.o = 0;
    this.anchor = null;
    this.pick = null;
    this.styling = null;
    this.setMode('text');
  }

  async openNote() {
    if (!(await this.okToReplace())) return;
    try {
      const r = await F.openNote();
      if (r) this.load(r.doc, { path: r.path, name: r.name });
    } catch (e) {
      this.flash(`could not open: ${e}`);
    }
  }

  async newNote() {
    if (!(await this.okToReplace())) return;
    this.load({ blocks: [block()], arrows: [] }, { path: null, name: 'untitled' });
  }

  checkpoint(kind = 'edit') {
    this.dirty = true;
    this.edits++;
    const now = Date.now();
    if (kind === 'type' && this.lastKind === 'type' && now - this.lastTime < 1000) {
      this.lastTime = now;
      return;
    }
    this.lastKind = kind;
    this.lastTime = now;
    this.undoStack.push({ doc: $state.snapshot(this.doc) as Doc, b: this.b, o: this.o });
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(from: Snap[], to: Snap[], what: string) {
    const s = from.pop();
    if (!s) return this.flash(`nothing to ${what}`);
    to.push({ doc: $state.snapshot(this.doc) as Doc, b: this.b, o: this.o });
    this.doc = s.doc;
    this.b = Math.min(s.b, this.doc.blocks.length - 1);
    this.o = Math.min(s.o, this.blk.items.length);
    this.anchor = null;
    this.lastKind = '';
    this.dirty = true;
    this.edits++;
    this.setMode('text');
    this.touch();
  }
  undo = () => this.restore(this.undoStack, this.redoStack, 'undo');
  redo = () => this.restore(this.redoStack, this.undoStack, 'redo');

  setMode(m: Mode) {
    if (m !== 'hint' && m !== 'palette' && m !== 'label') this.prevMode = m;
    if ((m === 'text' || m === 'math') && m !== this.mode) this.message = '';
    this.mode = m;
    this.touch();
  }

  private el(id: Id): Element | null {
    return this.page?.querySelector(`[data-nx="${id}"]`) ?? null;
  }

  private rectOfIds(ids: Id[]): Rect | null {
    if (!this.page) return null;
    const rs: Rect[] = [];
    for (const id of ids)
      this.page.querySelectorAll(`[data-nx="${id}"]`).forEach((e) => {
        const m = measure(e);
        if (m) rs.push(m);
      });
    return union(rs);
  }

  /** Viewport rect of the caret stop before item `o` of block `b` (or end of block). */
  private stopRect(b: number, o: number): DOMRect | null {
    const blk = this.doc.blocks[b];
    const e = o < blk.items.length ? this.el(blk.items[o].id) : this.page?.querySelector(`[data-eol="${blk.id}"]`);
    return e?.getBoundingClientRect() ?? null;
  }

  // ───────────────────────── selection ─────────────────────────

  /** Ordered selection range, or null when nothing is selected. */
  get selection(): { s: Pos; e: Pos } | null {
    const a = this.anchor;
    if (!a || (a.b === this.b && a.o === this.o)) return null;
    const c = { b: this.b, o: this.o };
    return cmpPos(a, c) < 0 ? { s: a, e: c } : { s: c, e: a };
  }

  isSelected(b: number, o: number): boolean {
    const r = this.selection;
    if (!r) return false;
    const p = { b, o };
    return cmpPos(p, r.s) >= 0 && cmpPos(p, r.e) < 0;
  }

  /** Move the caret, extending the selection when `extend` is set. */
  private moveTo(p: Pos, extend: boolean) {
    if (extend) this.anchor ??= { b: this.b, o: this.o };
    else this.anchor = null;
    this.b = p.b;
    this.o = p.o;
  }

  private selectedItems(): Item[][] {
    const r = this.selection;
    if (!r) return [];
    const out: Item[][] = [];
    for (let b = r.s.b; b <= r.e.b; b++) {
      const items = this.doc.blocks[b].items;
      out.push(items.slice(b === r.s.b ? r.s.o : 0, b === r.e.b ? r.e.o : items.length));
    }
    return out;
  }

  /** Delete the selection (if any). Returns whether something was deleted. */
  private deleteSelection(): boolean {
    const r = this.selection;
    this.anchor = null;
    if (!r) return false;
    const first = this.doc.blocks[r.s.b];
    const last = this.doc.blocks[r.e.b];
    const tail = last.items.slice(r.e.o);
    first.items.splice(r.s.o, Infinity, ...tail);
    if (r.e.b > r.s.b) this.doc.blocks.splice(r.s.b + 1, r.e.b - r.s.b);
    this.b = r.s.b;
    this.o = r.s.o;
    return true;
  }

  selectAll() {
    const last = this.doc.blocks.length - 1;
    this.anchor = { b: 0, o: 0 };
    this.b = last;
    this.o = this.doc.blocks[last].items.length;
    this.setMode('text');
  }

  // ───────────────────────── clipboard ─────────────────────────

  /** Handle a DOM copy/cut event. */
  copy(e: ClipboardEvent, cut: boolean) {
    if (this.mode !== 'text' || !this.selection) return;
    const blocks = this.selectedItems();
    const text = blocks.map((items) => itemsToText(items)).join('\n');
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
    this.clip = { text, blocks: $state.snapshot(blocks) as Item[][] };
    if (cut) {
      this.checkpoint();
      this.deleteSelection();
    }
    this.touch();
  }

  /** Handle a DOM paste event. */
  paste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (this.mode === 'math') {
      this.checkpoint();
      M.insertParsed(this.mathItem!.root, this.mc, parseLatex(text));
      this.touch();
      return;
    }
    if (this.mode !== 'text') return;
    this.checkpoint();
    this.deleteSelection();
    const blocks: Item[][] =
      this.clip && this.clip.text === text
        ? this.clip.blocks.map((items) => items.map(cloneItem))
        : text.replace(/\r\n?/g, '\n').split('\n').map(textWithMath);
    const blk = this.blk;
    const tail = blk.items.splice(this.o);
    blk.items.push(...blocks[0]);
    if (blocks.length === 1) {
      this.o += blocks[0].length;
      blk.items.push(...tail);
    } else {
      const rest = blocks.slice(1).map((items) => block(items));
      const last = rest[rest.length - 1];
      this.o = last.items.length;
      last.items.push(...tail);
      this.doc.blocks.splice(this.b + 1, 0, ...rest);
      this.b += rest.length;
    }
    this.touch();
  }

  // ───────────────────────── mouse ─────────────────────────

  /** Caret position nearest to a viewport point, or a math target if the point is on math. */
  private hitTest(x: number, y: number): { pos: Pos; math?: { item: MathItem; id: Id | null; after: boolean } } | null {
    if (!this.page) return null;
    const hit = document.elementFromPoint(x, y);
    const mel = hit?.closest('.math');
    if (mel && this.page.contains(mel)) {
      const pos = this.findItem(mel.getAttribute('data-nx')!);
      if (pos) {
        const node = hit!.closest('[data-nx]');
        const id = node && node !== mel ? node.getAttribute('data-nx') : null;
        const r = node?.getBoundingClientRect();
        return { pos, math: { item: this.doc.blocks[pos.b].items[pos.o] as MathItem, id, after: !r || x > r.left + r.width / 2 } };
      }
    }
    // Find the block under (or nearest to) y, then the nearest caret stop on that line.
    const blocks = [...this.page.querySelectorAll('.block')];
    let bi = 0, bd = Infinity;
    blocks.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bd) (bd = d), (bi = i);
    });
    const items = this.doc.blocks[bi]?.items;
    if (!items) return null;
    let best = { o: items.length, d: Infinity };
    for (let o = 0; o <= items.length; o++) {
      const r = this.stopRect(bi, o);
      if (!r) continue;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dy * 1000 + Math.abs(r.left - x);
      if (d < best.d) best = { o, d };
      // the right edge of the last item on a line is also a stop
      if (o < items.length) {
        const d2 = dy * 1000 + Math.abs(r.right - x);
        if (d2 < best.d) best = { o: o + 1, d: d2 };
      }
    }
    return { pos: { b: bi, o: best.o } };
  }

  private findItem(id: Id): Pos | null {
    for (let b = 0; b < this.doc.blocks.length; b++) {
      const o = this.doc.blocks[b].items.findIndex((i) => i.id === id);
      if (o >= 0) return { b, o };
    }
    return null;
  }

  mouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (this.mode === 'pick') {
      const id = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
      const loc = id ? this.locFromId(id) : null;
      if (loc) {
        this.pick!.loc = loc;
        this.pickKey('Enter');
      }
      this.touch();
      return;
    }
    const h = this.hitTest(e.clientX, e.clientY);
    if (!h) return;
    if (this.mode === 'palette') this.closePalette();
    this.styling = null;
    this.hints = null;
    this.label = null;
    if (h.math && !e.shiftKey) {
      this.anchor = null;
      this.b = h.pos.b;
      this.o = h.pos.o;
      const found = h.math.id ? findNode(h.math.item.root, h.math.id) : null;
      this.mc = found
        ? { path: found.path, off: found.i + (h.math.after ? 1 : 0) }
        : { path: [], off: h.math.after ? h.math.item.root.length : 0 };
      this.setMode('math');
      return;
    }
    this.moveTo(h.pos, e.shiftKey);
    if (!e.shiftKey) this.anchor = { ...h.pos };
    this.dragging = true;
    this.goalX = null;
    this.setMode('text');
  }

  mouseMove(e: MouseEvent) {
    if (!this.dragging) return;
    const h = this.hitTest(e.clientX, e.clientY);
    if (!h) return;
    // Dragging over math selects the whole item.
    const forward = !this.anchor || cmpPos(h.pos, this.anchor) >= 0;
    const p = h.math ? { b: h.pos.b, o: h.pos.o + (forward ? 1 : 0) } : h.pos;
    this.b = p.b;
    this.o = p.o;
    this.touch();
  }

  mouseUp() {
    this.dragging = false;
  }

  // ───────────────────────── layout ─────────────────────────

  /** Recompute every DOM-dependent overlay. Called after renders and resizes. */
  layout() {
    if (!this.page) return;
    const origin = this.page.getBoundingClientRect();
    const rel = (r: Rect | null) => (r ? relTo(r, origin) : null);

    // Caret
    const base = this.mode === 'palette' || this.mode === 'hint' || this.mode === 'label' ? this.prevMode : this.mode;
    let caret: typeof this.caret = null;
    if (base === 'math') caret = this.mathCaret(origin);
    else if (base === 'text') {
      const blk = this.blk;
      const r = this.stopRect(this.b, this.o);
      const prev = this.o > 0 ? blk.items[this.o - 1] : null;
      const pr = prev?.t === 'c' ? this.el(prev.id)?.getBoundingClientRect() : null;
      if (r) {
        // Prefer the previous char's line when wrapping put the next item on a new line.
        const nextIsMath = blk.items[this.o]?.t === 'm';
        const useprev = pr && (blk.items[this.o]?.t !== 'c' || Math.abs(pr.top - r.top) > 4);
        const x = useprev ? pr!.right : r.left;
        const h = useprev ? pr!.height : nextIsMath ? 22 : r.height;
        const y = useprev ? pr!.top : nextIsMath ? r.top + r.height / 2 - h / 2 : r.top;
        caret = { r: relTo({ x, y, w: 2, h }, origin), shape: 'bar' };
      }
    }
    this.caret = caret;

    // Pick highlights
    if (this.pick) {
      this.pickRects = {
        cur: rel(this.rectOfIds(this.anchorIds(this.pick.loc))),
        from: this.pick.from ? rel(this.rectOfIds(this.anchorIds(this.pick.from))) : null,
      };
    } else this.pickRects = { cur: null, from: null };

    // Arrows
    const geos: Record<Id, ArrowGeo> = {};
    for (const a of this.doc.arrows) {
      const fa = rel(this.rectOfIds(a.from));
      const ta = rel(this.rectOfIds(a.to));
      if (!fa || !ta) continue;
      const g = arrowGeo(fa, ta, a.bend);
      if (g) geos[a.id] = g;
    }
    this.arrowGeos = geos;

    // Keep the caret in view
    this.page.querySelector('.caret')?.scrollIntoView({ block: 'nearest' });
  }

  private mathCaret(origin: DOMRect): typeof this.caret {
    const item = this.mathItem;
    if (!item) return null;
    const mel = this.el(item.id);
    const cel = mel?.querySelector('.nx-caret');
    if (!mel || !cel) return null;
    const row = M.rowAt(item.root, this.mc.path);
    const next = row[this.mc.off];
    let x = cel.getBoundingClientRect().left;
    if (next?.k === 'cmd' && CMDS[next.name]?.script && this.mc.off > 0) {
      const r = this.rectOfIds([next.id]);
      if (r) x = r.x;
    }
    const neighbour = row[this.mc.off - 1] ?? next;
    let v = neighbour ? this.rectOfIds([neighbour.id]) : null;
    if (!v) {
      const empty = mel.querySelector('.nx-active-row .nx-empty') ?? mel.querySelector('.nx-empty');
      v = empty ? measure(empty) : measure(mel);
    }
    if (!v) return null;
    return { r: relTo({ x: x - 1, y: v.y, w: 2, h: Math.max(v.h, 14) }, origin), shape: 'math' };
  }

  // ───────────────────────── keyboard ─────────────────────────

  key(e: KeyboardEvent) {
    if (e.isComposing) return;
    const k = keyName(e);
    if (!k) return;
    // Let the browser fire copy/cut/paste events; those are handled separately.
    if (/^C-[cxv]$/.test(k)) return;
    const fileKeys: Record<string, () => unknown> = {
      'C-s': () => this.saveNote(),
      'C-S-s': () => this.saveNoteAs(),
      'C-o': () => this.openNote(),
      'C-n': () => this.newNote(),
    };
    if (fileKeys[k] && this.mode !== 'label') {
      e.preventDefault();
      fileKeys[k]();
      return;
    }
    if (k === 'F1' || k === 'C-/') {
      this.showHelp = !this.showHelp;
      e.preventDefault();
      return;
    }
    if (this.showHelp && k === 'Escape') {
      this.showHelp = false;
      e.preventDefault();
      return;
    }
    let handled = true;
    switch (this.mode) {
      case 'text': handled = this.textKey(k); break;
      case 'math': handled = this.mathKey(k); break;
      case 'pick': handled = this.pickKey(k); break;
      case 'style': handled = this.styleKey(k); break;
      case 'hint': handled = this.hintKey(k); break;
      case 'palette': handled = this.paletteKey(k); break;
      case 'label': handled = this.labelKey(k); break;
    }
    // Swallow everything except a few browser/devtools keys.
    if (handled || !/^(C-S-i|F12|C-S-r)$/.test(k)) e.preventDefault();
    this.touch();
  }

  // ── text ──

  private wordPos(dir: 1 | -1): Pos {
    let { b, o } = this;
    const items = this.doc.blocks[b].items;
    const word = (it: Item | undefined) => !!it && it.t === 'c' && !isSpace(it);
    if (dir === 1) {
      if (o >= items.length) return b < this.doc.blocks.length - 1 ? { b: b + 1, o: 0 } : { b, o };
      if (items[o].t === 'm') o++;
      else while (o < items.length && word(items[o])) o++;
      while (o < items.length && isSpace(items[o])) o++;
    } else {
      if (o === 0) return b > 0 ? { b: b - 1, o: this.doc.blocks[b - 1].items.length } : { b, o };
      while (o > 0 && isSpace(items[o - 1])) o--;
      if (o > 0 && items[o - 1].t === 'm') o--;
      else while (o > 0 && word(items[o - 1])) o--;
    }
    return { b, o };
  }

  /** Position one visual line up/down, keeping a goal column. */
  private verticalPos(dir: 1 | -1): Pos {
    const nb = this.doc.blocks.length;
    const edge = dir === 1 ? { b: nb - 1, o: this.doc.blocks[nb - 1].items.length } : { b: 0, o: 0 };
    const cur = this.stopRect(this.b, Math.min(this.o, this.blk.items.length));
    if (!cur) return edge;
    if (this.goalX === null) this.goalX = cur.left;
    const gx = this.goalX;
    let line: { top: number; bottom: number } | null = null;
    let best: { b: number; o: number; d: number } | null = null;
    outer: for (let b = this.b; b >= 0 && b < nb; b += dir) {
      const n = this.doc.blocks[b].items.length + 1;
      const order = dir === 1 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
      for (const o of order) {
        if (b === this.b && (dir === 1 ? o <= this.o : o >= this.o)) continue;
        const r = this.stopRect(b, o);
        if (!r) continue;
        const mid = r.top + r.height / 2;
        if (!line) {
          if (dir === 1 ? mid > cur.bottom - 2 : mid < cur.top + 2) line = { top: r.top, bottom: r.bottom };
          else continue;
        }
        if (mid < line.top - 1 || mid > line.bottom + 1) {
          if (dir === 1 ? r.top > line.bottom : r.bottom < line.top) break outer;
          continue;
        }
        const d = Math.abs(r.left - gx);
        if (!best || d < best.d) best = { b, o, d };
      }
    }
    return best ? { b: best.b, o: best.o } : edge;
  }

  private textKey(k: string): boolean {
    const blk = this.blk;
    const shift = k.startsWith('S-') || k.startsWith('C-S-');
    const bare = k.replace(/^(C-)?S-/, '$1');
    if (bare !== 'Up' && bare !== 'Down' && bare !== 'PageUp' && bare !== 'PageDown') this.goalX = null;

    switch (bare) {
      case 'Left': {
        const sel = this.selection;
        if (sel && !shift) return this.moveTo(sel.s, false), true;
        if (!shift && this.o > 0 && blk.items[this.o - 1].t === 'm') {
          this.o--;
          this.enterMath(true);
          return true;
        }
        const p = this.o > 0 ? { b: this.b, o: this.o - 1 } : this.b > 0 ? { b: this.b - 1, o: this.doc.blocks[this.b - 1].items.length } : null;
        if (p) this.moveTo(p, shift);
        return true;
      }
      case 'Right': {
        const sel = this.selection;
        if (sel && !shift) return this.moveTo(sel.e, false), true;
        if (!shift && blk.items[this.o]?.t === 'm') {
          this.enterMath(false);
          return true;
        }
        const p = this.o < blk.items.length ? { b: this.b, o: this.o + 1 } : this.b < this.doc.blocks.length - 1 ? { b: this.b + 1, o: 0 } : null;
        if (p) this.moveTo(p, shift);
        return true;
      }
      case 'C-Left': this.moveTo(this.wordPos(-1), shift); return true;
      case 'C-Right': this.moveTo(this.wordPos(1), shift); return true;
      case 'Up': this.moveTo(this.verticalPos(-1), shift); return true;
      case 'Down': this.moveTo(this.verticalPos(1), shift); return true;
      case 'PageUp': case 'PageDown': {
        const start = { b: this.b, o: this.o };
        for (let i = 0; i < 12; i++) {
          const p = this.verticalPos(bare === 'PageUp' ? -1 : 1);
          this.b = p.b;
          this.o = p.o;
        }
        const end = { b: this.b, o: this.o };
        this.b = start.b;
        this.o = start.o;
        this.moveTo(end, shift);
        return true;
      }
      case 'Home': this.moveTo({ b: this.b, o: 0 }, shift); return true;
      case 'End': this.moveTo({ b: this.b, o: blk.items.length }, shift); return true;
      case 'C-Home': this.moveTo({ b: 0, o: 0 }, shift); return true;
      case 'C-End': {
        const l = this.doc.blocks.length - 1;
        this.moveTo({ b: l, o: this.doc.blocks[l].items.length }, shift);
        return true;
      }
    }

    switch (k) {
      case 'Escape': this.anchor = null; return true;
      case 'C-a': this.selectAll(); return true;
      case 'C-z': this.undo(); return true;
      case 'C-y': case 'C-S-z': this.redo(); return true;
      case 'C-k': this.anchor = null; this.openPalette('text'); return true;
      case 'C-m': this.deleteSelection(); this.insertMath(false); return true;
      case 'Enter': case 'S-Enter': {
        this.checkpoint();
        this.deleteSelection();
        const b = this.blk;
        if (b.kind === 'li' && b.items.length === 0) {
          b.kind = 'p';
          return true;
        }
        const rest = b.items.splice(this.o);
        this.doc.blocks.splice(this.b + 1, 0, block(rest, b.kind === 'li' ? 'li' : 'p'));
        this.b++;
        this.o = 0;
        return true;
      }
      case 'Backspace': case 'C-Backspace': {
        if (this.selection) {
          this.checkpoint();
          this.deleteSelection();
          return true;
        }
        if (k === 'C-Backspace' && this.o > 0) {
          const p = this.wordPos(-1);
          this.checkpoint();
          blk.items.splice(p.o, this.o - p.o);
          this.o = p.o;
          return true;
        }
        if (this.o > 0) {
          const prev = blk.items[this.o - 1];
          if (prev.t === 'm') {
            this.o--;
            this.enterMath(true);
            return true;
          }
          this.checkpoint('type');
          blk.items.splice(this.o - 1, 1);
          this.o--;
        } else if (blk.kind !== 'p') {
          this.checkpoint();
          blk.kind = 'p';
        } else if (this.b > 0) {
          this.checkpoint();
          const prev = this.doc.blocks[this.b - 1];
          this.o = prev.items.length;
          prev.items.push(...blk.items);
          this.doc.blocks.splice(this.b, 1);
          this.b--;
        }
        return true;
      }
      case 'Delete': case 'C-Delete':
        if (this.selection) {
          this.checkpoint();
          this.deleteSelection();
          return true;
        }
        if (this.o < blk.items.length) {
          this.checkpoint('type');
          const end = k === 'C-Delete' ? this.wordPos(1).o : this.o + 1;
          blk.items.splice(this.o, Math.max(1, end - this.o));
        } else if (this.b < this.doc.blocks.length - 1) {
          this.checkpoint();
          blk.items.push(...this.doc.blocks.splice(this.b + 1, 1)[0].items);
        }
        return true;
      case 'Tab': return true;
      case '$':
        this.deleteSelection();
        this.insertMath(false);
        return true;
      case '\\':
        this.anchor = null;
        this.openPalette('text');
        return true;
    }
    if (k.length === 1) {
      this.checkpoint('type');
      this.deleteSelection();
      this.blk.items.splice(this.o, 0, ch(k));
      this.o++;
      if (k === ' ') this.markdownShortcut();
      return true;
    }
    return false;
  }

  private markdownShortcut() {
    const blk = this.blk;
    const text = blk.items.slice(0, this.o).map((i) => (i.t === 'c' ? i.ch : '\0')).join('');
    const map: Record<string, BlockKind> = { '# ': 'h1', '## ': 'h2', '### ': 'h3', '- ': 'li', '* ': 'li' };
    if (map[text] && blk.kind === 'p') {
      blk.items.splice(0, this.o);
      blk.kind = map[text];
      this.o = 0;
    }
  }

  insertMath(display: boolean) {
    this.checkpoint();
    this.anchor = null;
    const m = math([], display);
    if (display) {
      // Display math gets its own block.
      const blk = this.blk;
      if (blk.items.length) {
        const rest = blk.items.splice(this.o);
        this.doc.blocks.splice(this.b + 1, 0, block([m]), ...(rest.length ? [block(rest)] : []));
        this.b++;
      } else blk.items.push(m);
      this.o = 0;
    } else {
      this.blk.items.splice(this.o, 0, m);
    }
    this.mc = { path: [], off: 0 };
    this.setMode('math');
  }

  private enterMath(atEnd: boolean) {
    const m = this.mathItem;
    if (!m) return;
    this.anchor = null;
    this.mc = { path: [], off: atEnd ? m.root.length : 0 };
    this.setMode('math');
  }

  /** Leave math into text, before or after the item. */
  private exitMath(after: boolean) {
    this.o += after ? 1 : 0;
    this.setMode('text');
  }

  // ── math ──

  private mathKey(k: string): boolean {
    const item = this.mathItem!;
    const root = item.root;
    const cur = this.mc;
    const leader = this.pending === ';';
    this.pending = '';

    if (leader && k.length === 1) {
      this.checkpoint('type');
      if (k === ';') M.insertNode(root, cur, sym(';'));
      else if (GREEK_LEADER[k]) M.insertNode(root, cur, sym('\\' + GREEK_LEADER[k]));
      else M.typeChar(root, cur, k);
      return true;
    }
    const text = M.inTextSlot(root, cur);
    switch (k) {
      case 'Escape': this.exitMath(true); return true;
      case 'Left': case 'A-h': if (!M.moveLeft(root, cur)) this.exitMath(false); return true;
      case 'Right': case 'A-l': if (!M.moveRight(root, cur)) this.exitMath(true); return true;
      case 'Up': case 'A-k': M.moveVert(root, cur, 'up'); return true;
      case 'Down': case 'A-j': M.moveVert(root, cur, 'down'); return true;
      case 'Home': cur.path = []; cur.off = 0; return true;
      case 'End': cur.path = []; cur.off = root.length; return true;
      case 'Tab': if (!M.nextSlot(root, cur)) this.exitMath(true); return true;
      case 'S-Tab': if (!M.prevSlot(root, cur)) this.exitMath(false); return true;
      case 'C-z': this.undo(); return true;
      case 'C-y': case 'C-S-z': this.redo(); return true;
      case 'Backspace':
        this.checkpoint('type');
        if (!M.backspace(root, cur)) {
          if (!root.length) { this.blk.items.splice(this.o, 1); this.setMode('text'); }
          else this.exitMath(false);
        }
        return true;
      case 'Delete': this.checkpoint('type'); M.deleteForward(root, cur); return true;
      case 'Enter':
        if (M.gridNext(root, cur, 'row')) return true;
        this.exitMath(true);
        return true;
    }
    if (text && k.length === 1) {
      this.checkpoint('type');
      M.typeChar(root, cur, k);
      return true;
    }
    switch (k) {
      case '$':
        if (!root.length && !item.display) {
          // `$$` → display math
          this.blk.items.splice(this.o, 1);
          this.insertMath(true);
        } else this.exitMath(true);
        return true;
      case ' ':
        M.exitStructure(root, cur);
        return true;
      case ';': this.pending = ';'; return true;
      case '\\': this.openPalette('math'); return true;
      case '&': if (M.gridNext(root, cur, 'col')) return true; break;
    }
    if (k.length === 1) {
      this.checkpoint('type');
      M.typeChar(root, cur, k);
      return true;
    }
    return false;
  }

  // ── palette ──

  get paletteItems(): { name: string; desc: string }[] {
    const p = this.palette;
    if (!p) return [];
    const q = p.query;
    if (p.ctx === 'math') {
      const names = Object.keys(MATH_PALETTE);
      return rank(names, q)
        .slice(0, 8)
        .map((n) => ({ name: n, desc: describeInserter(n) }));
    }
    const cmds = this.textCommands();
    return rank(cmds.map((c) => c.name), q)
      .slice(0, 10)
      .map((n) => cmds.find((c) => c.name === n)!);
  }

  private openPalette(ctx: 'math' | 'text') {
    this.palette = { ctx, query: '', sel: 0 };
    this.setMode('palette');
  }

  private closePalette() {
    this.palette = null;
    this.mode = this.prevMode;
  }

  private paletteKey(k: string): boolean {
    const p = this.palette!;
    const items = this.paletteItems;
    switch (k) {
      case 'Escape': this.closePalette(); return true;
      case 'Backspace':
        if (!p.query) this.closePalette();
        else { p.query = p.query.slice(0, -1); p.sel = 0; }
        return true;
      case 'Down': case 'C-n': case 'C-j': p.sel = Math.min(items.length - 1, p.sel + 1); return true;
      case 'Up': case 'C-p': case 'C-k': p.sel = Math.max(0, p.sel - 1); return true;
      case 'Enter': case 'Tab': case ' ':
        this.acceptPalette(items[p.sel]?.name);
        return true;
    }
    if (k.length === 1) {
      if (p.ctx === 'math' && !p.query && !/[a-zA-Z]/.test(k)) {
        // `\,` `\;` `\{` … → raw single-char control sequences
        this.closePalette();
        this.checkpoint();
        const item = this.mathItem!;
        M.insertNode(item.root, this.mc, sym('\\' + k));
        return true;
      }
      if (p.ctx === 'text' && !p.query && k === '\\') {
        this.closePalette();
        this.checkpoint('type');
        this.blk.items.splice(this.o, 0, ch('\\'));
        this.o++;
        return true;
      }
      p.query += k;
      p.sel = 0;
      return true;
    }
    return true;
  }

  private acceptPalette(name: string | undefined) {
    const p = this.palette!;
    const q = p.query;
    this.closePalette();
    if (p.ctx === 'math') {
      const item = this.mathItem!;
      this.checkpoint();
      // Exact names win over the highlighted suggestion.
      const ins = MATH_PALETTE[q] ?? (name ? MATH_PALETTE[name] : undefined);
      if (ins && (MATH_PALETTE[q] || name)) M.applyInserter(item.root, this.mc, ins);
      else if (q) M.insertNode(item.root, this.mc, sym('\\' + q));
      return;
    }
    const c = this.textCommands().find((c) => c.name === (this.textCommands().some((c) => c.name === q) ? q : name));
    if (c) c.run();
    else if (q) this.flash(`unknown command: ${q}`);
  }

  /** Commands available from `\` / `:` outside math. Intended to become user-extensible. */
  textCommands(): PaletteEntry[] {
    const setKind = (kind: BlockKind) => () => { this.checkpoint(); this.blk.kind = kind; };
    return [
      { name: 'arrow', desc: 'draw an arrow between two things', run: () => this.startArrow() },
      { name: 'arrows', desc: 'select an existing arrow', run: () => this.selectArrowByHint() },
      { name: 'math', desc: 'inline math', run: () => this.insertMath(false) },
      { name: 'display', desc: 'display math block', run: () => this.insertMath(true) },
      { name: 'h1', desc: 'heading 1', run: setKind('h1') },
      { name: 'h2', desc: 'heading 2', run: setKind('h2') },
      { name: 'h3', desc: 'heading 3', run: setKind('h3') },
      { name: 'p', desc: 'paragraph', run: setKind('p') },
      { name: 'li', desc: 'list item', run: setKind('li') },
      { name: 'theme', desc: `cycle theme (${this.theme})`, run: () => this.cycleTheme() },
      { name: 'export', desc: 'copy document as LaTeX', run: () => this.copyText(docToLatex($state.snapshot(this.doc) as Doc), 'LaTeX') },
      { name: 'json', desc: 'copy document as JSON', run: () => this.copyText(JSON.stringify($state.snapshot(this.doc)), 'JSON') },
      { name: 'import', desc: 'replace document with JSON from clipboard', run: () => this.importJSON() },
      { name: 'new', desc: 'new note  ctrl+n', run: () => this.newNote() },
      { name: 'open', desc: 'open a note  ctrl+o', run: () => this.openNote() },
      { name: 'save', desc: 'save  ctrl+s', run: () => this.saveNote() },
      { name: 'saveas', desc: 'save as…  ctrl+shift+s', run: () => this.saveNoteAs() },
      { name: 'welcome', desc: 'open the welcome note', run: async () => { if (await this.okToReplace()) this.load(welcomeDoc(), { path: null, name: 'welcome' }); } },
      { name: 'help', desc: 'toggle key reference', run: () => (this.showHelp = !this.showHelp) },
    ];
  }

  cycleTheme() {
    this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
    try { localStorage.setItem('notex.theme', this.theme); } catch {}
    this.flash(`theme: ${this.theme}`);
  }

  private async copyText(s: string, what: string) {
    try {
      await navigator.clipboard.writeText(s);
      this.flash(`copied ${what} to clipboard`);
    } catch {
      this.flash('clipboard unavailable');
    }
  }

  private async importJSON() {
    try {
      const d = JSON.parse(await navigator.clipboard.readText());
      if (!Array.isArray(d.blocks)) throw 0;
      this.checkpoint();
      this.doc = { blocks: d.blocks, arrows: d.arrows ?? [] };
      this.b = 0;
      this.o = 0;
      this.touch();
    } catch {
      this.flash('clipboard does not contain a notex document');
    }
  }

  // ───────────────────────── arrows ─────────────────────────

  /** Targets at the top level, in reading order: words and top-level math groups. */
  private level0(): Loc[] {
    const out: Loc[] = [];
    this.doc.blocks.forEach((blk, b) => {
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
    const blk = this.doc.blocks[l.b];
    if (!blk) return [];
    switch (l.k) {
      case 'block': return [blk.id];
      case 'word': return blk.items.slice(l.s, l.e + 1).map((i) => i.id);
      case 'item': return [blk.items[l.o].id];
      case 'node': {
        const m = blk.items[l.o] as MathItem;
        return M.nodeIds(M.rowAt(m.root, l.path), l.i, l.j);
      }
    }
  }

  private locFromCursor(): Loc {
    const blk = this.blk;
    const it = blk.items[this.o];
    if (it?.t === 'm') return { k: 'item', b: this.b, o: this.o };
    if (it && !isSpace(it)) {
      let s = this.o, e = this.o;
      while (s > 0 && blk.items[s - 1].t === 'c' && !isSpace(blk.items[s - 1])) s--;
      while (e < blk.items.length - 1 && blk.items[e + 1].t === 'c' && !isSpace(blk.items[e + 1])) e++;
      return { k: 'word', b: this.b, s, e };
    }
    const l0 = this.level0();
    return l0.find((l) => l.b >= this.b) ?? l0[0] ?? { k: 'block', b: this.b };
  }

  startArrow() {
    this.pick = { phase: 'from', loc: this.locFromCursor() };
    this.setMode('pick');
    this.flash('choose where the arrow starts: arrow keys or click · Enter to confirm');
  }

  private sameLoc(a: Loc, b: Loc) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private pickKey(k: string): boolean {
    const pk = this.pick!;
    const l = pk.loc;
    const l0 = this.level0();
    const idx = l0.findIndex((x) => this.sameLoc(x, l));
    const move = (d: number) => {
      if (idx >= 0) pk.loc = l0[Math.max(0, Math.min(l0.length - 1, idx + d))];
      else if (l.k === 'node') {
        const row = M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path);
        const gs = groups(row);
        const gi = gs.findIndex(([i]) => i === l.i);
        const [i, j] = gs[Math.max(0, Math.min(gs.length - 1, gi + d))];
        pk.loc = { ...l, i, j };
      } else if (l.k === 'item' || l.k === 'block') {
        // jump back to the nearest top-level target
        const near = l0.find((x) => x.b === l.b && (l.k === 'block' || (x as any).o === l.o));
        if (near) pk.loc = near;
      }
    };
    switch (k) {
      case 'Escape':
        this.pick = null;
        this.setMode('text');
        return true;
      case 'Left': case 'h': move(-1); return true;
      case 'Right': case 'l': move(1); return true;
      case 'Down': case 'j': this.pickVertical(1); return true;
      case 'Up': case 'k': this.pickVertical(-1); return true;
      case 'S-Up': case 'A-Up': case 'K': pk.loc = this.parentLoc(l); return true;
      case 'S-Down': case 'A-Down': case 'J': pk.loc = this.childLoc(l); return true;
      case 'S-Left': case 'H': pk.loc = this.extendLoc(l, -1); return true;
      case 'S-Right': case 'L': pk.loc = this.extendLoc(l, 1); return true;
      case 'Tab': case 'f': this.hintTargets(); return true;
      case 'Home': case '0': this.pickLineEdge(-1); return true;
      case 'End': case '$': this.pickLineEdge(1); return true;
      case 'C-Home': if (l0.length) pk.loc = l0[0]; return true;
      case 'C-End': if (l0.length) pk.loc = l0[l0.length - 1]; return true;
      case 'Enter': case ' ':
        if (pk.phase === 'from') {
          const next = l0[idx + 1] ?? l;
          this.pick = { phase: 'to', from: l, loc: idx >= 0 ? next : l };
          this.flash('now choose where it points');
        } else this.finishArrow();
        return true;
    }
    return true;
  }

  /** Target for a clicked element id: a word, or the math node (grouped with its scripts). */
  private locFromId(id: Id): Loc | null {
    const direct = this.level0().find((l) => this.anchorIds(l).includes(id));
    if (direct) return direct;
    for (let b = 0; b < this.doc.blocks.length; b++) {
      const items = this.doc.blocks[b].items;
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
        const row = M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, path);
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
      const m = this.doc.blocks[l.b].items[l.o] as MathItem;
      const g = groups(m.root)[0];
      return g ? { k: 'node', b: l.b, o: l.o, path: [], i: g[0], j: g[1] } : l;
    }
    if (l.k === 'node') {
      const m = this.doc.blocks[l.b].items[l.o] as MathItem;
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

  private extendLoc(l: Loc, d: 1 | -1): Loc {
    if (l.k === 'node') {
      const row = M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path);
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
        const blocked = w && this.doc.blocks[l.b].items.slice(l.e + 1, w.s).some((i) => i.t === 'm');
        return w && !blocked ? { ...l, e: w.e } : l;
      }
      const w = [...ws].reverse().find((w) => w.e < l.s);
      const blocked = w && this.doc.blocks[l.b].items.slice(w.e + 1, l.s).some((i) => i.t === 'm');
      return w && !blocked ? { ...l, s: w.s } : l;
    }
    return l;
  }

  /** Jump to the first / last target on the current visual line. */
  private pickLineEdge(dir: 1 | -1) {
    const pk = this.pick!;
    const cur = this.rectOfIds(this.anchorIds(pk.loc));
    if (!cur) return;
    const mid = cur.y + cur.h / 2;
    const onLine = this.level0()
      .map((l) => ({ l, r: this.rectOfIds(this.anchorIds(l)) }))
      .filter((c): c is { l: Loc; r: Rect } => !!c.r && c.r.y <= mid && c.r.y + c.r.h >= mid);
    if (!onLine.length) return;
    onLine.sort((a, b) => (a.r.x - b.r.x) * dir);
    pk.loc = onLine[onLine.length - 1].l;
  }

  private pickVertical(dir: 1 | -1) {
    const pk = this.pick!;
    const cur = this.rectOfIds(this.anchorIds(pk.loc));
    if (!cur) return;
    const cx = cur.x + cur.w / 2;
    const cands = this.level0()
      .map((l) => ({ l, r: this.rectOfIds(this.anchorIds(l)) }))
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
    const pk = this.pick!;
    const from = this.anchorIds(pk.from!);
    const to = this.anchorIds(pk.loc);
    const fr = this.rectOfIds(from), tr = this.rectOfIds(to);
    if (!fr || !tr || from.join() === to.join()) {
      this.flash('arrow needs two different endpoints');
      return;
    }
    this.checkpoint();
    const a: Arrow = { id: uid(), from, to, bend: defaultBend(fr, tr), head: 'end', dash: false, boxed: false, label: '' };
    this.doc.arrows.push(a);
    this.pick = null;
    this.styling = a.id;
    this.setMode('style');
    this.flash('arrow drawn — ↑↓ to bend it, Enter when done');
  }

  private styleKey(k: string): boolean {
    const a = this.doc.arrows.find((x) => x.id === this.styling);
    if (!a) { this.setMode('text'); return true; }
    const dir = this.arrowGeos[a.id]?.dir ?? 1;
    const edit = (f: () => void) => { this.checkpoint('style'); f(); };
    switch (k) {
      case 'Escape': case 'Enter': this.styling = null; this.setMode('text'); return true;
      case 'Up': case 'k': edit(() => (a.bend = round(a.bend + 0.1 * dir))); return true;
      case 'Down': case 'j': edit(() => (a.bend = round(a.bend - 0.1 * dir))); return true;
      case '0': case '=': edit(() => (a.bend = 0)); return true;
      case 'r': edit(() => { [a.from, a.to] = [a.to, a.from]; a.bend = -a.bend; }); return true;
      case 't': edit(() => (a.head = a.head === 'end' ? 'both' : a.head === 'both' ? 'none' : 'end')); return true;
      case 'd': edit(() => (a.dash = !a.dash)); return true;
      case 'b': edit(() => (a.boxed = !a.boxed)); return true;
      case 'l': case 'i': case '"': this.label = { text: a.label }; this.setMode('label'); return true;
      case 'x': case 'Delete': case 'Backspace':
        this.checkpoint();
        this.doc.arrows.splice(this.doc.arrows.indexOf(a), 1);
        this.styling = null;
        this.setMode('text');
        return true;
    }
    return true;
  }

  private labelKey(k: string): boolean {
    const lb = this.label!;
    const a = this.doc.arrows.find((x) => x.id === this.styling);
    switch (k) {
      case 'Escape': this.label = null; this.mode = 'style'; return true;
      case 'Enter':
        if (a) { this.checkpoint(); a.label = lb.text; }
        this.label = null;
        this.mode = 'style';
        return true;
      case 'Backspace': lb.text = lb.text.slice(0, -1); return true;
    }
    if (k.length === 1) lb.text += k;
    return true;
  }

  // ───────────────────────── hints ─────────────────────────

  private showHints(targets: { rect: Rect; act: () => void }[]) {
    if (!targets.length || !this.page) return this.flash('nothing to hint');
    const origin = this.page.getBoundingClientRect();
    const labels = hintLabels(targets.length);
    this.hints = { list: targets.map((t, n) => ({ label: labels[n], rect: relTo(t.rect, origin), act: t.act })), typed: '' };
    this.setMode('hint');
  }

  private hintTargets() {
    const view = this.page?.parentElement?.getBoundingClientRect();
    const ts = this.level0()
      // punctuation-only words just add noise
      .filter((l) => l.k !== 'word' || this.doc.blocks[l.b].items.slice(l.s, l.e + 1).some((i) => i.t === 'c' && /[\p{L}\p{N}]/u.test(i.ch)))
      .map((l) => ({ l, r: this.rectOfIds(this.anchorIds(l)) }))
      .filter((t): t is { l: Loc; r: Rect } => !!t.r && (!view || (t.r.y + t.r.h > view.top && t.r.y < view.bottom)))
      .map(({ l, r }) => ({ rect: r, act: () => (this.pick!.loc = l) }));
    this.showHints(ts);
  }

  selectArrowByHint() {
    if (!this.page) return;
    const origin = this.page.getBoundingClientRect();
    const ts = this.doc.arrows
      .filter((a) => this.arrowGeos[a.id])
      .map((a) => {
        const m = this.arrowGeos[a.id].mid;
        return { rect: { x: m.x + origin.left - 6, y: m.y + origin.top - 8, w: 12, h: 16 }, act: () => { this.styling = a.id; this.mode = 'style'; this.prevMode = 'style'; } };
      });
    if (!ts.length) return this.flash('no arrows');
    this.prevMode = 'text';
    this.showHints(ts);
  }

  private hintKey(k: string): boolean {
    const h = this.hints!;
    if (k === 'Escape') { this.hints = null; this.mode = this.prevMode; return true; }
    if (k === 'Backspace') { h.typed = h.typed.slice(0, -1); return true; }
    if (k.length !== 1) return true;
    h.typed += k;
    const matches = h.list.filter((x) => x.label.startsWith(h.typed));
    if (!matches.length) { this.hints = null; this.mode = this.prevMode; return true; }
    if (matches.length === 1 && matches[0].label === h.typed) {
      this.hints = null;
      this.mode = this.prevMode;
      matches[0].act();
    }
    return true;
  }

  /** Remove arrows whose endpoints were deleted. */
  pruneArrows() {
    const ids = allIds(this.doc);
    const keep = this.doc.arrows.filter((a) => a.from.some((i) => ids.has(i)) && a.to.some((i) => ids.has(i)));
    if (keep.length !== this.doc.arrows.length) this.doc.arrows = keep;
  }

  async afterRender() {
    await tick();
    this.layout();
  }
}

// ───────────────────────── utilities ─────────────────────────

const isSpace = (it: { t: string; ch?: string }) => it.t === 'c' && /\s/.test(it.ch!);
const cmpPos = (a: Pos, b: Pos) => a.b - b.b || a.o - b.o;

const cloneItem = (it: Item): Item => (it.t === 'c' ? { ...it, id: uid() } : { ...it, id: uid(), root: cloneRow(it.root) });

function itemsToText(items: Item[]): string {
  return items.map((it) => (it.t === 'c' ? it.ch : it.display ? `$$${toLatex(it.root)}$$` : `$${toLatex(it.root)}$`)).join('');
}

/** Plain text where `$...$` / `$$...$$` spans become math items. */
export function textWithMath(line: string): Item[] {
  const out: Item[] = [];
  let last = 0;
  for (const m of line.matchAll(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g)) {
    out.push(...chars(line.slice(last, m.index)));
    out.push(math(parseLatex(m[1] ?? m[2]).row, !!m[1]));
    last = m.index! + m[0].length;
  }
  out.push(...chars(line.slice(last)));
  return out;
}

/** Locate a node by id: the path to its row and its index there. */
export function findNode(row: MRow, id: Id, path: Step[] = []): { path: Step[]; i: number } | null {
  for (let i = 0; i < row.length; i++) {
    const n = row[i];
    if (n.id === id) return { path, i };
    if (n.k === 'cmd')
      for (let s = 0; s < n.slots.length; s++) {
        const f = findNode(n.slots[s], id, [...path, { i, s }]);
        if (f) return f;
      }
  }
  return null;
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Group each node with the scripts that follow it. */
export function groups(row: MRow): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < row.length; i++) {
    let j = i;
    while (j + 1 < row.length && row[j + 1].k === 'cmd' && CMDS[(row[j + 1] as MCmd).name]?.script) j++;
    out.push([i, j]);
    i = j;
  }
  return out;
}

function keyName(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Dead' || k === 'Unidentified') return null;
  const named: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
  const base = named[k] ?? k;
  const altGr = e.ctrlKey && e.altKey;
  if (base.length === 1 && !e.metaKey && (altGr || (!e.ctrlKey && !e.altKey))) return base;
  let mods = '';
  if (e.ctrlKey || e.metaKey) mods += 'C-';
  if (e.altKey) mods += 'A-';
  if (e.shiftKey) mods += 'S-';
  return mods + (base.length === 1 ? base.toLowerCase() : base);
}

function rank(names: string[], q: string): string[] {
  if (!q) return names;
  const scored: { n: string; s: number }[] = [];
  for (const n of names) {
    let s: number;
    if (n === q) s = 0;
    else if (n.startsWith(q)) s = 1 + n.length / 100;
    else if (n.toLowerCase().includes(q.toLowerCase())) s = 3 + n.length / 100;
    else {
      // subsequence
      let i = 0;
      for (const c of n) if (c === q[i]) i++;
      if (i < q.length) continue;
      s = 5 + n.length / 100;
    }
    scored.push({ n, s });
  }
  return scored.sort((a, b) => a.s - b.s).map((x) => x.n);
}

function describeInserter(name: string): string {
  const ins = MATH_PALETTE[name];
  const nodes = 'node' in ins ? [ins.node()] : ins.nodes();
  const n = nodes[0];
  return n.k === 'sym' ? n.v : `\\${n.name}`;
}

/** Prefix-free labels that stay short (vimium-style): single letters first, then pairs. */
export function hintLabels(n: number): string[] {
  const alpha = 'asdfjklghqweruiopzxcvnmbty';
  const out = [''];
  let off = 0;
  while (out.length - off < n || out.length === 1) {
    const h = out[off++];
    for (const c of alpha) out.push(h + c);
  }
  return out.slice(off, off + n).sort();
}

function welcomeDoc(): Doc {
  const P = (s: string, kind: BlockKind = 'p') => block(chars(s), kind);
  const x = sym('x');
  const eq = math([
    sym('f'), cmd('paren', [[x]]), sym('='),
    cmd('frac', [[sym('1')], [cmd('sqrt', [[sym('2'), sym('\\pi')]])]]),
    sym('e'), cmd('sup', [[sym('-'), cmd('frac', [[sym('x'), cmd('sup', [[sym('2')]])], [sym('2')]])]]),
  ]);
  const lhs = math([sym('\\int'), cmd('subsup', [[sym('-'), sym('\\infty')], [sym('\\infty')]]), sym('f'), cmd('paren', [[sym('x')]]), sym('\\,'), sym('d'), sym('x'), sym('='), sym('1')], true);
  const b1 = block([...chars('The standard normal density is '), eq, ...chars(' and it is normalized:')]);
  const b2 = block([lhs]);
  const doc: Doc = {
    blocks: [
      P('notex', 'h1'),
      P('math notes you can type as fast as you think. press F1 any time for the key reference.'),
      b1,
      b2,
      P('try it', 'h2'),
      P('type $ to start math. inside, try x^2, a/b, sqrt, sum, ->, alpha, or ;a. press $ again (or →) to get back to text.', 'li'),
      P('type \\ to open commands. \\arrow draws an arrow: pick the start with the arrow keys or a click, then the end.', 'li'),
      P('while choosing, Shift+↑ grabs the bigger expression, Shift+↓ goes inside it, Tab shows jump labels.', 'li'),
      P('after drawing, ↑↓ bend the arrow; t, d, b and l change heads, dashes, boxes and the label.', 'li'),
    ],
    arrows: [],
  };
  // An example arrow: from the normalizing constant to the "normalized" word.
  const frac = eq.root[3];
  const word = b1.items.slice(-11, -1).map((i) => i.id);
  doc.arrows.push({ id: uid(), from: [frac.id], to: word, bend: 0.5, head: 'end', dash: true, boxed: false, label: 'makes total mass 1' });
  return doc;
}
