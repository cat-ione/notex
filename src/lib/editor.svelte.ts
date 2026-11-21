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
import { arrowGeo, bendThrough, defaultBend, type ArrowGeo, type Outline } from './arrows';
import { INKS, MARK_KINDS, markGeo, type MarkGeo } from './marks';
import { besideNote, labelOffsetAt, layoutRow, measureLabel, pinnedLeader, provisional, type RowNote } from './labels';
import { docToLatex } from './export';
import * as F from './files';
import * as C from './config';
import { byLine, fromDOM, inkRects, lineGroups, measure, relTo, releaseRange, sharedRange, union, type Rect } from './geom';
import * as M from './math/edit';
import { BIG_OPS, CMDS, GREEK_LEADER, MATH_PALETTE, OPENERS } from './math/defs';
import { parseLatex } from './math/parse';
import { toLatex, type MCursor, type MSelRange, type Step } from './math/latex';
import { allIds, block, ch, chars, cloneRow, cmd, math, sym, uid, type NoteAt, type Arrow, type Block, type Mark, type MarkKind, type BlockKind, type Doc, type Id, type Item, type MathItem, type MCmd, type MNode, type MRow } from './model';

export type Mode = 'text' | 'math' | 'pick' | 'style' | 'hint' | 'palette' | 'label';

export type Loc =
  | { k: 'word'; b: number; s: number; e: number }
  | { k: 'item'; b: number; o: number }
  | { k: 'node'; b: number; o: number; path: Step[]; i: number; j: number }
  | { k: 'block'; b: number }
  | { k: 'ids'; b: number; ids: Id[] };

export type Pos = { b: number; o: number };

type PaletteEntry = { name: string; desc: string; run: () => void; draw?: boolean };
type LabelSnap = { text: string; at: number; anchor: number | null };
/**
 * Something a menu entry, a key, a toolbar button or the palette can do. `more`: another
 * way to do it (for tooltips); `off`: not possible right now; `sep`: a menu rule before it.
 */
export type DrawingAction = { name: string; desc: string; keys: string[]; run: (key?: string) => void; menu?: false; keyOnly?: true; more?: string; off?: boolean; sep?: true };
export type PaletteItem = { name: string; desc: string; draw?: boolean };
export type Spacer = { above?: number; below?: number };
type Hint = { label: string; rect: Rect; act: () => void };
type Snap = { doc: Doc; b: number; o: number };


const STORAGE_KEY = 'notex.doc.v1';
/** Most room (px) a line or formula is ever pushed by, so a feedback bug can't run away. */
const MAX_ROOM = 400;

export class Editor {
  doc = $state<Doc>({ blocks: [block()], arrows: [], marks: [] });
  mode = $state<Mode>('text');
  /** Block index and item offset of the text caret (0..items.length). */
  b = $state(0);
  o = $state(0);
  /** Selection anchor; the selection spans anchor..caret. */
  anchor = $state<Pos | null>(null);
  /**
   * Ordered selection range, or null when nothing is selected. Derived, so that
   * while nothing is selected it stays null as the caret moves and the per-character
   * `isSelected` checks don't all re-run on every keystroke.
   */
  selection = $derived.by((): { s: Pos; e: Pos } | null => {
    const a = this.anchor;
    if (!a || (a.b === this.b && a.o === this.o)) return null;
    const c = { b: this.b, o: this.o };
    return cmpPos(a, c) < 0 ? { s: a, e: c } : { s: c, e: a };
  });
  /** Math cursor (valid in math mode; the math item is items[o]). */
  mc = $state<MCursor>({ path: [], off: 0 });

  /** `draw` is the drawing menu (Ctrl+D), available from text and math. */
  palette = $state<{ ctx: 'math' | 'text' | 'draw' | 'style'; query: string; sel: number } | null>(null);
  /** Choosing a target: for an arrow (two phases) or a mark (one). */
  pick = $state<{ phase: 'from' | 'to'; loc: Loc; from?: Loc; purpose: 'arrow' | MarkKind; edit?: { id: Id; end: 'from' | 'to' | 'at' } } | null>(null);
  styling = $state<Id | null>(null);
  hints = $state<{ list: Hint[]; typed: string } | null>(null);
  /** The label being typed for the selected drawing: caret offset and selection anchor. */
  label = $state<{ text: string; at: number; anchor: number | null } | null>(null);
  message = $state('');
  showHelp = $state(false);
  config = $state<C.Config>(C.DEFAULT_CONFIG);
  showSettings = $state(false);
  settingsEditing = $state(false);

  /** The note's file (path is null for unsaved notes or in the browser). */
  file = $state<{ path: string | null; name: string }>({ path: null, name: 'untitled' });
  dirty = $state(false);
  private edits = 0;

  /** Bumped on every mutation so layout-dependent overlays recompute. */
  version = $state(0);

  // Layout results (page-relative), recomputed after each render.
  caret = $state<{ r: Rect; shape: 'bar' | 'math' } | null>(null);
  /** The text selection as rectangles, one per line (page-relative). */
  selRects = $state.raw<Rect[]>([]);
  /** The frame around the formula being edited (page coordinates). */
  mathFrame = $state.raw<Rect | null>(null);
  pickRects = $state<{ cur: Rect | null; from: Rect | null }>({ cur: null, from: null });
  // (raw: replaced wholesale on every layout, so deep proxies would be pure overhead)
  arrowGeos = $state.raw<Record<Id, ArrowGeo>>({});
  markGeos = $state.raw<Record<Id, MarkGeo>>({});
  /**
   * Room made for drawings, per item: how far (px) the invisible spacer after a
   * character / inline formula is raised (above) or lowered (below), or the
   * padding (px) of a display formula.
   */
  spacers = $state<Record<Id, Spacer>>({});
  private spacerPasses = 0;
  private spacerVersion = -1;
  /** Text selection captured when a command was run from the palette. */
  private cmdSel: { s: Pos; e: Pos } | null = null;
  /** Where to go back to after a drawing started from inside a formula. */
  private drawReturn: { b: number; o: number; mc: MCursor } | null = null;

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
      if (saved) this.doc = { marks: [], ...JSON.parse(saved) };
      else (this.doc = welcomeDoc()), (this.file.name = 'welcome');
      const f = localStorage.getItem('notex.file');
      if (f) {
        const j = JSON.parse(f);
        this.file = { path: j.path ?? null, name: j.name ?? 'untitled' };
        this.dirty = !!j.dirty;
      }
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
    // caret moves leave the blocks as they were: keep their snapshots
    if (this.edits !== this.touchedEdits) {
      this.touchedEdits = this.edits;
      this.markDirty();
    } else if (this.frame) this.frame = { rects: new Map(), ink: new Map() };
    this.version++;
  }
  private touchedEdits = 0;

  // ── snapshots (shared between undo states, autosave and lookups) ──

  /** The last snapshot of each live block, reused while the block is unchanged. */
  private blockSnaps = new WeakMap<Block, Block>();
  /** Every id inside a live block (items and math nodes), until the block is edited. */
  private idSets = new WeakMap<Block, Set<Id>>();
  /** Per-snapshot JSON, for autosave. */
  private blockJSON = new WeakMap<Block, string>();
  /** Word / formula counts of a live block, until it is edited. */
  private blockCounts = new WeakMap<Block, { words: number; maths: number }>();
  private persistedEdits = -1;

  /**
   * Forget the snapshots of the blocks around the caret and the selection anchor:
   * edits only ever happen there. Called before edits (checkpoint) and after every
   * action that edited (touch).
   */
  private markDirty() {
    const blocks = this.doc.blocks;
    for (const b of [this.b - 1, this.b, this.b + 1, this.anchor ? this.anchor.b : -1]) {
      const blk = blocks[b];
      if (blk) {
        this.blockSnaps.delete(blk);
        this.idSets.delete(blk);
        this.blockCounts.delete(blk);
      }
    }
    if (this.frame) this.frame = { rects: new Map(), ink: new Map() };
  }

  /** A plain snapshot of a block, shared while the block doesn't change. */
  private snapBlock(blk: Block): Block {
    let snap = this.blockSnaps.get(blk);
    // (a changed length always means a change, as a safety net)
    if (!snap || snap.items.length !== blk.items.length) {
      snap = $state.snapshot(blk) as Block;
      this.blockSnaps.set(blk, snap);
    }
    return snap;
  }

  /**
   * Fill the snapshot cache a few blocks at a time while the app is idle, so the
   * first edit of a freshly opened long note doesn't have to copy all of it.
   */
  private warmSnapshots() {
    const doc = this.doc;
    let i = 0;
    // idle callbacks get the whole idle period (up to ~50ms); timers as a fallback
    const later = (f: (d?: IdleDeadline) => void) =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 30);
    const step = (deadline?: IdleDeadline) => {
      if (this.doc !== doc) return;
      const end = performance.now() + Math.max(8, deadline?.timeRemaining() ?? 8);
      while (i < doc.blocks.length && performance.now() < end) this.snapBlock(doc.blocks[i++]);
      if (i < doc.blocks.length) later(step);
      else this.backupSoon();
    };
    later(step);
  }

  /** Write the session backup when the snapshots are warm. */
  private backupSoon() {
    try {
      localStorage.setItem(STORAGE_KEY, this.docJSON(this.snapshot()));
      localStorage.setItem('notex.file', JSON.stringify({ ...this.file, dirty: this.dirty }));
    } catch {}
  }

  /** A plain snapshot of the document; unchanged blocks are shared with earlier snapshots. */
  snapshot(): Doc {
    return {
      blocks: this.doc.blocks.map((b) => this.snapBlock(b)),
      arrows: $state.snapshot(this.doc.arrows) as Arrow[],
      marks: $state.snapshot(this.doc.marks) as Mark[],
    };
  }

  private idsOf(blk: Block): Set<Id> {
    let ids = this.idSets.get(blk);
    // (a changed length always means a change, as a safety net)
    if (!ids || (ids as Set<Id> & { n?: number }).n !== blk.items.length) {
      // a cached snapshot is quickest to walk; else read the live block (cheaper than copying it)
      const cached = this.blockSnaps.get(blk);
      const snap = cached && cached.items.length === blk.items.length ? cached : blk;
      ids = new Set([snap.id]);
      const walk = (row: MRow) => {
        for (const n of row) {
          ids!.add(n.id);
          if (n.k === 'cmd') n.slots.forEach(walk);
        }
      };
      for (const it of snap.items) {
        ids.add(it.id);
        if (it.t === 'm') walk(it.root);
      }
      (ids as Set<Id> & { n?: number }).n = blk.items.length;
      this.idSets.set(blk, ids);
    }
    return ids;
  }

  /** Words, formulas and drawings in the document (cheap: counted per unchanged block once). */
  counts() {
    let words = 0, maths = 0;
    for (const blk of this.doc.blocks) {
      let c = this.blockCounts.get(blk);
      if (!c) {
        c = { words: 0, maths: 0 };
        let inWord = false;
        for (const it of blk.items) {
          if (it.t === 'm') (c.maths++, (inWord = false));
          else if (/\s/.test(it.ch)) inWord = false;
          else if (!inWord) (c.words++, (inWord = true));
        }
        this.blockCounts.set(blk, c);
      }
      words += c.words;
      maths += c.maths;
    }
    return { words, maths, drawings: this.doc.arrows.length + this.doc.marks.length };
  }

  /** The document as JSON (the in-memory form), built from cached per-block JSON. */
  private docJSON(d: Doc): string {
    const parts = d.blocks.map((b) => {
      let j = this.blockJSON.get(b);
      if (j === undefined) this.blockJSON.set(b, (j = JSON.stringify(b)));
      return j;
    });
    return `{"blocks":[${parts.join(',')}],"arrows":${JSON.stringify(d.arrows)},"marks":${JSON.stringify(d.marks)}}`;
  }

  flash(msg: string) {
    this.message = msg;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.message = ''), 3500);
  }

  /** Session backup (survives reloads/crashes) plus autosave to the note's file if it has one. */
  async persist() {
    // caret moves bump the version too: only write when something was edited
    if (this.edits === this.persistedEdits && !(this.file.path && this.dirty)) return;
    this.persistedEdits = this.edits;
    try {
      localStorage.setItem(STORAGE_KEY, this.docJSON(this.snapshot()));
      localStorage.setItem('notex.file', JSON.stringify({ ...this.file, dirty: this.dirty }));
    } catch {}
    if (this.file.path && this.dirty) await this.writeTo(this.file.path, true);
  }

  private async writeTo(path: string, quiet = false) {
    const edits = this.edits;
    try {
      await F.writeNote(path, this.snapshot());
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
      F.downloadNote(this.file.name, this.snapshot());
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

  load(doc: Doc, file: { path: string | null; name: string }) {
    this.doc = doc;
    this.file = file;
    this.dirty = false;
    // nothing to autosave until it's edited; the session backup is written when idle
    this.persistedEdits = this.edits;
    this.warmSnapshots();
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
    this.load({ blocks: [block()], arrows: [], marks: [] }, { path: null, name: 'untitled' });
  }

  checkpoint(kind = 'edit') {
    // an edit follows: lookups made before it may not hold afterwards
    if (this.frame) this.frame.blockOfs = undefined;
    this.dirty = true;
    this.edits++;
    const now = Date.now();
    if (kind === 'type' && this.lastKind === 'type' && now - this.lastTime < 1000) {
      this.lastTime = now;
      return;
    }
    this.lastKind = kind;
    this.lastTime = now;
    this.markDirty();
    this.undoStack.push({ doc: this.snapshot(), b: this.b, o: this.o });
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(from: Snap[], to: Snap[], what: string) {
    const s = from.pop();
    if (!s) return this.flash(`nothing to ${what}`);
    to.push({ doc: this.snapshot(), b: this.b, o: this.o });
    // Keep the live blocks that are unchanged (same snapshot) so they don't re-render;
    // only the blocks that differ are replaced (by copies: snapshots stay pristine).
    const live = new Map<Block, Block>();
    for (const blk of this.doc.blocks) {
      const snap = this.blockSnaps.get(blk);
      if (snap) live.set(snap, blk);
    }
    this.doc.blocks = s.doc.blocks.map((sb) => live.get(sb) ?? (structuredClone(sb) as Block));
    this.doc.arrows = structuredClone(s.doc.arrows);
    this.doc.marks = structuredClone(s.doc.marks);
    this.doc.blocks.forEach((blk, i) => this.blockSnaps.set(blk, s.doc.blocks[i]));
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
    if (m !== 'palette' && (m !== 'math' || this.mode !== 'math')) this.msel = null;
    this.mode = m;
    this.touch();
  }

  /**
   * The element for an id (a block, item or math node). Within a layout pass or an
   * input handler, lookups go through per-block maps built on first use, so a long
   * note isn't scanned for every id; `b` is the block, when the caller knows it.
   */
  private el(id: Id, b?: number): Element | null {
    if (!this.page) return null;
    if (!this.frame) return this.page.querySelector(`[data-nx="${id}"]`);
    return this.els(id, b)[0] ?? null;
  }

  private els(id: Id, b?: number): Element[] {
    const bi = b ?? this.blockOf(id);
    return bi < 0 ? [] : (this.blockMap(bi).get(id) ?? []);
  }

  private blockEl(bi: number): Element | undefined {
    const f = this.frame!;
    // (children, not a ':scope > .block' query: that still walks every descendant)
    f.blockEls ??= [...this.page!.children].filter((e) => e.classList.contains('block'));
    return f.blockEls[bi];
  }

  /** Elements of one block by id (and its spacers / probes / end-of-line marker by key). */
  private blockMap(bi: number): Map<string, Element[]> {
    const f = this.frame!;
    f.byBlock ??= new Map();
    let m = f.byBlock.get(bi);
    if (!m) {
      m = new Map();
      const root = this.blockEl(bi);
      if (root) {
        const add = (key: string, e: Element) => {
          const list = m!.get(key);
          if (list) list.push(e);
          else m!.set(key, [e]);
        };
        add((root as HTMLElement).dataset.nx!, root);
        for (const e of root.querySelectorAll('[data-nx], .nx-sp, .eol')) {
          const d = (e as HTMLElement).dataset;
          const key = d.nx ?? (d.pt ? `pt:${d.pt}` : d.pb ? `pb:${d.pb}` : d.sp ? `sp:${d.sp}` : d.eol ? 'eol' : null);
          if (key) add(key, e);
        }
      }
      f.byBlock.set(bi, m);
    }
    return m;
  }

  /** Index of the block containing an id (-1 if none). */
  private blockOf(id: Id): number {
    const f = this.frame!;
    f.blockOfs ??= new Map();
    let bi = f.blockOfs.get(id);
    if (bi === undefined) f.blockOfs.set(id, (bi = this.findBlock(id)));
    return bi;
  }

  private findBlock(id: Id): number {
    const f = this.frame!;
    // most lookups are around the caret: try those blocks first
    for (const bi of [this.b, this.b - 1, this.b + 1]) {
      const blk = this.doc.blocks[bi];
      if (blk && this.idsOf(blk).has(id)) return bi;
    }
    f.blockIdx ??= new Map(this.doc.blocks.map((blk, bi) => [blk, bi]));
    // then the block the id was last seen in (kept across layouts, checked on use)
    const home = this.idHome.get(id);
    if (home) {
      const bi = f.blockIdx.get(home);
      if (bi !== undefined && this.idsOf(home).has(id)) return bi;
    }
    // unknown or moved: index the whole note again, at most once per edit
    if (this.homeScanned !== this.edits || this.homeDoc !== this.doc) {
      this.homeScanned = this.edits;
      this.homeDoc = this.doc;
      this.idHome.clear();
      for (const blk of this.doc.blocks) for (const x of this.idsOf(blk)) this.idHome.set(x, blk);
      return this.findBlock(id);
    }
    return -1;
  }
  /** Id → the block it was last seen in. */
  private idHome = new Map<Id, Block>();
  private homeScanned = -1;
  private homeDoc: Doc | null = null;

  /** Run `fn` with per-block lookups (input handlers: the DOM doesn't change while they run). */
  private withFrame<T>(fn: () => T): T {
    if (this.frame) return fn();
    this.frame = { rects: new Map(), ink: new Map() };
    try {
      return fn();
    } finally {
      this.frame = null;
    }
  }

  /** A line spacer or probe of an anchor item ('pt' | 'pb' | 'sp', with `<id>` or `<id>-<side>`). */
  private spEl(kind: 'pt' | 'pb' | 'sp', anchor: Id, side?: string): Element | null {
    const key = `${kind}:${anchor}${side ? `-${side}` : ''}`;
    const bi = this.blockOf(anchor);
    return bi < 0 ? null : (this.blockMap(bi).get(key)?.[0] ?? null);
  }

  /** Measurements shared within one layout pass (the DOM doesn't change during it). */
  private frame: {
    rects: Map<string, Rect[]>;
    ink: Map<Element, Rect[]>;
    blockEls?: Element[];
    byBlock?: Map<number, Map<string, Element[]>>;
    blockIdx?: Map<Block, number>;
    marks?: Mark[];
    /** blockOf answers */
    blockOfs?: Map<Id, number>;
  } | null = null;

  /** Plain copies of the marks being laid out in this pass (see layoutFrame). */
  private get fMarks(): Mark[] {
    return this.frame?.marks ?? this.doc.marks;
  }
  /** Ink of each block relative to the block, kept while the block's size and text are unchanged. */
  private inkCache = new WeakMap<Element, { sig: string; rel: Rect[] }>();
  /** Bumped when fonts load (glyphs move without the text changing). */
  fontEpoch = 0;

  /** Ink boxes of a block (viewport coords), measured once per layout pass. */
  private blockInk(el: Element): Rect[] {
    let r = this.frame?.ink.get(el);
    if (!r) {
      const box = el.getBoundingClientRect();
      const sig = `${Math.round(box.width)}x${Math.round(box.height)}|${el.textContent?.length}|${this.fontEpoch}`;
      const hit = this.inkCache.get(el);
      if (hit && hit.sig === sig) r = hit.rel.map((q) => ({ ...q, x: q.x + box.left, y: q.y + box.top }));
      else {
        r = inkRects(el);
        this.inkCache.set(el, { sig, rel: r.map((q) => ({ ...q, x: q.x - box.left, y: q.y - box.top })) });
      }
      this.frame?.ink.set(el, r);
    }
    return r;
  }

  private rectsOfIds(ids: Id[]): Rect[] {
    const key = ids.join(' ');
    const hit = this.frame?.rects.get(key);
    if (hit) return hit;
    const rs: Rect[] = [];
    for (const id of ids)
      (this.frame ? this.els(id) : (this.page?.querySelectorAll(`[data-nx="${id}"]`) ?? [])).forEach((e) => {
        const m = measure(e);
        if (m) rs.push(m);
      });
    this.frame?.rects.set(key, rs);
    return rs;
  }

  private rectOfIds(ids: Id[]): Rect | null {
    return union(this.rectsOfIds(ids));
  }

  /** Viewport rect of the caret stop before item `o` of block `b` (or end of block). */
  private stopRect(b: number, o: number): DOMRect | null {
    const blk = this.doc.blocks[b];
    const e = this.frame
      ? (o < blk.items.length ? this.el(blk.items[o].id, b) : (this.blockMap(b).get('eol')?.[0] ?? null))
      : o < blk.items.length ? this.el(blk.items[o].id) : this.page?.querySelector(`[data-eol="${blk.id}"]`);
    return e?.getBoundingClientRect() ?? null;
  }

  // ───────────────────────── selection ─────────────────────────


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
    if (this.mode === 'label') {
      const sel = this.labelSel();
      e.preventDefault();
      if (!sel) return;
      e.clipboardData?.setData('text/plain', this.label!.text.slice(...sel));
      if (cut) this.labelRecord('other'), this.labelInsert('');
      this.touch();
      return;
    }
    const range = this.mathSelRange;
    if (this.mode === 'math' && range) {
      // Part of a formula: copy it as LaTeX, which pastes back as structure.
      const root = this.mathItem!.root;
      const nodes = M.rowAt(root, range.path).slice(range.s, range.e);
      e.clipboardData?.setData('text/plain', `$${toLatex(nodes)}$`);
      e.preventDefault();
      if (cut) {
        this.checkpoint();
        M.takeRange(root, this.mc, range.s, range.e);
        this.msel = null;
      }
      this.touch();
      return;
    }
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
    this.pasteText(text);
  }

  /** Paste text at the caret (into the formula or note being edited, if any). */
  private pasteText(text: string) {
    if (this.mode === 'label') {
      this.labelRecord('other');
      this.labelInsert(text.replace(/\s*\n\s*/g, ' '));
      this.touch();
      return;
    }
    if (this.mode === 'math') {
      this.checkpoint();
      const range = this.mathSelRange;
      if (range) M.takeRange(this.mathItem!.root, this.mc, range.s, range.e);
      this.msel = null;
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
  /** The text or formula element at a point, looking through drawings (their click targets catch the pointer). */
  private under(x: number, y: number): Element | undefined {
    return document.elementsFromPoint(x, y).find((e) => !e.closest('svg.marks, svg.arrows, .dlabel'));
  }

  private hitTest(x: number, y: number): { pos: Pos; math?: { item: MathItem; id: Id | null; after: boolean } } | null {
    if (!this.page) return null;
    const hit = this.under(x, y);
    const mel = hit?.closest('.math');
    if (mel && this.page.contains(mel)) {
      const pos = this.findItem(mel.getAttribute('data-nx')!);
      if (pos) {
        // On a glyph (a letter, an operator, a delimiter): the node it belongs to. On
        // empty layout boxes, gaps and lines (between symbols, above short letters, a
        // fraction bar, KaTeX's stacked rows over a whole fraction): the nearest symbol,
        // not whatever structure happens to contain the point.
        let node = hit!.closest('[data-nx]');
        // (KaTeX's layout spans hold a zero-width space: that is not a glyph)
        const onGlyph = /[^\s\u200b\u2060\ufeff]/.test(hit!.textContent ?? '') && !hit!.querySelector('[data-nx]') && node !== mel;
        if (!onGlyph) {
          let nd = Infinity;
          for (const e of mel.querySelectorAll('[data-nx]')) {
            if (e.querySelector('[data-nx]')) continue;
            const r = e.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
            if (d < nd) (nd = d), (node = e);
          }
        }
        const id = node && node !== mel ? node.getAttribute('data-nx') : null;
        const r = node?.getBoundingClientRect();
        return { pos, math: { item: this.doc.blocks[pos.b].items[pos.o] as MathItem, id, after: !r || x > r.left + r.width / 2 } };
      }
    }
    // Find the block under (or nearest to) y, then the nearest caret stop on that line.
    const blocks = [...this.page.children].filter((e) => e.classList.contains('block'));
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
    this.withFrame(() => this.mouseDownInner(e));
  }

  private mouseDownInner(e: MouseEvent) {
    if (this.menu) {
      this.menu = null;
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.altKey && (this.mode === 'text' || this.mode === 'math' || this.mode === 'style' || this.mode === 'label') && this.beginAltDraw(e)) return;
    if (this.mode === 'pick') {
      const id = (this.under(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
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
    // clicking away from a note being typed keeps it, as leaving a text field would
    if (this.mode === 'label' && this.label) this.commitLabel();
    this.styling = null;
    this.hints = null;
    this.label = null;
    if (h.math && !e.shiftKey) {
      this.anchor = null;
      this.msel = null;
      this.b = h.pos.b;
      this.o = h.pos.o;
      this.mc = this.mathPos(h.math);
      this.setMode('math');
      // dragging from here selects inside the formula
      this.mathDrag = { b: h.pos.b, o: h.pos.o, from: { path: [...this.mc.path], off: this.mc.off } };
      this.dragging = true;
      return;
    }
    this.moveTo(h.pos, e.shiftKey);
    if (!e.shiftKey) this.anchor = { ...h.pos };
    this.dragging = true;
    this.goalX = null;
    this.setMode('text');
  }

  /** The caret position inside a formula for a hit. */
  private mathPos(m: { item: MathItem; id: Id | null; after: boolean }): MCursor {
    const found = m.id ? findNode(m.item.root, m.id) : null;
    if (!found) return { path: [], off: m.after ? m.item.root.length : 0 };
    // after a base means after its scripts too (not wedged between them)
    const row = M.rowAt(m.item.root, found.path);
    let off = found.i + (m.after ? 1 : 0);
    if (m.after) while (!M.isStop(row, off)) off++;
    const cur = { path: found.path, off };
    M.toStop(m.item.root, cur, 1); // at a script's left edge: into the script
    return cur;
  }

  /** A drag that started inside a formula: where, and the caret position it started at. */
  private mathDrag: { b: number; o: number; from: MCursor } | null = null;

  /**
   * Select from the drag's start to `to` inside the formula. Both ends are taken to
   * the deepest row containing both: an end inside a structure (a fraction, a root…)
   * there stands for the whole structure, as with Shift+arrows growing out of a box.
   */
  private dragMathSel(from: MCursor, to: MCursor) {
    const root = this.mathItem!.root;
    let d = 0;
    while (d < from.path.length && d < to.path.length && from.path[d].i === to.path[d].i && from.path[d].s === to.path[d].s) d++;
    const span = (c: MCursor): [number, number] => (c.path.length > d ? [c.path[d].i, c.path[d].i + 1] : [c.off, c.off]);
    const [a0, a1] = span(from), [b0, b1] = span(to);
    // same structure at the common row (both ends inside it): its parts' order decides
    // (numerator before denominator); offsets in different rows say nothing
    const forward = b0 !== a0 ? b0 > a0 : b1 !== a1 ? b1 > a1 : from.path.length > d && to.path.length > d ? to.path[d].s >= from.path[d].s : to.off >= from.off;
    const row = M.rowAt(root, from.path.slice(0, d));
    // a base takes its scripts along
    const grow = (e: number) => {
      while (e < row.length && row[e].k === 'cmd' && CMDS[(row[e] as MCmd).name]?.script) e++;
      return e;
    };
    this.mc = { path: from.path.slice(0, d), off: forward ? grow(Math.max(a1, b1)) : Math.min(a0, b0) };
    this.msel = forward ? Math.min(a0, b0) : grow(Math.max(a1, b1));
    if (this.msel === this.mc.off) this.msel = null;
  }

  // ── notes and the mouse ──

  /** Where the selected shape's resize handles go (page coordinates). */
  markEnds = $state<{ id: Id; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  /** The drawing under the mouse (its outline or its note), highlighted with its note. */
  hovered = $state<Id | null>(null);

  hover(id: Id, on: boolean) {
    if (on) this.hovered = id;
    else if (this.hovered === id) this.hovered = null;
  }

  /** Selecting inside the note being typed by dragging. */
  private labelDrag: { id: Id } | null = null;
  /** A press on a note: a drag from it moves the note. */
  private noteDrag: { id: Id; x: number; y: number; moved: boolean; from?: NoteAt } | null = null;

  /** The note element for a drawing (not the offscreen one notes are measured with). */
  private noteEl(id: Id): HTMLElement | null {
    return this.page?.querySelector<HTMLElement>(`.dlabel[data-id="${id}"]`) ?? null;
  }

  /**
   * A press on a note. In the note being typed: place the caret there (Shift extends the
   * selection, a double press takes the word, a triple one everything). Otherwise: select
   * its drawing, and a drag from here moves the note.
   */
  noteDown(id: Id, e: MouseEvent) {
    if (e.button === 1) return this.deleteDrawing(id);
    this.withFrame(() => {
      this.menu = null;
      const lb = this.label;
      if (this.mode === 'label' && lb && this.styling === id) {
        const at = labelOffsetAt(e.currentTarget as Element, e.clientX, e.clientY);
        const t = lb.text;
        if (e.detail >= 3) (lb.anchor = 0), (lb.at = t.length);
        else if (e.detail === 2) {
          let a = at, b = at;
          while (a > 0 && !/\s/.test(t[a - 1])) a--;
          while (b < t.length && !/\s/.test(t[b])) b++;
          (lb.anchor = a), (lb.at = b);
        } else if (e.shiftKey) (lb.anchor ??= lb.at), (lb.at = at);
        else (lb.anchor = null), (lb.at = at);
        if (lb.anchor === lb.at) lb.anchor = null;
        this.labelDrag = e.detail === 1 ? { id } : null;
        this.touch();
        return;
      }
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      this.noteDrag = { id, x: e.clientX, y: e.clientY, moved: false };
      this.touch();
    });
  }

  /** A drag on a drawing itself: a shape moves to what's under the mouse, an arrow bends. */
  private bodyDrag: { id: Id; x: number; y: number; moved: boolean; count: number; grab: number } | null = null;
  /** Something is being dragged (the toolbar steps aside). */
  dragBusy = $state(false);

  /**
   * A press on a drawing's outline: select it; a drag from there moves a shape onto
   * another word or symbol (keeping its size, held where it was grabbed) or bends an
   * arrow through the mouse. A middle press deletes it.
   */
  drawingDown(id: Id, e: MouseEvent) {
    if (e.button === 1) return this.deleteDrawing(id);
    if (e.button !== 0) return;
    this.withFrame(() => {
      this.menu = null;
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      // which of the shape's pieces was grabbed: it stays under the mouse
      const m = this.doc.marks.find((x) => x.id === id);
      let count = 1, grab = 0;
      if (m) {
        const us = this.unitsOf(this.locForIds(m.at));
        count = us.length;
        let best = Infinity;
        us.forEach((u, k) => {
          const r = this.rectOfIds(this.anchorIds(u));
          const d = r ? Math.abs(r.x + r.w / 2 - e.clientX) : Infinity;
          if (d < best) (best = d), (grab = k);
        });
      }
      this.bodyDrag = { id, x: e.clientX, y: e.clientY, moved: false, count, grab };
      this.touch();
    });
  }

  /** The single targets (words, math groups) a range is made of. */
  private unitsOf(l: Loc): Loc[] {
    if (l.k === 'word') return this.wordsIn(l.b).filter((w) => w.s >= l.s && w.e <= l.e);
    if (l.k === 'node') {
      const gs = groups(M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path));
      return gs.filter(([i, j]) => i >= l.i && j <= l.j).map(([i, j]) => ({ ...l, i, j }));
    }
    return [l];
  }

  /** The targets alongside one: the words of its paragraph, the groups of its formula row. */
  private unitsAround(l: Loc): Loc[] {
    if (l.k === 'word') return this.wordsIn(l.b);
    if (l.k === 'node') return groups(M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path)).map(([i, j]) => ({ ...l, i, j }));
    return [l];
  }

  private dragBody(e: MouseEvent) {
    const bd = this.bodyDrag!;
    const m = this.doc.marks.find((x) => x.id === bd.id), a = this.doc.arrows.find((x) => x.id === bd.id);
    if (!m && !a) return void (this.bodyDrag = null);
    if (!bd.moved) {
      if (Math.hypot(e.clientX - bd.x, e.clientY - bd.y) < 4) return;
      bd.moved = true;
      this.dragBusy = true;
      this.checkpoint();
    }
    if (a) {
      const fr = this.rectOfIds(a.from), tr = this.rectOfIds(a.to);
      if (fr && tr) a.bend = bendThrough(fr, tr, { x: e.clientX, y: e.clientY });
      return this.touch();
    }
    // the shape lands on what's under the mouse, the grabbed piece there, as many pieces as before
    const id = (this.under(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
    const t = id ? this.locFromId(id) : null;
    if (!t) return;
    const around = this.unitsAround(t);
    const ti = Math.max(0, around.findIndex((u) => this.sameLoc(u, t)));
    const start = Math.max(0, Math.min(ti - bd.grab, around.length - bd.count));
    const end = Math.min(around.length - 1, start + bd.count - 1);
    const span = start === end ? around[start] : (this.spanLoc(around[start], around[end]) ?? t);
    const ids = this.anchorIds(span);
    if (ids.length && ids.join() !== m!.at.join()) m!.at = ids;
    this.touch();
  }

  /** Remove a drawing (middle-click, the toolbar's ✕). */
  deleteDrawing(id: Id) {
    this.withFrame(() => {
      const ai = this.doc.arrows.findIndex((x) => x.id === id), mi = this.doc.marks.findIndex((x) => x.id === id);
      if (ai < 0 && mi < 0) return;
      this.checkpoint();
      if (ai >= 0) this.doc.arrows.splice(ai, 1);
      else this.doc.marks.splice(mi, 1);
      this.menu = null;
      if (this.styling === id) this.endDrawing();
      this.touch();
    });
  }

  /** Change a shape's kind / a drawing's colour (the toolbar). */
  setMarkKind(id: Id, kind: MarkKind) {
    const m = this.doc.marks.find((x) => x.id === id);
    if (!m || m.kind === kind) return;
    this.withFrame(() => { this.checkpoint('style'); m.kind = kind; this.lastMarkKind = kind; this.touch(); });
  }

  setInk(id: Id, color: string) {
    const d = this.drawing(id);
    if (!d || (d.color ?? '') === color) return;
    this.withFrame(() => { this.checkpoint('style'); d.color = color || undefined; this.touch(); });
  }

  /** Run one of a drawing's actions by name (the toolbar). */
  runAction(id: Id, name: string) {
    this.withFrame(() => {
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      this.drawingActions(id).find((a) => a.name === name)?.run();
      this.touch();
    });
  }

  /**
   * The wheel near the selected drawing (anywhere around it, its note, what it marks, its
   * toolbar): a shape's kind, an arrow's bend; with Shift, the colour. Once started it goes
   * on until the mouse moves, even if the drawing changes from under it. Elsewhere the page
   * scrolls as usual.
   */
  private wheelAcc = 0;
  /** Where a wheel gesture on a drawing started (it holds while the mouse stays there). */
  private wheelLock: { id: Id; x: number; y: number } | null = null;
  wheel(e: WheelEvent) {
    if (this.mode !== 'style' || !this.styling) return;
    const id = this.styling, lk = this.wheelLock;
    const held = !!lk && lk.id === id && Math.hypot(e.clientX - lk.x, e.clientY - lk.y) < 4;
    if (!held) {
      const z = this.drawingZone(id), o = this.page?.getBoundingClientRect();
      const x = e.clientX - (o?.left ?? 0), y = e.clientY - (o?.top ?? 0), M = 28;
      const near = !!z && x > z.x - M && x < z.x + z.w + M && y > z.y - M && y < z.y + z.h + M;
      if (!near && !(e.target as Element | null)?.closest?.('.dbar')) return;
      this.wheelLock = { id, x: e.clientX, y: e.clientY };
    }
    e.preventDefault();
    const d = this.drawing(id);
    if (!d) return;
    // (Shift turns the wheel sideways in some browsers)
    const delta = e.deltaY || e.deltaX;
    // one step per notch; a touchpad's many small deltas add up to one
    this.wheelAcc += delta;
    if (Math.abs(this.wheelAcc) < 40) return;
    const dir = this.wheelAcc > 0 ? 1 : -1;
    this.wheelAcc = 0;
    this.withFrame(() => {
      this.checkpoint('style');
      if (e.shiftKey) d.color = INKS[(INKS.indexOf((d.color ?? '') as (typeof INKS)[number]) + dir + INKS.length) % INKS.length] || undefined;
      else if ('kind' in d) d.kind = MARK_KINDS[(MARK_KINDS.indexOf(d.kind) + dir + MARK_KINDS.length) % MARK_KINDS.length];
      else d.bend = round(d.bend - 0.1 * dir * (this.arrowGeos[d.id]?.dir ?? 1));
      this.touch();
    });
  }

  /**
   * Where the toolbar goes (page coordinates): above the selected drawing and its note,
   * or below them when there's no room above.
   */
  get barAt(): { x: number; y: number; below: boolean } | null {
    if (this.mode !== 'style' || !this.styling || this.menu || this.dragBusy) return null;
    const o = this.page?.getBoundingClientRect();
    const parts = this.drawingParts(this.styling);
    if (!parts.length || !o) return null;
    // clear of the drawing, its note and what it marks (a brace sits under its text)
    const d = this.drawing(this.styling);
    const r = union(parts)!;
    // ...and of the text, notes and shapes around it, if it can be: try further out above
    // and below, and take whichever side needed less (above when it's a tie)
    const W = 'at' in (d ?? {}) ? 360 : 330, H = 30, cx = r.x + r.w / 2;
    const around = [
      ...[...this.page!.querySelectorAll('.dlabel[data-id]')].map((e) => relTo(fromDOM(e.getBoundingClientRect()), o)),
      ...Object.values(this.markGeos).map((g) => g.bounds),
      ...parts.slice(2).flatMap((t) => {
        const blk = this.el(('at' in (d ?? {}) ? (d as Mark).at : (d as Arrow).from)[0])?.closest('.block');
        return blk ? this.blockInk(blk).map((q) => relTo(q, o)).filter((q) => q.y < t.y + t.h + 40 && q.y + q.h > t.y - 40) : [];
      }),
    ];
    const clear = (y: number) => !around.some((q) => q.x < cx + W / 2 && q.x + q.w > cx - W / 2 && q.y < y + H && q.y + q.h > y);
    const fits = (top: number) => o.top + top > 34;
    let best: { y: number; below: boolean; d: number } | null = null;
    for (let d = 0; d <= 60 && !best; d += 6) {
      const up = r.y - 8 - H - d, down = r.y + r.h + 8 + d;
      if (fits(up) && clear(up)) best = { y: up + H, below: false, d };
      else if (clear(down)) best = { y: down, below: true, d };
    }
    best ??= fits(r.y - 8 - H) ? { y: r.y - 8, below: false, d: 0 } : { y: r.y + r.h + 8, below: true, d: 0 };
    return { x: cx, y: best.y, below: best.below };
  }

  /**
   * The pieces of a drawing on the page (page coordinates): the drawing, its note (when it
   * has one) and what it marks (an arrow: both ends).
   */
  private drawingParts(id: Id): Rect[] {
    const r0 = this.drawingRect(id), o = this.page?.getBoundingClientRect();
    if (!r0 || !o) return [];
    const parts = [r0];
    const el = this.noteEl(id);
    parts.push(el ? relTo(fromDOM(el.getBoundingClientRect()), o) : r0);
    const d = this.drawing(id);
    for (const ids of d ? ('at' in d ? [d.at] : [d.from, d.to]) : []) {
      const t = this.rectOfIds(ids);
      if (t) parts.push(relTo(t, o));
    }
    return parts;
  }

  /** All of a drawing's pieces in one box (page coordinates). */
  private drawingZone(id: Id): Rect | null {
    return union(this.drawingParts(id));
  }

  /** Double-click on a note: type in it, the caret where it was clicked. */
  noteDblClick(id: Id, e: MouseEvent) {
    if (this.mode === 'label' && this.styling === id) return; // a double press in it selects a word
    const at = labelOffsetAt(e.currentTarget as Element, e.clientX, e.clientY);
    this.withFrame(() => {
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      this.editNote(at);
      this.touch();
    });
  }

  /** Double-click on a drawing: type its note (a new one, or at the end of the one it has). */
  editNoteOf(id: Id) {
    this.withFrame(() => {
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      this.editNote();
      this.touch();
    });
  }

  private dragLabelSel(e: MouseEvent) {
    const lb = this.label, el = this.labelDrag && this.noteEl(this.labelDrag.id);
    if (!lb || !el || this.mode !== 'label') return void (this.labelDrag = null);
    const at = labelOffsetAt(el, e.clientX, e.clientY);
    if (at !== lb.at) (lb.anchor ??= lb.at), (lb.at = at);
    if (lb.anchor === lb.at) lb.anchor = null;
    this.touch();
  }

  private drawing(id: Id): Arrow | Mark | undefined {
    return this.doc.arrows.find((x) => x.id === id) ?? this.doc.marks.find((x) => x.id === id);
  }

  /** A note's offset from the middle of its drawing as drawn now (placed by hand or not). */
  private noteOffset(id: Id): NoteAt | null {
    const d = this.drawing(id);
    if (d?.note) return { ...d.note };
    const el = this.noteEl(id), o = this.page?.getBoundingClientRect();
    const g = this.markGeos[id], ag = this.arrowGeos[id];
    const c = g ? { x: g.bounds.x + g.bounds.w / 2, y: g.bounds.y + g.bounds.h / 2 } : ag?.mid;
    if (!el || !o || !c) return null;
    const r = el.getBoundingClientRect();
    return { dx: r.left + r.width / 2 - o.left - c.x, dy: r.top + r.height / 2 - o.top - c.y };
  }

  /** Dragging a note: once it has moved a few pixels it is placed by hand (one undo step). */
  private dragNote(e: MouseEvent) {
    const nd = this.noteDrag!;
    const d = this.drawing(nd.id);
    if (!d) return void (this.noteDrag = null);
    if (!nd.moved) {
      if (Math.hypot(e.clientX - nd.x, e.clientY - nd.y) < 3) return;
      const from = this.noteOffset(nd.id);
      if (!from) return void (this.noteDrag = null);
      nd.moved = true;
      nd.from = from;
      this.dragBusy = true;
      this.checkpoint();
    }
    d.note = { dx: Math.round(nd.from!.dx + e.clientX - nd.x), dy: Math.round(nd.from!.dy + e.clientY - nd.y) };
    this.touch();
  }

  // ── drawing with the mouse ──

  /** An Alt+drag drawing: where it started, and whether it draws a shape (Alt+Shift). */
  private altDraw: { start: Loc; shape: boolean } | null = null;
  /** The shape Alt+Shift+drag draws: the last one drawn. */
  private lastMarkKind: MarkKind = 'box';

  /**
   * Alt+drag from one thing to another draws an arrow; Alt+Shift+drag across a range
   * draws a shape around it (the kind drawn last). The pick highlights show it as it goes.
   */
  private beginAltDraw(e: MouseEvent): boolean {
    const id = (this.under(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
    const loc = id ? this.locFromId(id) : null;
    if (!loc) return false;
    if (this.mode === 'label' && this.label) this.commitLabel();
    if (this.mode === 'style' || this.mode === 'label') this.setMode('text');
    this.styling = null;
    this.menu = null;
    this.noteDrawReturn();
    this.anchor = null;
    this.msel = null;
    this.pick = e.shiftKey ? { phase: 'from', loc, purpose: this.lastMarkKind } : { phase: 'to', from: loc, loc, purpose: 'arrow' };
    this.altDraw = { start: loc, shape: e.shiftKey };
    this.setMode('pick');
    this.touch();
    return true;
  }

  private dragAltDraw(e: MouseEvent) {
    const ad = this.altDraw!, pk = this.pick;
    if (!pk) return void (this.altDraw = null);
    const id = (this.under(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
    const loc = id ? this.locFromId(id) : null;
    if (loc) pk.loc = ad.shape ? (this.spanLoc(ad.start, loc) ?? ad.start) : loc;
    this.touch();
  }

  private endAltDraw() {
    const ad = this.altDraw!, pk = this.pick;
    this.altDraw = null;
    if (!pk) return;
    // let go where it started: no arrow (a shape around the one thing is fine)
    if (!ad.shape && this.anchorIds(pk.loc).join() === this.anchorIds(ad.start).join()) {
      this.endDrawing();
      this.flash('alt+drag from one thing to another draws an arrow · alt+shift+drag draws a shape');
      return;
    }
    this.withFrame(() => this.pickKey('Enter'));
  }

  /** Dragging a handle of the selected arrow. */
  private handleDrag: { id: Id; part: 'from' | 'to' | 'bend' | 'start' | 'end'; fixed?: Loc } | null = null;

  beginHandleDrag(id: Id, part: 'from' | 'to' | 'bend') {
    const a = this.doc.arrows.find((x) => x.id === id);
    if (!a) return;
    this.handleDrag = { id, part };
    this.dragBusy = true;
    if (part === 'bend') this.checkpoint();
    else this.retarget(id, part);
  }

  /** Start dragging one end of the selected shape: the other end stays where it is. */
  beginMarkResize(id: Id, end: 'start' | 'end') {
    const m = this.doc.marks.find((x) => x.id === id);
    if (!m) return;
    const l = this.locForIds(m.at);
    if (l.k !== 'word' && l.k !== 'node') return this.flash('this shape can be changed with e (choose what it marks)');
    this.checkpoint();
    this.dragBusy = true;
    this.handleDrag = { id, part: end, fixed: this.edgeUnit(l, end === 'end' ? 'start' : 'end') };
  }

  private dragHandle(e: MouseEvent) {
    const hd = this.handleDrag!;
    if (hd.part === 'start' || hd.part === 'end') {
      const m = this.doc.marks.find((x) => x.id === hd.id);
      const loc = hd.fixed ? this.resizeTargetAt(hd.fixed, e.clientX, e.clientY) : null;
      const span = m && loc && hd.fixed ? this.spanLoc(hd.fixed, loc) : null;
      if (m && span) {
        const ids = this.anchorIds(span);
        if (ids.join() !== m.at.join()) m.at = ids;
      }
      this.touch();
      return;
    }
    const a = this.doc.arrows.find((x) => x.id === hd.id);
    if (!a || !this.page) return;
    if (hd.part === 'bend') {
      const fr = this.rectOfIds(a.from), tr = this.rectOfIds(a.to);
      if (fr && tr) a.bend = bendThrough(fr, tr, { x: e.clientX, y: e.clientY });
    } else if (this.pick) {
      const id = (this.under(e.clientX, e.clientY)?.closest('[data-nx]') as HTMLElement | null)?.dataset.nx;
      const loc = id ? this.locFromId(id) : null;
      if (loc) this.pick.loc = loc;
    }
    this.touch();
  }

  mouseMove(e: MouseEvent) {
    const lk = this.wheelLock;
    if (lk && Math.hypot(e.clientX - lk.x, e.clientY - lk.y) >= 4) this.wheelLock = null;
    if (!this.handleDrag && !this.dragging && !this.labelDrag && !this.noteDrag && !this.altDraw && !this.bodyDrag) return;
    this.withFrame(() => this.mouseMoveInner(e));
  }

  private mouseMoveInner(e: MouseEvent) {
    if (this.handleDrag) return this.dragHandle(e);
    if (this.labelDrag) return this.dragLabelSel(e);
    if (this.noteDrag) return this.dragNote(e);
    if (this.altDraw) return this.dragAltDraw(e);
    if (this.bodyDrag) return this.dragBody(e);
    if (!this.dragging) return;
    const h = this.hitTest(e.clientX, e.clientY);
    if (!h) return;
    const md = this.mathDrag;
    if (md) {
      if (h.math && h.pos.b === md.b && h.pos.o === md.o) {
        // still inside the formula: select inside it
        this.dragMathSel(md.from, this.mathPos(h.math));
        this.touch();
        return;
      }
      // out of it: select text, the formula as a whole
      this.mathDrag = null;
      this.msel = null;
      const forward = cmpPos(h.pos, md) > 0;
      this.anchor = { b: md.b, o: forward ? md.o : md.o + 1 };
      this.setMode('text');
    }
    // Dragging over math selects the whole item.
    const forward = !this.anchor || cmpPos(h.pos, this.anchor) >= 0;
    const p = h.math ? { b: h.pos.b, o: h.pos.o + (forward ? 1 : 0) } : h.pos;
    this.b = p.b;
    this.o = p.o;
    this.touch();
  }

  mouseUp() {
    if (this.altDraw) this.endAltDraw();
    this.dragging = false;
    this.mathDrag = null;
    this.labelDrag = null;
    this.noteDrag = null;
    this.bodyDrag = null;
    this.dragBusy = false;
    const hd = this.handleDrag;
    this.handleDrag = null;
    if (hd && hd.part !== 'bend' && this.pick?.edit) {
      this.finishRetarget(this.pick.edit, this.anchorIds(this.pick.loc));
      // dropped somewhere invalid: keep the arrow as it was
      if (this.pick) (this.pick = null), this.selectDrawing(hd.id);
    }
  }

  // ───────────────────────── layout ─────────────────────────

  /** Recompute every DOM-dependent overlay. Called after renders and resizes. */
  layout() {
    if (!this.page) return;
    const outer = this.frame;
    this.frame = { rects: new Map(), ink: new Map() };
    try {
      this.layoutFrame();
    } finally {
      this.frame = outer;
    }
  }

  private layoutFrame() {
    const page = this.page!;
    const origin = page.getBoundingClientRect();
    const rel = (r: Rect | null) => (r ? relTo(r, origin) : null);

    // Caret
    const base = this.mode === 'palette' || this.mode === 'hint' || this.mode === 'label' ? this.prevMode : this.mode;
    let caret: typeof this.caret = null;
    if (base === 'math') caret = this.mathCaret(origin);
    else if (base === 'text') {
      const blk = this.blk;
      const r = this.stopRect(this.b, this.o);
      const prev = this.o > 0 ? blk.items[this.o - 1] : null;
      const pr = prev?.t === 'c' ? this.el(prev.id, this.b)?.getBoundingClientRect() : null;
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
    this.selRects = [...this.selectionRects(origin), ...this.mathSelRects(origin)];
    this.mathFrame = this.inFormula ? this.mathFrameRect(origin) : null;

    // Pick highlights
    if (this.pick) {
      this.pickRects = {
        cur: rel(this.rectOfIds(this.anchorIds(this.pick.loc))),
        from: this.pick.from ? rel(this.rectOfIds(this.anchorIds(this.pick.from))) : null,
      };
    } else this.pickRects = { cur: null, from: null };

    // Drawings are laid out near the screen only (see `near`); the others keep their
    // last geometry while the text above them hasn't moved, else they wait to be scrolled to.
    const near = this.nearScreen(origin);
    const kept = (id: Id, tops: number[]) => {
      const k = this.geoTops.get(id);
      return !!k && k.epoch === this.geoEpoch && k.tops.length === tops.length && k.tops.every((t, i) => Math.abs(t - tops[i]) < 0.5);
    };

    // Marks (first, so arrows can attach to their outlines)
    const mgeos: Record<Id, MarkGeo> = {};
    const outlines = new Map<string, Outline>();
    const lines: Record<Id, Rect[]> = {};
    const active = new Set<Id>();
    // plain copies of the marks laid out (reading through proxies in hot loops is slow)
    const act: Mark[] = [];
    for (const pm of this.doc.marks) {
      const id = pm.id, bi = pm.at.length ? this.blockOf(pm.at[0]) : -1;
      if (bi >= 0 && !near.has(bi) && id !== this.styling) {
        const old = this.markGeos[id];
        if (old && kept(id, near.at(bi))) mgeos[id] = old;
        continue;
      }
      const m = $state.snapshot(pm) as Mark;
      // a label being typed is laid out as typed
      if (this.mode === 'label' && this.label && this.styling === m.id) m.label = this.label.text;
      act.push(m);
      active.add(m.id);
      if (bi >= 0) this.geoTops.set(m.id, { epoch: this.geoEpoch, tops: near.at(bi) });
      lines[m.id] = byLine(this.rectsOfIds(m.at)).map((r) => relTo(r, origin));
      const g = markGeo(m.kind, lines[m.id]);
      if (g) mgeos[m.id] = g;
    }
    this.frame!.marks = act;
    provisional();
    this.placeLabels(mgeos, lines, origin, active);
    if (provisional()) {
      // rows moved by typing kept their last layout; solve them properly once typing
      // pauses, a few at a time (each pass solves for up to 8ms)
      const settling = !this.quickLabels;
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.quickLabels = false;
        this.solveUntil = performance.now() + 8;
        this.spacerPasses = 0;
        try {
          this.layout();
        } finally {
          this.quickLabels = true;
          this.solveUntil = Infinity;
        }
      }, settling ? 16 : 200);
    }
    for (const m of this.doc.marks) if (mgeos[m.id]?.outline) outlines.set(idKey(m.at), mgeos[m.id].outline!);
    // the selected shape's ends, for its resize handles: on the shape itself (a brace's
    // ends, a circle's sides), wherever layout put it (a brace below the notes it contains)
    const sm = this.styling && mgeos[this.styling] && lines[this.styling]?.length ? this.styling : null;
    if (sm) {
      const g = mgeos[sm], ls = lines[sm], b = g.bounds;
      const mk = this.doc.marks.find((x) => x.id === sm);
      const under = mk?.kind === 'brace' || mk?.kind === 'underline';
      const first = ls[0], last = ls[ls.length - 1];
      const y = (r: Rect) => (under ? r.y + r.h + 4 : r.y + r.h / 2);
      // (a formula is one line, even when a sum's limits split its ink into rows)
      const inMath = !!mk?.at.length && !!this.el(mk.at[0])?.closest('.math');
      this.markEnds = ls.length === 1 || inMath
        ? { id: sm, a: { x: b.x - 1, y: b.y + b.h / 2 }, b: { x: b.x + b.w + 1, y: b.y + b.h / 2 } }
        : { id: sm, a: { x: first.x - 2, y: y(first) }, b: { x: last.x + last.w + 2, y: y(last) } };
    } else if (this.markEnds) this.markEnds = null;
    this.markGeos = mgeos;
    this.makeRoom(mgeos, origin, active, near);

    // Arrows
    const geos: Record<Id, ArrowGeo> = {};
    for (const pa of this.doc.arrows) {
      const ends = [pa.from[0], pa.to[0]].map((id) => (id ? this.blockOf(id) : -1));
      if (ends.every((bi) => bi >= 0 && !near.has(bi)) && pa.id !== this.styling && this.handleDrag?.id !== pa.id) {
        const old = this.arrowGeos[pa.id];
        if (old && kept(pa.id, ends.flatMap(near.at))) geos[pa.id] = old;
        continue;
      }
      const a = $state.snapshot(pa) as Arrow;
      if (ends.every((bi) => bi >= 0)) this.geoTops.set(a.id, { epoch: this.geoEpoch, tops: ends.flatMap(near.at) });
      const fa = rel(this.rectOfIds(a.from));
      const ta = rel(this.rectOfIds(a.to));
      if (!fa || !ta) continue;
      const g = arrowGeo(fa, ta, a.bend, { from: outlines.get(idKey(a.from)), to: outlines.get(idKey(a.to)) });
      if (g && a.note && a.label) {
        const ld = pinnedLeader({ x: g.mid.x - 2, y: g.mid.y - 2, w: 4, h: 4 }, this.pinnedBox(a, g));
        if (ld) g.leader = `M${ld[0].toFixed(1)},${ld[1].toFixed(1)} L${ld[2].toFixed(1)},${ld[3].toFixed(1)}`;
      }
      if (g) geos[a.id] = g;
    }
    this.arrowGeos = geos;

    // Keep the caret in view (after an action; not while the page is being scrolled)
    if (this.version !== this.followed) {
      this.followed = this.version;
      this.followUntil = performance.now() + 300;
    }
    if (performance.now() < this.followUntil && caret) {
      // from the caret just computed: the caret element still shows the old position until
      // the next render, and scrolling to that would jump back to where the caret was
      const scroller = page.parentElement!;
      const view = scroller.getBoundingClientRect();
      const top = origin.top + caret.r.y, bottom = top + caret.r.h, M = 8;
      if (top < view.top + M) scroller.scrollTop -= view.top + M - top;
      else if (bottom > view.bottom - M) scroller.scrollTop += bottom - (view.bottom - M);
    }
  }
  private followed = -1;
  private followUntil = 0;
  /** Rows of notes that change while typing follow their shapes; see placeLabels. */
  private quickLabels = true;
  private solveUntil = Infinity;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Where each drawing's blocks were (top, height; page coordinates) when it was last laid out. */
  private geoTops = new Map<Id, { epoch: number; tops: number[] }>();
  /** Bumped when everything has to be laid out again (width, fonts, settings). */
  private geoEpoch = 0;
  /** Lay out drawings within this many screens of the visible part (Infinity: all of them). */
  cullScreens = 1;
  /** The part of the page (page coordinates) the last layout covered. */
  private covered = { top: -Infinity, bottom: Infinity };

  /** Forget all kept geometry: the next layout redoes every drawing near the screen. */
  relayoutAll() {
    this.geoEpoch++;
    this.layout();
  }

  /**
   * The blocks near the visible part of the page (within `cullScreens` screens), plus
   * the caret's and the selection anchor's, and each block's top in page coordinates.
   */
  private nearScreen(origin: DOMRect) {
    const page = this.page!;
    const scroller = page.parentElement!;
    const boxes = new Map<number, { top: number; height: number }>();
    const box = (bi: number) => {
      let b = boxes.get(bi);
      if (!b) {
        const r = this.blockEl(bi)?.getBoundingClientRect();
        b = { top: (r?.top ?? 0) - origin.top, height: r?.height ?? 0 };
        boxes.set(bi, b);
      }
      return b;
    };
    const top = (bi: number) => box(bi).top;
    const n = this.doc.blocks.length;
    let lo = 0, hi = n - 1;
    if (Number.isFinite(this.cullScreens)) {
      const view = scroller.getBoundingClientRect();
      const h = Math.max(view.height, 200) * this.cullScreens;
      const from = view.top - origin.top - h, to = view.bottom - origin.top + h;
      this.covered = { top: from, bottom: to };
      // blocks are stacked in order: binary search for the first block ending after `from`
      const bottom = (bi: number) => (bi + 1 < n ? top(bi + 1) : Infinity);
      let a = 0, b = n - 1;
      while (a < b) {
        const m = (a + b) >> 1;
        if (bottom(m) < from) a = m + 1;
        else b = m;
      }
      lo = a;
      hi = lo;
      while (hi + 1 < n && top(hi + 1) <= to) hi++;
    } else this.covered = { top: -Infinity, bottom: Infinity };
    const extra = new Set([this.b, this.anchor?.b ?? -1]);
    // where a block is and how tall: a drawing's geometry still holds while both are unchanged
    const at = (bi: number) => [box(bi).top, box(bi).height];
    return { has: (bi: number) => (bi >= lo && bi <= hi) || extra.has(bi), top, at };
  }

  /** On scroll: lay out again once the screen gets near the edge of what was laid out. */
  scrolled() {
    if (!this.page || this.scrollQueued) return;
    this.scrollQueued = true;
    requestAnimationFrame(() => {
      this.scrollQueued = false;
      const page = this.page;
      if (!page) return;
      const view = page.parentElement!.getBoundingClientRect(), origin = page.getBoundingClientRect();
      const margin = (view.height * this.cullScreens) / 2;
      if (view.top - origin.top < this.covered.top + margin || view.bottom - origin.top > this.covered.bottom - margin) {
        this.spacerPasses = 0; // new lines to make room on: a fresh round of passes
        this.layout();
      }
    });
  }
  private scrollQueued = false;

  /** The box of a hand-placed note (page coordinates). */
  private pinnedBox(d: Mark | Arrow, g: MarkGeo | ArrowGeo): Rect {
    const s = measureLabel(d.label, Infinity, this.typingLabel === d.id);
    const c = 'bounds' in g ? { x: g.bounds.x + g.bounds.w / 2, y: g.bounds.y + g.bounds.h / 2 } : g.mid;
    return { x: c.x + d.note!.dx - s.w / 2, y: c.y + d.note!.dy - s.h / 2, w: s.w, h: s.h };
  }

  /** Place a hand-placed mark note: its label position (as LabelLayer draws it) and leader. */
  private pinNote(m: Mark, g: MarkGeo): Rect {
    const box = this.pinnedBox(m, g);
    const below = box.y + box.h / 2 > g.bounds.y + g.bounds.h / 2;
    g.label = { x: box.x + box.w / 2, y: below ? box.y + 12 : box.y + box.h - 3, below };
    const ld = pinnedLeader(g.bounds, box);
    g.leader = ld ? `M${ld[0].toFixed(1)},${ld[1].toFixed(1)} L${ld[2].toFixed(1)},${ld[3].toFixed(1)}` : undefined;
    return box;
  }

  /**
   * Lay out notes (see $lib/labels for the rules): notes along the same line
   * and side form a row laid out by `layoutRow`; the row then moves off ink on
   * its own line, other shapes and notes already placed. Braces / underlines
   * around a range containing another one's range go below it and its notes
   * (nesting level), the way nested underbraces are written.
   * Other lines are not obstacles here; makeRoom pushes those apart afterwards.
   */
  private placeLabels(geos: Record<Id, MarkGeo>, lines: Record<Id, Rect[]>, origin: DOMRect, active: Set<Id>) {
    const page = this.page!;
    const cs = getComputedStyle(page);
    const left = parseFloat(cs.paddingLeft) || 0, right = page.clientWidth - (parseFloat(cs.paddingRight) || 0);
    const UNDER = new Set<MarkKind>(['brace', 'underline']);

    // Ink of each block grouped into lines (rects overlapping vertically, transitively),
    // so a sum's limits belong to the sum's line.
    const blockLines = new Map<Element, Rect[][]>();
    const inkLines = (el: Element) => {
      let ls = blockLines.get(el);
      if (!ls) {
        ls = [];
        let bottom = -Infinity;
        for (const r of this.blockInk(el).map((r) => relTo(r, origin)).sort((a, b) => a.y - b.y)) {
          const last = ls[ls.length - 1];
          if (last && r.y < bottom - 1) last.push(r);
          else ls.push([r]);
          bottom = last && r.y < bottom - 1 ? Math.max(bottom, r.y + r.h) : r.y + r.h;
        }
        blockLines.set(el, ls);
      }
      return ls;
    };

    type Info = { m: Mark; g: MarkGeo; t: Rect; blockEl: Element; line: number; level: number };
    const infos: Info[] = [];
    for (const m of this.fMarks) {
      const g = geos[m.id];
      if (!g || !active.has(m.id)) continue;
      g.leader = undefined;
      const target = this.rectOfIds(m.at);
      const blockEl = m.at.length ? this.el(m.at[0])?.closest('.block') : null;
      if (!target || !blockEl) continue;
      const t = relTo(target, origin);
      const line = inkLines(blockEl).findIndex((l) => { const u = union(l)!; return u.y < t.y + t.h && t.y < u.y + u.h; });
      infos.push({ m, g, t, blockEl, line, level: 0 });
    }
    // nesting: an under-mark containing another under-mark's range on the same line sits below it
    const pos = new Map(infos.map((i, k) => [i, k]));
    const firstOfBlock = new Map<Element, number>();
    infos.forEach((i, k) => firstOfBlock.has(i.blockEl) || firstOfBlock.set(i.blockEl, k));
    const contains = (a: Info, b: Info) =>
      a !== b && UNDER.has(a.m.kind) && UNDER.has(b.m.kind) && a.blockEl === b.blockEl && a.line === b.line &&
      b.t.x >= a.t.x - 1 && b.t.x + b.t.w <= a.t.x + a.t.w + 1 && (b.t.w < a.t.w - 1 || pos.get(b)! < pos.get(a)!);
    // who contains whom, once (only under-marks on the same line can nest)
    const unders = infos.filter((i) => UNDER.has(i.m.kind));
    const sameLine = new Map<string, Info[]>();
    for (const u of unders) {
      const k = `${(u.blockEl as HTMLElement).dataset.nx}:${u.line}`;
      sameLine.set(k, [...(sameLine.get(k) ?? []), u]);
    }
    const inner = new Map(unders.map((a) => [a, sameLine.get(`${(a.blockEl as HTMLElement).dataset.nx}:${a.line}`)!.filter((b) => contains(a, b))]));
    for (let pass = 0; pass < 4; pass++)
      for (const a of unders) a.level = Math.max(0, ...inner.get(a)!.map((b) => b.level + 1));

    const placed: Rect[] = [];
    const noteOf = new Map<Id, Rect[]>();
    // A circle low on its line (a lower limit, a subscript) gets its note level with it, on
    // whichever side is open: above, its leader would reach past the rest of the formula.
    // If neither side is clear, below.
    // A note placed by hand stays at its offset from the drawing (a leader once it's
    // away); automatic notes keep clear of it.
    const pinned = new Set<Info>();
    for (const i of infos) {
      if (!i.m.note || !i.m.label) continue;
      const box = this.pinNote(i.m, i.g);
      pinned.add(i);
      placed.push(box);
      noteOf.set(i.m.id, [box]);
    }
    const beside = new Set<Info>();
    for (const i of infos) {
      const { m, g } = i;
      if (pinned.has(i)) continue;
      if (m.kind !== 'circle' || !m.label || !g.outline || i.line < 0) continue;
      // low compared with the ink around it (a tall sum elsewhere on the line doesn't count)
      const t = i.t, u = union([t, ...inkLines(i.blockEl)[i.line].filter((r) => r.x < t.x + t.w + 12 && t.x - 12 < r.x + r.w)])!;
      if (t.y + t.h / 2 <= u.y + u.h * 0.6) continue;
      const shape = g.outline.r;
      const others = infos.filter((o) => o !== i).map((o) => o.g.bounds);
      const r = besideNote(shape, measureLabel(m.label, Infinity, this.typingLabel === m.id), { left, right, obstacles: [...inkLines(i.blockEl)[i.line], ...others, ...placed] });
      if (!r) {
        g.label = { x: shape.x + shape.w / 2, y: shape.y + shape.h + 15, below: true };
        continue;
      }
      beside.add(i);
      placed.push(r.box);
      noteOf.set(m.id, [r.box]);
      // drawn hanging from y - 12, like a note below
      g.label = { x: r.box.x + r.box.w / 2, y: r.box.y + 12, below: true };
      if (r.leader) g.leader = `M${r.leader[0].toFixed(1)},${r.leader[1].toFixed(1)} L${r.leader[2].toFixed(1)},${r.leader[3].toFixed(1)}`;
    }
    const maxLevel = Math.max(0, ...infos.map((i) => i.level));
    for (let level = 0; level <= maxLevel; level++) {
      // nested under-marks: drop below what they contain (shapes and their notes)
      for (const a of infos.filter((i) => i.level === level && level > 0)) {
        const inside = inner.get(a) ?? [];
        // clear the shapes it contains and their notes (only those: other notes further
        // down the page move when this line makes room, which would feed back)
        const bottom = Math.max(...inside.map((b) => b.g.bounds.y + b.g.bounds.h), ...inside.flatMap((b) => noteOf.get(b.m.id) ?? []).map((r) => r.y + r.h));
        const drop = bottom + 4 - (a.t.y + a.t.h);
        if (drop > 0) {
          const g = markGeo(a.m.kind, lines[a.m.id].map((r, k, all) => (k === all.length - 1 ? { ...r, h: r.h + drop } : r)));
          if (g) Object.assign(a.g, g, pinned.has(a) ? { label: a.g.label, leader: a.g.leader } : { leader: undefined });
        }
      }
      // rows: same block, line, side and level
      const rows = new Map<string, Info[]>();
      for (const i of infos.filter((i) => i.level === level && i.m.label && !beside.has(i) && !pinned.has(i))) {
        const key = `${firstOfBlock.get(i.blockEl)}:${i.line}:${i.g.label.below}`;
        rows.set(key, [...(rows.get(key) ?? []), i]);
      }
      for (const row of rows.values()) {
        const below = row[0].g.label.below;
        const notes: RowNote[] = row.map(({ m, g }) => {
          // the note's box as LabelLayer draws it: hanging from y - 12 (below) or standing on y + 3 (above)
          const edge = below ? g.label.y - 12 : g.label.y + 3;
          const typing = this.typingLabel === m.id;
          return { id: m.id, tip: { x: g.label.x, y: below ? edge - 1 : edge + 1 }, edge, size: (maxW: number) => measureLabel(m.label, maxW, typing), key: typing ? `\u0000${m.label}` : m.label };
        });
        // keep off ink on this line, other shapes and notes already placed
        const mine = new Set(row.map((i) => i.m.id));
        const ink = row[0].line >= 0 ? inkLines(row[0].blockEl)[row[0].line] : [];
        const others = infos.filter((i) => !mine.has(i.m.id)).map((i) => i.g.bounds);
        const res = layoutRow(notes, { below, left, right, obstacles: [...ink, ...others, ...placed], quick: this.quickLabels || performance.now() > this.solveUntil });
        res.forEach((r, k) => {
          const { g } = row[k];
          const b = r.box;
          placed.push(b);
          noteOf.set(row[k].m.id, [b]);
          g.label = { ...g.label, x: b.x + b.w / 2, y: below ? b.y + 12 : b.y + b.h - 3, maxW: r.maxW === Infinity ? undefined : Math.ceil(b.w) + 1 };
          const ld = r.leader;
          if (ld) g.leader = `M${ld[0].toFixed(1)},${ld[1].toFixed(1)} L${ld[2].toFixed(1)},${ld[3].toFixed(1)}`;
        });
      }
    }
  }

  /**
   * Push lines apart where a drawing (a brace, a note, a big circle) would run
   * into the ink or notes above or below it. Only what is actually in the way
   * counts: a note below one line and a note above the next can share the gap
   * when they don't overlap sideways.
   *
   * Each affected line gets an invisible, zero-height spacer shifted up or down,
   * which the line box has to stretch to include, plus two zero-height probes
   * that mark the line's top and bottom; display formulas get padding instead.
   * Everything is measured, so this settles in a pass or two.
   */
  private makeRoom(geos: Record<Id, MarkGeo>, origin: DOMRect, active: Set<Id>, view: { has(bi: number): boolean }) {
    const page = this.page!;
    const GAP = 3;
    type Item = { anchor: Id; side: 'above' | 'below'; r: Rect };
    const items: Item[] = [];
    for (const m of this.fMarks) {
      const g = geos[m.id];
      if (!g || !active.has(m.id)) continue;
      const target = this.rectOfIds(m.at);
      if (!target) continue;
      // anchor the room on the item at the start (above) / end (below) of the target
      const anchors = m.at.flatMap((id) => {
        const el = this.el(id);
        if (el?.classList.contains('block')) return [...el.children].filter((e) => e.matches('.ch, .math')).map((e) => (e as HTMLElement).dataset.nx!);
        const it = (el?.closest('.ch, .math') as HTMLElement | null)?.dataset.nx;
        return it ? [it] : [];
      });
      if (!anchors.length) continue;
      const first = anchors[0], last = anchors[anchors.length - 1];
      const b = { x: g.bounds.x + origin.left, y: g.bounds.y + origin.top, w: g.bounds.w, h: g.bounds.h };
      if (b.y + b.h > target.y + target.h + 4) items.push({ anchor: last, side: 'below', r: b });
      if (b.y < target.y - 4) items.push({ anchor: first, side: 'above', r: b });
      if (m.label) {
        // the note as LabelLayer draws it: hanging from y - 12 (below) or standing on y + 3 (above)
        const s = measureLabel(m.label, g.label.maxW ?? Infinity, this.typingLabel === m.id);
        const x = g.label.x + origin.left - s.w / 2;
        const y = g.label.below ? g.label.y - 12 + origin.top : g.label.y + 3 - s.h + origin.top;
        items.push({ anchor: g.label.below ? last : first, side: g.label.below ? 'below' : 'above', r: { x, y, w: s.w, h: s.h } });
      }
    }

    // ink near each anchor: its own block and the blocks on either side
    const near = new Map<number, Rect[]>();
    const inkNear = (anchor: Id) => {
      const bi = this.blockOf(anchor);
      let r = near.get(bi);
      if (!r) {
        r = [bi - 1, bi, bi + 1].flatMap((i) => {
          const e = i >= 0 ? this.blockEl(i) : undefined;
          return e ? this.blockInk(e) : [];
        });
        near.set(bi, r);
      }
      return r;
    };
    const across = (a: Rect, b: Rect) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2;
    const mid = (e: Element | null) => {
      const r = e?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : null;
    };
    // The anchor's line: its edges from the probes (prose) or the formula's box (display).
    // Only ink beyond these edges is in the way; ink on the same line moves with it.
    const edges = (id: Id): { top: number; bottom: number } | null => {
      const el = this.el(id);
      if (el?.classList.contains('display')) {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }
      const t = mid(this.spEl('pt', id)), b = mid(this.spEl('pb', id));
      return t === null || b === null ? null : { top: t, bottom: b };
    };

    // How far each line has to move (negative: it could move back) so its drawings clear
    // what is under / over them. A note below a line answers to the ink of the lines
    // below; a note above a line answers to the ink and the drawings of the lines above
    // (so a pair facing each other is counted once).
    const need: Record<Id, Spacer> = {};
    const add = (id: Id, side: 'above' | 'below', v: number) => {
      const n = (need[id] ??= {});
      n[side] = Math.max(n[side] ?? -Infinity, v);
    };
    const unmeasured = new Set<string>();
    for (const it of items) {
      const r = it.r;
      const e = edges(it.anchor);
      // no probes yet: create the spacer (at rest) so the line can be measured next pass
      if (!e) { unmeasured.add(`${it.anchor}:${it.side}`); continue; }
      const ink = inkNear(it.anchor);
      if (it.side === 'below') {
        const under = ink.filter((q) => q.y >= e.bottom - 1 && across(q, r));
        add(it.anchor, 'below', under.length ? r.y + r.h + GAP - Math.min(...under.map((q) => q.y)) : -Infinity);
      } else {
        const over = [
          ...ink.filter((q) => q.y + q.h <= e.top + 1 && across(q, r)),
          // drawings hanging below the lines above (a note facing this one across the gap)
          ...items.filter((o) => o.side === 'below' && o.anchor !== it.anchor && o.r.y + o.r.h <= e.top + 1 + r.h && o.r.y < r.y && across(o.r, r)).map((o) => o.r),
        ];
        add(it.anchor, 'above', over.length ? Math.max(...over.map((q) => q.y + q.h)) + GAP - r.y : -Infinity);
      }
    }

    const next: Record<Id, Spacer> = {};
    // lines that weren't looked at keep their room
    for (const [k, v] of Object.entries(this.spacers)) {
      const bi = this.blockOf(k);
      if (bi >= 0 && !view.has(bi)) next[k] = v;
    }
    for (const key of unmeasured) {
      const [id, side] = key.split(':') as [Id, 'above' | 'below'];
      (next[id] ??= {})[side] = this.spacers[id]?.[side] ?? 0;
    }
    for (const [id, n] of Object.entries(need)) {
      const el = this.el(id);
      if (!el) continue;
      const cur = this.spacers[id] ?? {};
      const out: Spacer = next[id] ?? {};
      for (const side of ['below', 'above'] as const) {
        const v = n[side];
        const now = cur[side] ?? 0;
        if (v === undefined) continue;
        if (!Number.isFinite(v) || (now === 0 && v <= 0)) {
          // nothing to make room for; an existing spacer stays (at rest) so its probes do too
          if (cur[side] !== undefined) out[side] = 0;
          continue;
        }
        if (el.classList.contains('display')) {
          // padding moves what follows (below) or the formula itself (above) by the same amount
          out[side] = Math.min(MAX_ROOM, Math.max(0, Math.ceil(now + v)));
          continue;
        }
        const edge = mid(this.spEl(side === 'below' ? 'pb' : 'pt', id));
        const at = mid(this.spEl('sp', id, side));
        if (edge === null || at === null) { out[side] = 0; continue; } // measure next pass
        // put the spacer's point v past the line's edge; the edge follows it once it's outside
        const target = side === 'below' ? edge + v : edge - v;
        out[side] = Math.min(MAX_ROOM, Math.max(0, Math.ceil(side === 'below' ? now + (target - at) : now + (at - target))));
      }
      if (Object.keys(out).length) next[id] = out;
    }

    const same = (a: Record<Id, Spacer>, b: Record<Id, Spacer>) => {
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => b[k] && Math.abs((a[k].below ?? -1) - (b[k].below ?? -1)) <= 1 && Math.abs((a[k].above ?? -1) - (b[k].above ?? -1)) <= 1);
    };
    if (this.spacerVersion !== this.version) (this.spacerVersion = this.version), (this.spacerPasses = 0);
    // A note below one line and a note above the next both move the same gap: correcting
    // both at once overshoots. Settle the "below" spacers first, then the "above" ones.
    const moved = (k: Id) => Math.abs((next[k].below ?? 0) - (this.spacers[k]?.below ?? 0)) > 1;
    if (Object.keys(next).some(moved))
      for (const [k, v] of Object.entries(next)) if (v.above !== undefined && this.spacers[k]?.above !== undefined) v.above = this.spacers[k].above;
    if (same(next, this.spacers)) return;
    if (++this.spacerPasses > 8) return; // never loop forever on odd layouts
    for (const k of Object.keys(this.spacers)) if (!(k in next)) delete this.spacers[k];
    for (const [k, v] of Object.entries(next)) {
      const cur = this.spacers[k];
      if (!cur || cur.above !== v.above || cur.below !== v.below) this.spacers[k] = v;
    }
    tick().then(() => this.layout());
  }

  /**
   * The selection's rectangles, merged per line. Drawn as an overlay rather than
   * a class on every character: changing a selection then costs what is selected,
   * not the length of the note.
   */
  private selectionRects(origin: DOMRect): Rect[] {
    const r = this.selection;
    if (!r) return [];
    // runs of text by their line boxes, formulas by their whole box (a range's rects
    // only cover a formula's text line, not what sticks out above and below)
    const rects: DOMRect[] = [];
    const range = sharedRange();
    const run = (b: number, o0: number, o1: number) => {
      const a = this.stopEl(b, o0), z = this.el(this.doc.blocks[b].items[o1 - 1].id, b);
      if (!a || !z) return;
      range.setStartBefore(a);
      range.setEndAfter(z);
      rects.push(...range.getClientRects());
    };
    for (let b = r.s.b; b <= r.e.b; b++) {
      const items = this.doc.blocks[b].items;
      const o1 = b === r.e.b ? r.e.o : items.length;
      let start = b === r.s.b ? r.s.o : 0;
      for (let o = start; o <= o1; o++) {
        if (o < o1 && items[o].t !== 'm') continue;
        if (o > start) run(b, start, o);
        if (o < o1) {
          const m = this.el(items[o].id, b);
          if (m) rects.push(m.getBoundingClientRect());
        }
        start = o + 1;
      }
    }
    releaseRange();
    const lines: Rect[] = [];
    for (const q of rects) {
      if (!q.width || !q.height) continue;
      const line = lines.find((l) => Math.abs(l.y - q.top) < 4 || (q.top < l.y + l.h - 4 && q.bottom > l.y + 4));
      if (line) {
        const x1 = Math.max(line.x + line.w, q.right), y1 = Math.max(line.y + line.h, q.bottom);
        line.x = Math.min(line.x, q.left);
        line.y = Math.min(line.y, q.top);
        line.w = x1 - line.x;
        line.h = y1 - line.y;
      } else lines.push({ x: q.left, y: q.top, w: q.width, h: q.height });
    }
    return lines.map((l) => relTo(l, origin));
  }

  /**
   * The selection inside the formula being edited, as one box around what is selected
   * (its glyphs and its line box): a background on the selected group would only
   * cover the line box, not a fraction's or a sum's full height.
   */
  private mathSelRects(origin: DOMRect): Rect[] {
    const item = this.mathSelRange ? this.mathItem : null;
    const sel = item ? this.el(item.id, this.b)?.querySelector('.nx-sel') : null;
    if (!sel) return [];
    const box = union([fromDOM(sel.getBoundingClientRect()), ...inkRects(sel)].filter((r) => r.w || r.h));
    return box ? [relTo({ x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }, origin)] : [];
  }

  /**
   * The frame around the formula being edited: everything it draws (limits, fractions
   * and scripts reach past its line box) with some room, so a selection inside fits.
   */
  private mathFrameRect(origin: DOMRect): Rect | null {
    const item = this.mathItem;
    const mel = item ? this.el(item.id, this.b) : null;
    if (!mel) return null;
    const line = fromDOM(mel.getBoundingClientRect());
    const box = union([line, ...inkRects(mel)].filter((r) => r.w || r.h))!;
    const PX = 3, PY = 3;
    // a display formula's frame spans its line, as its block does
    const x0 = item!.display ? line.x : box.x - PX, x1 = item!.display ? line.x + line.w : box.x + box.w + PX;
    return relTo({ x: x0, y: box.y - PY, w: x1 - x0, h: box.h + 2 * PY }, origin);
  }

  /** The element at caret stop (b, o): the item there, or the end-of-line marker. */
  private stopEl(b: number, o: number): Element | null {
    const blk = this.doc.blocks[b];
    if (!blk) return null;
    if (o < blk.items.length) return this.el(blk.items[o].id, b);
    return this.frame ? (this.blockMap(b).get('eol')?.[0] ?? null) : (this.page?.querySelector(`[data-eol="${blk.id}"]`) ?? null);
  }

  private mathCaret(origin: DOMRect): typeof this.caret {
    const item = this.mathItem;
    if (!item) return null;
    const mel = this.el(item.id, this.b);
    const cel = mel?.querySelector('.nx-caret');
    if (!mel || !cel) return null;
    const row = M.rowAt(item.root, this.mc.path);
    const next = row[this.mc.off];
    let x = cel.getBoundingClientRect().left;
    if (next?.k === 'cmd' && CMDS[next.name]?.script && this.mc.off > 0) {
      const r = this.rectOfIds([next.id]);
      if (r) x = r.x;
    }
    // The caret is as tall as what it stands next to on its own row: after a base with
    // scripts or primes, that base (not the small script just before the caret);
    // for an operator with limits, the operator itself; spacing has no height of its own.
    const small = (n: MNode | undefined) => M.isAttached(n) || (n?.k === 'sym' && SPACES.has(n.v));
    const extent = (n: MNode | undefined): Rect | null => {
      if (!n) return null;
      const r = n.k === 'sym' && BIG_OPS.has(n.v)
        ? (() => { const op = this.el(n.id, this.b)?.querySelector('.mop'); return op ? fromDOM(op.getBoundingClientRect()) : null; })() ?? this.rectOfIds([n.id])
        : this.rectOfIds([n.id]);
      return r && r.h >= 4 ? r : null;
    };
    let i = this.mc.off - 1;
    while (i > 0 && small(row[i])) i--;
    let v = extent(row[i]) ?? (small(next) ? null : extent(next)) ?? extent(row[this.mc.off - 1]) ?? extent(next);
    if (!v) {
      const empty = mel.querySelector('.nx-active-row .nx-empty') ?? mel.querySelector('.nx-empty');
      v = empty ? measure(empty) : measure(mel);
    }
    if (!v) return null;
    return { r: relTo({ x: x - 1, y: v.y, w: 2, h: Math.max(v.h, 14) }, origin), shape: 'math' };
  }

  // ───────────────────────── keyboard ─────────────────────────

  key(e: KeyboardEvent) {
    this.withFrame(() => this.keyInner(e));
  }

  private keyInner(e: KeyboardEvent) {
    if (e.isComposing) return;
    // Text fields (settings, config editor) handle their own keys.
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
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
    if (k === 'C-,') {
      this.showSettings = !this.showSettings;
      this.settingsEditing = false;
      e.preventDefault();
      return;
    }
    if (this.showSettings) return; // the settings panel listens for its own keys
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
    if (k === 'C-d' && (this.mode === 'text' || this.mode === 'math')) {
      this.openPalette('draw');
      e.preventDefault();
      return;
    }
    const handled = this.menu ? this.menuKey(k) : this.runKey(k);
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
          if (this.lastSnippet && this.undoSnippet()) return true;
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
        this.openPalette('text');
        return true;
    }
    if (k.length === 1) {
      this.checkpoint('type');
      this.deleteSelection();
      this.blk.items.splice(this.o, 0, ch(k));
      this.o++;
      if (k === ' ') this.markdownShortcut();
      this.textSnippet();
      return true;
    }
    return false;
  }

  /** Last text snippet expansion, so an immediate Backspace can undo it. */
  private lastSnippet: { b: number; o: number; trigger: string; len: number } | null = null;

  private textSnippet() {
    const items = this.blk.items;
    let s = '';
    let best: { k: number; rep: string } | null = null;
    const snippets = this.config.snippets.text;
    for (let k = 1; k <= this.o && k <= 16; k++) {
      const it = items[this.o - k];
      if (it.t !== 'c') break;
      s = it.ch + s;
      if (snippets[s] !== undefined) best = { k, rep: snippets[s] };
    }
    if (!best) return;
    const repl = textWithMath(best.rep);
    items.splice(this.o - best.k, best.k, ...repl);
    this.o += repl.length - best.k;
    this.lastSnippet = { b: this.b, o: this.o, trigger: s.slice(-best.k), len: repl.length };
  }

  /** Backspace right after a snippet expanded turns it back into its trigger. */
  private undoSnippet(): boolean {
    const l = this.lastSnippet;
    this.lastSnippet = null;
    if (!l || l.b !== this.b || l.o !== this.o) return false;
    this.blk.items.splice(this.o - l.len, l.len, ...chars(l.trigger));
    this.o += l.trigger.length - l.len;
    return true;
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
    // a key that isn't typing ends LaTeX-style scripts in progress (the caret may go anywhere)
    if (k.length !== 1 && cur.auto) cur.auto = undefined;

    if (leader && k.length === 1) {
      this.checkpoint('type');
      M.settleAuto(root, cur, '\\'); // a symbol: one thing of its own
      if (k === ';') M.insertNode(root, cur, sym(';'));
      else if (GREEK_LEADER[k]) M.insertNode(root, cur, sym('\\' + GREEK_LEADER[k]));
      else M.typeChar(root, cur, k);
      return true;
    }
    const text = M.inTextSlot(root, cur);

    // Selection inside the formula.
    if (/^(S-(Left|Right|Up|Home|End)|C-a)$/.test(k)) {
      this.extendMathSel(k);
      return true;
    }
    const range = this.mathSelRange;
    if (range) {
      const { s, e } = range;
      const wrapper = text ? null : k === '/' ? cmd('frac', [[], []]) : OPENERS[k] ? cmd(OPENERS[k], [[]]) : null;
      if (k === '\\') return this.openPalette('math'), true; // the chosen command wraps the selection
      this.msel = null;
      if (wrapper) {
        this.checkpoint();
        M.wrapRange(root, cur, s, e, wrapper);
        return true;
      }
      if (k === 'Escape') return true;
      if (k === 'Left' || k === 'Right') {
        cur.off = k === 'Left' ? s : e;
        return true;
      }
      if (k === 'Backspace' || k === 'Delete' || k.length === 1) {
        this.checkpoint();
        M.takeRange(root, cur, s, e);
        if (k.length !== 1) return true;
      }
    } else this.msel = null;

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
        M.space(root, cur);
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

  /** Anchor offset of a selection inside the formula (same row as the caret). */
  msel = $state<number | null>(null);

  get mathSelRange(): MSelRange | null {
    const inMath = this.mode === 'math' || (this.mode === 'palette' && this.prevMode === 'math');
    const item = this.mathItem;
    if (this.msel === null || !inMath || !item || this.msel === this.mc.off) return null;
    const row = M.rowAt(item.root, this.mc.path);
    const [s, e] = M.alignRange(row, Math.min(this.msel, this.mc.off), Math.max(this.msel, this.mc.off));
    return { path: this.mc.path, s, e };
  }

  private extendMathSel(k: string) {
    const root = this.mathItem!.root;
    const cur = this.mc;
    if (k === 'C-a') {
      cur.path = [];
      this.msel = 0;
      cur.off = root.length;
      return;
    }
    if (this.msel === null) this.msel = cur.off;
    const row = M.rowAt(root, cur.path);
    const script = (i: number) => row[i]?.k === 'cmd' && !!CMDS[(row[i] as MCmd).name]?.script;
    // At the edge of a box, grow to the whole enclosing structure.
    const grow = (dir: 1 | -1) => {
      const st = cur.path[cur.path.length - 1];
      if (!st) return;
      cur.path = cur.path.slice(0, -1);
      const parent = M.rowAt(root, cur.path);
      let [s, e] = [st.i, st.i + 1];
      while (e < parent.length && parent[e].k === 'cmd' && CMDS[(parent[e] as MCmd).name]?.script) e++;
      [this.msel, cur.off] = dir === 1 ? [s, e] : [e, s];
    };
    switch (k) {
      case 'S-Left':
        if (cur.off === 0) return grow(-1);
        cur.off--;
        while (cur.off > 0 && script(cur.off)) cur.off--;
        return;
      case 'S-Right':
        if (cur.off === row.length) return grow(1);
        cur.off++;
        while (cur.off < row.length && script(cur.off)) cur.off++;
        return;
      case 'S-Up': return grow(1);
      case 'S-Home': cur.off = 0; return;
      case 'S-End': cur.off = row.length; return;
    }
  }

  // ── palette ──

  get paletteItems(): PaletteItem[] {
    const p = this.palette;
    if (!p) return [];
    const q = p.query;
    const draws = this.drawCommands();
    const rankDraws = (n: number) => rank(draws.map((c) => c.name), q).slice(0, n).map((n) => draws.find((c) => c.name === n)!);
    if (p.ctx === 'draw') return rankDraws(10);
    if (p.ctx === 'style') {
      const acts = this.styling ? this.drawingActions(this.styling).filter((a) => !a.keyOnly) : [];
      return rank(acts.map((c) => c.name), q).slice(0, 10).map((n) => {
        const c = acts.find((c) => c.name === n)!;
        return { name: c.name, desc: `${c.desc}  ${keyLabel(c.keys[0])}` };
      });
    }
    if (p.ctx === 'math') {
      const user = this.config.snippets.math;
      const names = [...new Set([...Object.keys(user), ...Object.keys(MATH_PALETTE)])];
      // Drawing commands join in once something is typed, after the math ones.
      const extra = q ? rankDraws(3) : [];
      const math = rank(names, q)
        .slice(0, 8 - extra.length)
        .map((n) => ({ name: n, desc: user[n] !== undefined ? user[n] : describeInserter(n) }));
      return [...math, ...extra];
    }
    const cmds = this.textCommands();
    return rank(cmds.map((c) => c.name), q)
      .slice(0, 10)
      .map((n) => cmds.find((c) => c.name === n)!);
  }

  private openPalette(ctx: 'math' | 'text' | 'draw' | 'style') {
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
        this.acceptPalette(items[p.sel]);
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

  private acceptPalette(picked: PaletteItem | undefined) {
    const p = this.palette!;
    const q = p.query;
    const name = picked?.name;
    this.closePalette();
    if (p.ctx === 'style') {
      const acts = this.styling ? this.drawingActions(this.styling) : [];
      const c = acts.find((c) => c.name === q) ?? acts.find((c) => c.name === name);
      if (c) c.run();
      else if (q) this.flash(`unknown: ${q}`);
      return;
    }
    if (p.ctx === 'draw' || picked?.draw) {
      const draws = this.drawCommands();
      const c = (p.ctx === 'draw' && draws.find((c) => c.name === q)) || draws.find((c) => c.name === name);
      if (!c) return void (q && this.flash(`unknown drawing: ${q}`));
      this.cmdSel = this.selection;
      this.anchor = null;
      c.run();
      this.cmdSel = null;
      return;
    }
    if (p.ctx === 'math') {
      const item = this.mathItem!;
      this.checkpoint();
      // Exact names win over the highlighted suggestion; user snippets win over built-ins.
      const user = this.config.snippets.math;
      const key = user[q] !== undefined || MATH_PALETTE[q] ? q : name;
      const range = this.mathSelRange;
      this.msel = null;
      if (range) {
        // With a selection, a structural command wraps it (\sqrt, \hat, \frac…); anything else replaces it.
        const ins = key && user[key] === undefined ? MATH_PALETTE[key] : undefined;
        const node = ins && 'node' in ins ? ins.node() : null;
        if (node?.k === 'cmd' && node.slots.length) {
          M.wrapRange(item.root, this.mc, range.s, range.e, node, node.name === 'root' ? 1 : ((ins as { enter?: number }).enter ?? 0));
          return;
        }
        M.takeRange(item.root, this.mc, range.s, range.e);
      }
      M.settleAuto(item.root, this.mc, '\\');
      if (key && user[key] !== undefined) M.insertParsed(item.root, this.mc, parseLatex(user[key]));
      else if (key && MATH_PALETTE[key]) M.applyInserter(item.root, this.mc, MATH_PALETTE[key]);
      else if (q) M.insertNode(item.root, this.mc, sym('\\' + q));
      return;
    }
    const c = this.textCommands().find((c) => c.name === (this.textCommands().some((c) => c.name === q) ? q : name));
    // Drawing commands act on the selection, if any; everything else just drops it.
    this.cmdSel = this.selection;
    this.anchor = null;
    if (c) c.run();
    else if (q) this.flash(`unknown command: ${q}`);
    this.cmdSel = null;
  }

  /** Commands available from `\` / `:` outside math. Intended to become user-extensible. */
  /** Drawing commands: in the text menu, the draw menu (Ctrl+D), and the math menu once you type. */
  drawCommands(): PaletteEntry[] {
    return [
      { name: 'arrow', desc: 'draw an arrow between two things', run: () => this.startArrow(), draw: true },
      ...MARK_KINDS.map((k) => ({ name: k, desc: MARK_DESC[k], run: () => this.startMark(k), draw: true })),
      { name: 'drawings', desc: 'select an arrow or shape to change it', run: () => this.selectDrawingByHint(), draw: true },
    ];
  }

  textCommands(): PaletteEntry[] {
    const setKind = (kind: BlockKind) => () => { this.checkpoint(); this.blk.kind = kind; };
    return [
      ...this.drawCommands(),
      { name: 'math', desc: 'inline math', run: () => this.insertMath(false) },
      { name: 'display', desc: 'display math block', run: () => this.insertMath(true) },
      { name: 'h1', desc: 'heading 1', run: setKind('h1') },
      { name: 'h2', desc: 'heading 2', run: setKind('h2') },
      { name: 'h3', desc: 'heading 3', run: setKind('h3') },
      { name: 'p', desc: 'paragraph', run: setKind('p') },
      { name: 'li', desc: 'list item', run: setKind('li') },
      { name: 'theme', desc: `next theme (${this.config.theme})`, run: () => this.cycleTheme() },
      { name: 'settings', desc: 'settings  ctrl+,', run: () => (this.showSettings = true) },
      { name: 'config', desc: 'edit the config file (snippets, themes, css)', run: () => this.editConfig() },
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

  // ── config ──

  /** (Re)load the config from disk and apply it. */
  async loadConfig() {
    const { config, error } = await C.loadConfig();
    this.useConfig(config);
    if (error) this.flash(error);
  }

  private useConfig(c: C.Config) {
    this.config = c;
    C.applyConfig(c);
    M.setMathSnippets(c.snippets.math);
    M.setLatexScripts(c.typing.latexScripts);
    this.geoEpoch++; // sizes may have changed
    this.touch();
  }

  /** Change some settings, apply them right away and persist. */
  async updateConfig(patch: Partial<C.Config>) {
    this.useConfig({ ...this.config, ...patch });
    try {
      await C.saveConfig($state.snapshot(this.config) as C.Config);
    } catch (e) {
      this.flash(`could not save config: ${e}`);
    }
  }

  /** Replace the whole config from edited JSON text. Returns an error message on failure. */
  async setConfigText(text: string): Promise<string | null> {
    try {
      const c = C.parseConfig(text);
      await this.updateConfig(c);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  editConfig() {
    this.showSettings = true;
    this.settingsEditing = true;
  }

  cycleTheme(dir = 1) {
    const all = C.allThemes(this.config);
    const i = all.indexOf(this.config.theme);
    const theme = all[(i + dir + all.length) % all.length];
    this.updateConfig({ theme });
    this.flash(`theme: ${theme}`);
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
      this.doc = { blocks: d.blocks, arrows: d.arrows ?? [], marks: d.marks ?? [] };
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
      case 'ids': return l.ids;
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

  /** A Loc for a text selection, trimmed of surrounding spaces. */
  private locFromSelection(r: { s: Pos; e: Pos } | null): Loc | null {
    if (!r) return null;
    const ids: Id[] = [];
    for (let b = r.s.b; b <= r.e.b; b++) {
      const items = this.doc.blocks[b].items;
      const from = b === r.s.b ? r.s.o : 0, to = b === r.e.b ? r.e.o : items.length;
      ids.push(...items.slice(from, to).filter((i) => !isSpace(i)).map((i) => i.id));
    }
    if (!ids.length) return null;
    if (r.s.b === r.e.b) {
      const items = this.doc.blocks[r.s.b].items;
      let s = r.s.o, e = r.e.o - 1;
      while (s < e && isSpace(items[s])) s++;
      while (e > s && isSpace(items[e])) e--;
      return { k: 'word', b: r.s.b, s, e };
    }
    return { k: 'ids', b: r.s.b, ids };
  }

  /** True while editing a formula (also with a menu open on top of it). */
  get inFormula(): boolean {
    return this.mode === 'math' || ((this.mode === 'palette' || this.mode === 'hint') && this.prevMode === 'math');
  }

  /** What a drawing command acts on right away: the math selection or the text selection. */
  private drawTarget(): Loc | null {
    if (this.prevMode === 'math' && this.mathItem) {
      const r = this.msel !== null && this.msel !== this.mc.off ? M.alignRange(M.rowAt(this.mathItem.root, this.mc.path), Math.min(this.msel, this.mc.off), Math.max(this.msel, this.mc.off)) : null;
      this.msel = null;
      // afterwards, continue typing after the selection
      if (r && this.drawReturn) this.drawReturn.mc.off = r[1];
      return r ? { k: 'node', b: this.b, o: this.o, path: [...this.mc.path], i: r[0], j: r[1] - 1 } : null;
    }
    return this.locFromSelection(this.cmdSel ?? this.selection);
  }

  /** Where picking starts: the piece of formula at the caret, or the word at the caret. */
  private pickStart(): Loc {
    const item = this.prevMode === 'math' ? this.mathItem : null;
    if (!item) return this.locFromCursor();
    const row = M.rowAt(item.root, this.mc.path);
    const gs = groups(row);
    const off = this.mc.off;
    // the thing just typed (left of the caret), else the one after it
    const g = gs.find(([i, j]) => off - 1 >= i && off - 1 <= j) ?? gs.find(([i]) => i >= off);
    return g ? { k: 'node', b: this.b, o: this.o, path: [...this.mc.path], i: g[0], j: g[1] } : { k: 'item', b: this.b, o: this.o };
  }

  /** Remember the formula position so finishing the drawing goes back into it. */
  private noteDrawReturn() {
    this.drawReturn = this.prevMode === 'math' && this.mathItem ? { b: this.b, o: this.o, mc: $state.snapshot(this.mc) as MCursor } : null;
  }

  /** Leave pick/style mode: back into the formula a drawing was started from, or to text. */
  private endDrawing() {
    this.styling = null;
    this.pick = null;
    const r = this.drawReturn;
    this.drawReturn = null;
    const it = r && this.doc.blocks[r.b]?.items[r.o];
    if (r && it?.t === 'm') {
      this.b = r.b;
      this.o = r.o;
      try {
        M.rowAt(it.root, r.mc.path);
        this.mc = r.mc;
      } catch {
        this.mc = { path: [], off: it.root.length };
      }
      this.setMode('math');
    } else this.setMode('text');
  }

  startArrow() {
    this.noteDrawReturn();
    const sel = this.drawTarget();
    this.anchor = null;
    if (sel) {
      // Start at the selection and suggest the next thing after it as the end.
      const ids = this.anchorIds(sel);
      const l0 = this.level0();
      const next = l0.find((l) => cmpLoc(l, sel) > 0 && !this.anchorIds(l).some((i) => ids.includes(i)));
      this.pick = { phase: 'to', from: sel, loc: next ?? l0[0] ?? sel, purpose: 'arrow' };
      this.setMode('pick');
      this.flash('arrow starts at the selection — choose where it points');
      return;
    }
    this.pick = { phase: 'from', loc: this.pickStart(), purpose: 'arrow' };
    this.setMode('pick');
    this.flash('choose where the arrow starts: arrow keys or click · Enter to confirm');
  }

  /** Draw a shape around the selection, or choose what to draw it around. */
  startMark(kind: MarkKind) {
    this.noteDrawReturn();
    const sel = this.drawTarget();
    this.anchor = null;
    if (sel) return this.addMark(kind, this.anchorIds(sel));
    this.pick = { phase: 'from', loc: this.pickStart(), purpose: kind };
    this.setMode('pick');
    this.flash(`choose what to ${MARK_VERB[kind]} · Enter to confirm`);
  }

  private addMark(kind: MarkKind, at: Id[]) {
    if (!at.length) return;
    this.checkpoint();
    const m: Mark = { id: uid(), kind, at, dash: false, label: '' };
    this.lastMarkKind = kind;
    this.doc.marks.push(m);
    this.pick = null;
    this.selectDrawing(m.id);
    this.flash(`${kind} drawn — t changes the shape, c the colour, l adds a note`);
  }

  /** Enter style mode for an arrow or mark. */
  selectDrawing(id: Id) {
    if (this.mode === 'label' && this.label) this.commitLabel();
    this.anchor = null;
    this.hints = null;
    this.palette = null;
    this.label = null;
    this.menu = null;
    this.message = '';
    this.styling = id;
    this.setMode('style');
  }

  /** The mark being styled, if the selected drawing is a mark. */
  get stylingMark(): Mark | undefined {
    return this.styling ? this.doc.marks.find((m) => m.id === this.styling) : undefined;
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
        if (pk.edit) return this.selectDrawing(pk.edit.id), (this.pick = null), true;
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
      case 'Tab': case 'f': this.hintTargets(); return true;
      case 'Home': case '0': this.pickLineEdge(-1); return true;
      case 'End': case '$': this.pickLineEdge(1); return true;
      case 'C-Home': if (l0.length) pk.loc = l0[0]; return true;
      case 'C-End': if (l0.length) pk.loc = l0[l0.length - 1]; return true;
      case 'Enter': case ' ':
        if (pk.edit) this.finishRetarget(pk.edit, this.anchorIds(l));
        else if (pk.purpose !== 'arrow') this.addMark(pk.purpose, this.anchorIds(l));
        else if (pk.phase === 'from') {
          const next = l0[idx + 1] ?? l;
          this.pick = { phase: 'to', from: l, loc: idx >= 0 ? next : l, purpose: 'arrow' };
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

  /**
   * Where a dragged shape end is (window point): the piece of the same formula row, or
   * the word of the same paragraph, nearest to it (on the nearest line, then sideways),
   * so it follows the mouse along the shape, below or beside the text.
   */
  private resizeTargetAt(fixed: Loc, x: number, y: number): Loc | null {
    let cands: Loc[] = [];
    if (fixed.k === 'word') cands = this.wordsIn(fixed.b);
    else if (fixed.k === 'node') {
      const row = M.rowAt((this.doc.blocks[fixed.b].items[fixed.o] as MathItem).root, fixed.path);
      cands = groups(row).map(([i, j]) => ({ ...fixed, i, j }));
    }
    let best: Loc | null = null, bestD = Infinity;
    for (const c of cands) {
      const r = this.rectOfIds(this.anchorIds(c));
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
  private wordsIn(b: number): Extract<Loc, { k: 'word' }>[] {
    return this.level0().filter((x): x is Extract<Loc, { k: 'word' }> => x.k === 'word' && x.b === b);
  }

  /** The first / last single target (a word, a math group) of a range. */
  private edgeUnit(l: Loc, end: 'start' | 'end'): Loc {
    if (l.k === 'word') {
      const ws = this.wordsIn(l.b).filter((w) => w.s >= l.s && w.e <= l.e);
      return (end === 'start' ? ws[0] : ws[ws.length - 1]) ?? l;
    }
    if (l.k === 'node') {
      const gs = groups(M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path));
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
  private spanLoc(a: Loc, b: Loc): Loc | null {
    if (a.k === 'word' && b.k === 'word' && a.b === b.b) {
      const s = Math.min(a.s, b.s), e = Math.max(a.e, b.e);
      return this.doc.blocks[a.b].items.slice(s, e + 1).some((i) => i.t === 'm') ? null : { k: 'word', b: a.b, s, e };
    }
    if (a.k === 'node' && b.k === 'node' && a.b === b.b && a.o === b.o) {
      let d = 0;
      while (d < a.path.length && d < b.path.length && a.path[d].i === b.path[d].i && a.path[d].s === b.path[d].s) d++;
      const path = a.path.slice(0, d);
      const gs = groups(M.rowAt((this.doc.blocks[a.b].items[a.o] as MathItem).root, path));
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
      const free = (s: number, e: number) => !this.doc.blocks[l.b].items.slice(s, e + 1).some((i) => i.t === 'm');
      if (end === 'end') {
        const w = d > 0 ? ws.find((w) => w.s > l.e) : ws.findLast((w) => w.e < l.e && w.s >= l.s);
        if (w && (d < 0 || free(l.e, w.e))) next = { ...l, e: w.e };
      } else {
        const w = d < 0 ? ws.findLast((w) => w.e < l.s) : ws.find((w) => w.s > l.s && w.e <= l.e);
        if (w && (d > 0 || free(w.s, l.s))) next = { ...l, s: w.s };
      }
    } else if (l.k === 'node') {
      const gs = groups(M.rowAt((this.doc.blocks[l.b].items[l.o] as MathItem).root, l.path));
      if (end === 'end') {
        const g = d > 0 ? gs.find(([i]) => i > l.j) : gs.findLast(([, j]) => j < l.j && j >= l.i);
        if (g) next = { ...l, j: g[1] };
      } else {
        const g = d < 0 ? gs.findLast(([, j]) => j < l.i) : gs.find(([i]) => i > l.i && i <= l.j);
        if (g) next = { ...l, i: g[0] };
      }
    } else return this.flash('change what this shape marks with e');
    if (!next) return;
    this.checkpoint('style');
    m.at = this.anchorIds(next);
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

  /** The best Loc for a set of anchor ids (so re-picking starts where the drawing is). */
  private locForIds(ids: Id[]): Loc {
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
    const pos = ids.map((id) => this.findItem(id));
    if (pos.length && pos.every((p) => p && p.b === pos[0]!.b)) {
      const os = pos.map((p) => p!.o);
      return { k: 'word', b: pos[0]!.b, s: Math.min(...os), e: Math.max(...os) };
    }
    return first ?? { k: 'ids', b: pos.find((p) => p)?.b ?? this.b, ids };
  }

  /** Re-pick one end of an arrow, or the target of a mark. */
  private retarget(id: Id, end: 'from' | 'to' | 'at') {
    const a = this.doc.arrows.find((x) => x.id === id);
    const m = this.doc.marks.find((x) => x.id === id);
    if (end === 'at' && m) {
      this.pick = { phase: 'from', loc: this.locForIds(m.at), purpose: m.kind, edit: { id, end } };
    } else if (a && end !== 'at') {
      const other = end === 'from' ? a.to : a.from;
      this.pick = { phase: 'to', loc: this.locForIds(a[end]), from: this.locForIds(other), purpose: 'arrow', edit: { id, end } };
    } else return;
    this.setMode('pick');
    this.flash(end === 'at' ? 'choose the new target · Enter to confirm · Esc to keep it' : `move the arrow's ${end === 'from' ? 'start' : 'tip'} · Enter to confirm · Esc to keep it`);
  }

  private finishRetarget(edit: { id: Id; end: 'from' | 'to' | 'at' }, ids: Id[]) {
    const a = this.doc.arrows.find((x) => x.id === edit.id);
    const m = this.doc.marks.find((x) => x.id === edit.id);
    if (a && edit.end !== 'at') {
      if ((edit.end === 'from' ? a.to : a.from).join() === ids.join()) return this.flash('arrow needs two different endpoints');
      this.checkpoint();
      a[edit.end] = ids;
    } else if (m) {
      this.checkpoint();
      m.at = ids;
    }
    this.pick = null;
    this.selectDrawing(edit.id);
  }

  /**
   * What can be done to a drawing: one table for its keys in style mode, the right-click
   * menu, the style palette (`\`) and the key hints, so they always agree. `menu: false`
   * keeps an entry out of the menu (a step that only makes sense repeated from the keys).
   */
  drawingActions(id: Id): DrawingAction[] {
    const a = this.doc.arrows.find((x) => x.id === id);
    const m = this.doc.marks.find((x) => x.id === id);
    const edit = (f: () => void) => () => { this.checkpoint('style'); f(); };
    const note = (d: Arrow | Mark): DrawingAction =>
      ({ name: 'note', desc: d.label ? 'edit the note' : 'add a note ($math$ works)', keys: ['l', 'i', '"'], run: () => this.editNote(), more: 'or double-click it' });
    const remove = (f: () => void): DrawingAction =>
      ({ name: 'delete', desc: 'remove it', keys: ['x', 'Delete', 'Backspace'], run: () => { this.checkpoint(); f(); this.endDrawing(); }, more: 'or middle-click it', sep: true });
    // a note can be moved by hand: Alt+arrows (Shift: by a pixel), Alt+0 puts it back
    const d = a ?? m;
    const placing: DrawingAction[] = d?.label
      ? [
          {
            name: 'nudge', desc: 'move the note', keys: ['A-Left', 'A-Right', 'A-Up', 'A-Down', 'A-S-Left', 'A-S-Right', 'A-S-Up', 'A-S-Down'], keyOnly: true,
            run: (k) => {
              const dir = k && /(Left|Right|Up|Down)$/.exec(k)?.[1];
              const o = dir && this.noteOffset(id);
              if (!o) return;
              const step = k!.includes('S-') ? 1 : 4;
              this.checkpoint('style');
              d.note = { dx: o.dx + (dir === 'Left' ? -step : dir === 'Right' ? step : 0), dy: o.dy + (dir === 'Up' ? -step : dir === 'Down' ? step : 0) };
            },
          },
          ...(d.note ? [{ name: 'autonote', desc: 'put the note back', keys: ['A-0'], run: () => { this.checkpoint(); delete d.note; }, more: 'it was moved by hand: drag it to move it again' }] : []),
        ]
      : [];
    const menu: DrawingAction = { name: 'menu', desc: 'this menu', keys: ['S-F10', 'ContextMenu'], run: () => this.openDrawingMenu(id), menu: false };
    if (a) {
      const dir = () => this.arrowGeos[a.id]?.dir ?? 1;
      return [
        { name: 'bend', desc: 'bend one way', keys: ['Up', 'k'], run: edit(() => (a.bend = round(a.bend + 0.1 * dir()))), menu: false },
        { name: 'unbend', desc: 'bend the other way', keys: ['Down', 'j'], run: edit(() => (a.bend = round(a.bend - 0.1 * dir()))), menu: false },
        { name: 'straight', desc: 'straighten', keys: ['0', '='], run: edit(() => (a.bend = 0)), more: 'bend it: drag its line, or the wheel near it' },
        { name: 'heads', desc: `arrowheads (${a.head === 'end' ? 'tip' : a.head})`, keys: ['t'], run: edit(() => (a.head = a.head === 'end' ? 'both' : a.head === 'both' ? 'none' : 'end')) },
        { name: 'reverse', desc: 'reverse', keys: ['r'], run: edit(() => { [a.from, a.to] = [a.to, a.from]; a.bend = -a.bend; }) },
        { name: 'dash', desc: a.dash ? 'solid line' : 'dashed line', keys: ['d'], run: edit(() => (a.dash = !a.dash)) },
        { name: 'boxes', desc: a.boxed ? 'hide the end boxes' : 'box the ends', keys: ['b'], run: edit(() => (a.boxed = !a.boxed)) },
        { name: 'colour', desc: `colour (${a.color || 'default'})`, keys: ['c'], run: edit(() => (a.color = nextInk(a.color))), more: 'or shift+wheel near it' },
        note(a),
        { name: 'start', desc: 'move the start', keys: ['s'], run: () => this.retarget(a.id, 'from'), more: 'or drag its start dot', sep: true },
        { name: 'tip', desc: 'move the tip', keys: ['e'], run: () => this.retarget(a.id, 'to'), more: 'or drag its tip dot' },
        ...placing,
        remove(() => this.doc.arrows.splice(this.doc.arrows.indexOf(a), 1)),
        menu,
      ];
    }
    if (m) {
      const shape = (d: number) => edit(() => (m.kind = MARK_KINDS[(MARK_KINDS.indexOf(m.kind) + d + MARK_KINDS.length) % MARK_KINDS.length]));
      return [
        { name: 'shape', desc: `next shape (${m.kind})`, keys: ['t', 'Right', 'Down'], run: shape(1), more: 'or the wheel near it' },
        { name: 'prevshape', desc: 'previous shape', keys: ['S-t', 'T', 'Left', 'Up'], run: shape(-1), menu: false },
        { name: 'dash', desc: m.dash ? 'solid line' : 'dashed line', keys: ['d'], run: edit(() => (m.dash = !m.dash)) },
        { name: 'colour', desc: `colour (${m.color || 'default'})`, keys: ['c'], run: edit(() => (m.color = nextInk(m.color))), more: 'or shift+wheel near it' },
        note(m),
        { name: 'target', desc: 'choose what it marks', keys: ['e', 'm'], run: () => this.retarget(m.id, 'at'), more: 'or drag the shape onto it; drag its ends to cover more or less', sep: true },
        {
          name: 'resize', desc: 'cover more / less', keys: ['S-Right', 'S-Left', 'C-S-Left', 'C-S-Right'], keyOnly: true,
          run: (k) => k && this.resizeMark(m, k.startsWith('C-') ? 'start' : 'end', /Right$/.test(k) ? 1 : -1),
        },
        ...placing,
        remove(() => this.doc.marks.splice(this.doc.marks.indexOf(m), 1)),
        menu,
      ];
    }
    return [];
  }

  private styleKey(k: string): boolean {
    const id = this.styling;
    const acts = id ? this.drawingActions(id) : [];
    if (!acts.length) { this.setMode('text'); return true; }
    switch (k) {
      case 'Escape': case 'Enter': this.endDrawing(); return true;
      case 'C-z': this.styling = null; this.undo(); return true;
      case 'C-y': case 'C-S-z': this.styling = null; this.redo(); return true;
      case '\\': case ':': this.openPalette('style'); return true;
    }
    acts.find((x) => x.keys.includes(k))?.run(k);
    return true;
  }

  /** A drawing's box on the page (page coordinates): a shape's bounds, an arrow's middle. */
  drawingRect(id: Id): Rect | null {
    const g = this.markGeos[id];
    if (g) return g.bounds;
    const a = this.arrowGeos[id];
    return a ? { x: a.mid.x - 6, y: a.mid.y - 6, w: 12, h: 12 } : null;
  }

  /** Where the palette opens (page coordinates): at the caret, or under the selected drawing. */
  get paletteAnchor(): Rect | null {
    if (this.caret) return this.caret.r;
    return this.styling ? this.drawingRect(this.styling) : null;
  }

  // ── right-click menu ──

  /** The open right-click menu, at a window position: a drawing's (`id`), or the page's. */
  menu = $state<{ id: Id | null; x: number; y: number; sel: number } | null>(null);

  get menuItems(): DrawingAction[] {
    if (!this.menu) return [];
    return this.menu.id ? this.drawingActions(this.menu.id).filter((a) => a.menu !== false && !a.keyOnly) : this.pageActions();
  }

  /** What the page's menu offers: the clipboard, drawing on the selection, undo. */
  pageActions(): DrawingAction[] {
    const sel = !!this.selection || !!this.mathSelRange;
    const what = sel ? 'the selection' : 'something';
    const clip = (cmd: 'copy' | 'cut') => () => document.execCommand(cmd);
    return [
      { name: 'cut', desc: 'cut', keys: ['C-x'], run: clip('cut'), off: !sel },
      { name: 'copy', desc: 'copy', keys: ['C-c'], run: clip('copy'), off: !sel, more: 'math is copied as LaTeX' },
      { name: 'paste', desc: 'paste', keys: ['C-v'], run: () => void this.pasteFromClipboard() },
      { name: 'all', desc: this.mode === 'math' ? 'select the formula' : 'select everything', keys: ['C-a'], run: () => this.runKey('C-a') },
      { name: 'arrow', desc: sel ? 'arrow from the selection' : 'draw an arrow', keys: ['\\arrow'], run: () => this.startArrow(), more: 'or alt+drag from one thing to another', sep: true },
      ...MARK_KINDS.map((k): DrawingAction => ({ name: k, desc: `${MARK_VERB[k]} ${what}`, keys: [`\\${k}`], run: () => this.startMark(k), more: k === this.lastMarkKind ? 'or alt+shift+drag across it' : undefined })),
      { name: 'undo', desc: 'undo', keys: ['C-z'], run: () => this.runKey('C-z'), sep: true },
      { name: 'redo', desc: 'redo', keys: ['C-y'], run: () => this.runKey('C-y') },
    ];
  }

  /**
   * Right-click on the page: its menu. Outside the selection the caret moves to the click
   * first (inside it, the selection stays, for the menu to act on).
   */
  openPageMenu(e: MouseEvent) {
    e.preventDefault();
    this.withFrame(() => {
      if (this.mode === 'label' && this.label) this.commitLabel();
      if (this.mode === 'style' || this.mode === 'pick' || this.mode === 'hint') this.endDrawing();
      if (this.mode === 'palette') this.closePalette();
      const h = this.hitTest(e.clientX, e.clientY);
      const s = this.selection;
      const inSel = !!s && !!h && !h.math && cmpPos(h.pos, s.s) >= 0 && cmpPos(h.pos, s.e) <= 0;
      const inFormula = !!h?.math && this.mode === 'math' && h.pos.b === this.b && h.pos.o === this.o && !!this.mathSelRange;
      if (h && !inSel && !inFormula) {
        this.anchor = null;
        this.msel = null;
        this.b = h.pos.b;
        this.o = h.pos.o;
        if (h.math) (this.mc = this.mathPos(h.math)), this.setMode('math');
        else this.setMode('text');
      }
      this.menu = { id: null, x: e.clientX, y: e.clientY, sel: Math.max(0, this.pageActions().findIndex((a) => !a.off)) };
      this.touch();
    });
  }

  /** Paste from the clipboard (from the menu: there's no paste event to read it from). */
  private async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.withFrame(() => { this.pasteText(text); this.touch(); });
    } catch {
      this.flash('the clipboard can\'t be read here: use ctrl+v');
    }
  }

  /** Run a key as if it had been pressed (in the current mode). */
  private runKey(k: string): boolean {
    switch (this.mode) {
      case 'text': return this.textKey(k);
      case 'math': return this.mathKey(k);
      case 'pick': return this.pickKey(k);
      case 'style': return this.styleKey(k);
      case 'hint': return this.hintKey(k);
      case 'palette': return this.paletteKey(k);
      case 'label': return this.labelKey(k);
    }
  }

  /** Select a drawing and open its menu at (x, y), or under the drawing (from the keyboard). */
  openDrawingMenu(id: Id, x?: number, y?: number) {
    this.withFrame(() => {
      if (this.styling !== id || this.mode !== 'style') this.selectDrawing(id);
      if (x === undefined || y === undefined) {
        const r = this.drawingRect(id), o = this.page?.getBoundingClientRect();
        if (!r || !o) return;
        x = o.left + r.x;
        y = o.top + r.y + r.h + 4;
      }
      this.menu = { id, x, y, sel: 0 };
      this.touch();
    });
  }

  closeMenu() {
    this.menu = null;
  }

  /** Run a menu entry (it closes first: the action may open something else). */
  runMenu(i: number) {
    const a = this.menuItems[i];
    if (a?.off) return;
    this.menu = null;
    this.withFrame(() => {
      a?.run();
      this.touch();
    });
  }

  private menuKey(k: string): boolean {
    const mn = this.menu!;
    const items = this.menuItems;
    switch (k) {
      case 'Escape': this.menu = null; return true;
      // (past entries that can't be used now)
      case 'Down': case 'j': case 'Tab': case 'C-n': mn.sel = this.menuStep(mn.sel, 1); return true;
      case 'Up': case 'k': case 'S-Tab': case 'C-p': mn.sel = this.menuStep(mn.sel, -1); return true;
      case 'Home': mn.sel = this.menuStep(-1, 1); return true;
      case 'End': mn.sel = this.menuStep(items.length, -1); return true;
      case 'Enter': case ' ': this.runMenu(mn.sel); return true;
    }
    // an entry's own key runs it straight away (any other key closes the menu and does its thing)
    const i = items.findIndex((a) => a.keys.includes(k));
    if (i >= 0) this.runMenu(i);
    else {
      this.menu = null;
      return this.runKey(k);
    }
    return true;
  }

  private menuStep(from: number, d: 1 | -1): number {
    const items = this.menuItems, n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + d * k) % n) + n) % n;
      if (!items[i].off) return i;
    }
    return Math.max(0, from);
  }

  /** Start typing the selected drawing's note. */
  private editNote(at?: number) {
    const d = this.doc.arrows.find((x) => x.id === this.styling) ?? this.stylingMark;
    if (!d) return;
    this.label = { text: d.label, at: at ?? d.label.length, anchor: null };
    this.labelHist = { undo: [], redo: [], run: null };
    this.setMode('label');
  }

  private labelKey(k: string): boolean {
    const lb = this.label!;
    switch (k) {
      case 'Escape': this.label = null; this.mode = 'style'; return true;
      case 'Enter': this.commitLabel(); return true;
    }
    // a single-line text field: caret moves, deletes and typing at the caret
    const t = lb.text;
    const wordBack = (i: number) => {
      while (i > 0 && /\s/.test(t[i - 1])) i--;
      while (i > 0 && !/\s/.test(t[i - 1])) i--;
      return i;
    };
    const wordFwd = (i: number) => {
      while (i < t.length && /\s/.test(t[i])) i++;
      while (i < t.length && !/\s/.test(t[i])) i++;
      return i;
    };
    const cut = (from: number, to: number) => {
      lb.text = t.slice(0, from) + t.slice(to);
      lb.at = from;
      lb.anchor = null;
    };
    const sel = this.labelSel();
    switch (k) {
      case 'C-z': this.labelUndo(-1); return true;
      case 'C-y': case 'C-S-z': this.labelUndo(1); return true;
      // a run of single deletes is one undo step
      case 'Backspace': case 'Delete': this.labelRecord('delete', !sel); break;
      case 'C-Backspace': case 'C-Delete': this.labelRecord('other'); break;
    }
    // where a move goes; with Shift it extends the selection, without it collapses it
    const target = (key: string): number | null => {
      switch (key) {
        case 'Left': return sel && !k.startsWith('S-') ? sel[0] : Math.max(0, lb.at - 1);
        case 'Right': return sel && !k.startsWith('S-') ? sel[1] : Math.min(t.length, lb.at + 1);
        case 'C-Left': return wordBack(lb.at);
        case 'C-Right': return wordFwd(lb.at);
        case 'Home': case 'Up': return 0;
        case 'End': case 'Down': return t.length;
      }
      return null;
    };
    const shift = /^(C-)?S-/.test(k);
    const to = target(shift ? k.replace('S-', '') : k);
    if (to !== null) {
      if (shift) lb.anchor ??= lb.at;
      else lb.anchor = null;
      lb.at = to;
      if (lb.anchor === lb.at) lb.anchor = null;
      return true;
    }
    switch (k) {
      case 'C-a': lb.anchor = 0; lb.at = t.length; if (!t) lb.anchor = null; return true;
      case 'Backspace': if (sel) cut(...sel); else if (lb.at > 0) cut(lb.at - 1, lb.at); this.labelEdited(); return true;
      case 'C-Backspace': if (sel) cut(...sel); else cut(wordBack(lb.at), lb.at); return true;
      case 'Delete': if (sel) cut(...sel); else if (lb.at < t.length) cut(lb.at, lb.at + 1); this.labelEdited(); return true;
      case 'C-Delete': if (sel) cut(...sel); else cut(lb.at, wordFwd(lb.at)); return true;
    }
    // typing on from the last letter typed is one undo step (a space starts a new one)
    if (k.length === 1) this.labelRecord('type', !sel && /\S/.test(k)), this.labelInsert(k), this.labelEdited();
    return true;
  }

  /**
   * Undo history of the note being typed (once kept, the whole note is one step of the
   * document's history). `run`: the kind of the last edit and where it left the caret, so
   * typing (or deleting) on from there joins it.
   */
  private labelHist: { undo: LabelSnap[]; redo: LabelSnap[]; run: { kind: string; at: number } | null } = { undo: [], redo: [], run: null };

  /** Remember the note before an edit, unless it continues the last one (`joins`). */
  private labelRecord(kind: 'type' | 'delete' | 'other', joins = false) {
    const lb = this.label, h = this.labelHist;
    if (!lb) return;
    const cont = joins && h.run?.kind === kind && h.run.at === lb.at && lb.anchor === null;
    if (!cont) h.undo.push({ text: lb.text, at: lb.at, anchor: lb.anchor });
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
    h.run = { kind, at: -1 };
  }

  /** After an edit: where it left the caret, for the next edit to join. */
  private labelEdited() {
    const h = this.labelHist;
    if (h.run && this.label) h.run.at = this.label.at;
  }

  /** Step back (-1) or forward (1) through the note's history. */
  private labelUndo(d: -1 | 1) {
    const lb = this.label, h = this.labelHist;
    if (!lb) return;
    const [from, to] = d < 0 ? [h.undo, h.redo] : [h.redo, h.undo];
    const s = from.pop();
    if (!s) return this.flash(d < 0 ? 'nothing to undo in this note' : 'nothing to redo in this note');
    to.push({ text: lb.text, at: lb.at, anchor: lb.anchor });
    Object.assign(lb, s);
    h.run = null;
  }

  /** Keep the note being typed (trimmed) and go back to the drawing. */
  private commitLabel() {
    const lb = this.label;
    const a = this.doc.arrows.find((x) => x.id === this.styling) ?? this.stylingMark;
    if (lb && a && a.label !== lb.text.trim()) { this.checkpoint(); a.label = lb.text.trim(); }
    this.label = null;
    this.mode = 'style';
  }

  /** The drawing whose label is being typed. */
  private get typingLabel(): Id | null {
    return this.mode === 'label' && this.label ? this.styling : null;
  }

  /** The selected part of the label being typed, [start, end), if any. */
  private labelSel(): [number, number] | null {
    const lb = this.label;
    if (!lb || lb.anchor === null || lb.anchor === lb.at) return null;
    return [Math.min(lb.anchor, lb.at), Math.max(lb.anchor, lb.at)];
  }

  /** Type or paste into the label at the caret, replacing the selection. */
  private labelInsert(s: string) {
    const lb = this.label!;
    const [a, b] = this.labelSel() ?? [lb.at, lb.at];
    lb.text = lb.text.slice(0, a) + s + lb.text.slice(b);
    lb.at = a + s.length;
    lb.anchor = null;
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

  selectDrawingByHint() {
    if (!this.page) return;
    const origin = this.page.getBoundingClientRect();
    const at = (p: { x: number; y: number }, id: Id) => ({
      rect: { x: p.x + origin.left - 6, y: p.y + origin.top - 8, w: 12, h: 16 },
      act: () => this.selectDrawing(id),
    });
    const ts = [
      ...this.doc.arrows.filter((a) => this.arrowGeos[a.id]).map((a) => at(this.arrowGeos[a.id].mid, a.id)),
      ...this.doc.marks.flatMap((m) => {
        const r = this.rectOfIds(m.at);
        return r ? [at({ x: r.x - origin.left, y: r.y - origin.top }, m.id)] : [];
      }),
    ];
    if (!ts.length) return this.flash('nothing drawn yet');
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

  /** Remove arrows and marks whose targets were deleted. */
  pruneDrawings() {
    if (!this.doc.arrows.length && !this.doc.marks.length) return;
    const sets = this.doc.blocks.map((blk) => this.idsOf(blk));
    const ids = { has: (id: Id) => sets.some((set) => set.has(id)) };
    const keep = this.doc.arrows.filter((a) => a.from.some((i) => ids.has(i)) && a.to.some((i) => ids.has(i)));
    if (keep.length !== this.doc.arrows.length) this.doc.arrows = keep;
    const marks = this.doc.marks.filter((m) => m.at.some((i) => ids.has(i)));
    if (marks.length !== this.doc.marks.length) this.doc.marks = marks;
  }

  async afterRender() {
    await tick();
    this.layout();
  }
}

// ───────────────────────── utilities ─────────────────────────

/** Spacing commands in math (no ink, so no height to size the caret by). */
const SPACES = new Set(['\\,', '\\:', '\\;', '\\!', '\\ ', '\\quad', '\\qquad', '\\enspace']);

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

/** A key as the help shows it: `S-F10` → `shift+f10`, `Delete` → `del`. */
export function keyLabel(k: string): string {
  const mods: Record<string, string> = { C: 'ctrl', S: 'shift', A: 'alt' };
  const parts = k.split('-');
  const key = parts.pop()!;
  const names: Record<string, string> = { Delete: 'del', Backspace: 'bksp', Escape: 'esc', Up: '↑', Down: '↓', Left: '←', Right: '→', ContextMenu: 'menu' };
  return [...parts.map((p) => mods[p] ?? p), names[key] ?? (key.length > 1 ? key.toLowerCase() : key)].join('+');
}

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
      P('after drawing, ↑↓ bend the arrow; t, d, c and l change heads, dashes, colour and the label.', 'li'),
      P('select some words and type \\circle, \\box, \\underline, \\highlight or \\brace to mark them up. click any drawing to change it.', 'li'),
    ],
    arrows: [],
    marks: [],
  };
  // An example arrow: from the normalizing constant to the "normalized" word.
  const frac = eq.root[3];
  const word = b1.items.slice(-11, -1).map((i) => i.id);
  doc.arrows.push({ id: uid(), from: [frac.id], to: word, bend: 0.5, head: 'end', dash: true, boxed: false, label: 'makes total mass 1' });
  doc.marks.push({ id: uid(), kind: 'brace', at: [lhs.id], dash: false, label: 'total probability', color: 'blue' });
  return doc;
}

const MARK_DESC: Record<MarkKind, string> = {
  box: 'draw a box around something',
  circle: 'circle something',
  underline: 'underline something',
  highlight: 'highlight something',
  brace: 'brace under something, with a note',
  strike: 'strike something out',
};
const MARK_VERB: Record<MarkKind, string> = {
  box: 'box', circle: 'circle', underline: 'underline', highlight: 'highlight', brace: 'put a brace under', strike: 'strike out',
};

const nextInk = (c: string | undefined) => INKS[(INKS.indexOf((c ?? '') as (typeof INKS)[number]) + 1) % INKS.length] || undefined;

/** Order-independent key for a set of anchor ids. */
const idKey = (ids: Id[]) => [...ids].sort().join(' ');

/** Reading order of two locations (block, then first offset). */
function cmpLoc(a: Loc, b: Loc): number {
  const off = (l: Loc) => (l.k === 'word' ? l.s : l.k === 'item' || l.k === 'node' ? l.o : 0);
  return a.b - b.b || off(a) - off(b);
}
