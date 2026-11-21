// Editor state and modal keyboard handling.
//
// Modes:
//   normal  — vim-style motions over items; `\` or `:` opens the command palette
//   insert  — typing prose; `$` starts inline math
//   math    — structural math editing inside one math item
//   pick    — choosing an arrow endpoint with the keyboard
//   style   — adjusting the arrow just drawn / selected
//   hint    — overlay labels; type a label to jump (transient, returns to previous mode)
//   palette — command palette (transient)
//   label   — typing an arrow label (transient)

import { tick } from 'svelte';
import { arrowGeo, defaultBend, type ArrowGeo } from './arrows';
import { docToLatex } from './export';
import { measure, relTo, union, type Rect } from './geom';
import * as M from './math/edit';
import { CMDS, GREEK_LEADER, MATH_PALETTE } from './math/defs';
import type { MCursor, Step } from './math/latex';
import { allIds, block, ch, chars, cmd, math, sym, uid, type Arrow, type Block, type BlockKind, type Doc, type Id, type MathItem, type MCmd, type MRow } from './model';

export type Mode = 'normal' | 'insert' | 'math' | 'pick' | 'style' | 'hint' | 'palette' | 'label';

export type Loc =
  | { k: 'word'; b: number; s: number; e: number }
  | { k: 'item'; b: number; o: number }
  | { k: 'node'; b: number; o: number; path: Step[]; i: number; j: number }
  | { k: 'block'; b: number };

type PaletteEntry = { name: string; desc: string; run: () => void };
type Hint = { label: string; rect: Rect; act: () => void };
type Snap = { doc: Doc; b: number; o: number };

export const THEMES = ['midnight', 'phosphor', 'paper'] as const;

const STORAGE_KEY = 'notex.doc.v1';

export class Editor {
  doc = $state<Doc>({ blocks: [block()], arrows: [] });
  mode = $state<Mode>('normal');
  /** Block index and item offset of the text cursor. */
  b = $state(0);
  o = $state(0);
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

  /** Bumped on every mutation so layout-dependent overlays recompute. */
  version = $state(0);

  // Layout results (page-relative), recomputed after each render.
  caret = $state<{ r: Rect; shape: 'bar' | 'block' | 'math' } | null>(null);
  pickRects = $state<{ cur: Rect | null; from: Rect | null }>({ cur: null, from: null });
  arrowGeos = $state<Record<Id, ArrowGeo>>({});

  page: HTMLElement | null = null;

  private prevMode: Mode = 'normal';
  private pending = '';
  private goalX: number | null = null;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private lastKind = '';
  private lastTime = 0;
  private msgTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) this.doc = JSON.parse(saved);
      else this.doc = welcomeDoc();
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
    this.msgTimer = setTimeout(() => (this.message = ''), 2500);
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(this.doc)));
    } catch {}
  }

  checkpoint(kind = 'edit') {
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
    this.o = s.o;
    this.lastKind = '';
    this.setMode('normal');
    this.clampNormal();
    this.touch();
  }
  undo = () => this.restore(this.undoStack, this.redoStack, 'undo');
  redo = () => this.restore(this.redoStack, this.undoStack, 'redo');

  setMode(m: Mode) {
    if (m !== 'hint' && m !== 'palette' && m !== 'label') this.prevMode = m;
    this.mode = m;
    this.touch();
  }

  private clampNormal() {
    const len = this.blk.items.length;
    this.o = Math.max(0, Math.min(this.o, Math.max(0, len - 1)));
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

  // ───────────────────────── layout ─────────────────────────

  /** Recompute every DOM-dependent overlay. Called after renders and resizes. */
  layout() {
    if (!this.page) return;
    const origin = this.page.getBoundingClientRect();
    const rel = (r: Rect | null) => (r ? relTo(r, origin) : null);

    // Caret
    let caret: typeof this.caret = null;
    if (this.mode === 'math' || (this.mode === 'palette' && this.prevMode === 'math')) {
      caret = this.mathCaret(origin);
    } else if (this.mode === 'normal' || this.mode === 'insert' || this.prevMode === 'insert' || this.prevMode === 'normal') {
      const blk = this.blk;
      const insert = this.mode === 'insert' || this.prevMode === 'insert';
      if (!insert && blk.items.length) {
        const it = blk.items[this.o];
        const r = it ? (it.t === 'm' ? measure(this.el(it.id)!) : this.el(it.id)?.getBoundingClientRect()) : null;
        if (r) {
          const rr = 'left' in r ? { x: r.left, y: r.top, w: Math.max(r.width, 8), h: r.height } : r;
          caret = { r: relTo(rr, origin), shape: 'block' };
        }
      } else {
        const r = this.stopRect(this.b, this.o);
        const prev = this.o > 0 ? blk.items[this.o - 1] : null;
        const pr = prev?.t === 'c' ? this.el(prev.id)?.getBoundingClientRect() : null;
        if (r) {
          // Prefer the previous char's line when wrapping put the next item on a new line.
          const useprev = pr && (blk.items[this.o]?.t !== 'c' || Math.abs(pr.top - r.top) > 4);
          const x = useprev ? pr!.right : r.left;
          const y = useprev ? pr!.top : r.top;
          const h = useprev ? pr!.height : blk.items[this.o]?.t === 'm' ? 22 : r.height;
          caret = { r: relTo({ x, y: y + (blk.items[this.o]?.t === 'm' && !useprev ? r.height / 2 - h / 2 : 0), w: 2, h }, origin), shape: 'bar' };
        }
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
    this.page.querySelector('.nx-caret')?.scrollIntoView({ block: 'nearest' });
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
    let handled = true;
    switch (this.mode) {
      case 'normal': handled = this.normalKey(k); break;
      case 'insert': handled = this.insertKey(k); break;
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

  // ── normal ──

  private normalKey(k: string): boolean {
    const p = this.pending;
    this.pending = '';
    const blk = this.blk;
    const len = blk.items.length;
    if (p === 'g') {
      if (k === 'g') { this.b = 0; this.o = 0; this.goalX = null; }
      else if (k === 'a') this.selectArrowByHint();
      return true;
    }
    if (p === 'd') {
      if (k === 'd') this.deleteBlock();
      else if (k === 'w') this.deleteWord();
      return true;
    }
    if (k !== 'j' && k !== 'k' && k !== 'Down' && k !== 'Up') this.goalX = null;
    switch (k) {
      case 'h': case 'Left': this.o = Math.max(0, this.o - 1); break;
      case 'l': case 'Right': this.o = Math.min(Math.max(0, len - 1), this.o + 1); break;
      case 'j': case 'Down': this.vertical(1, false); break;
      case 'k': case 'Up': this.vertical(-1, false); break;
      case 'w': this.wordMotion(1); break;
      case 'b': this.wordMotion(-1); break;
      case '0': case 'Home': case '^': this.o = 0; break;
      case '$': case 'End': this.o = Math.max(0, len - 1); break;
      case 'G': this.b = this.doc.blocks.length - 1; this.o = 0; break;
      case 'g': case 'd': this.pending = k; break;
      case '{': this.b = Math.max(0, this.b - 1); this.o = 0; break;
      case '}': this.b = Math.min(this.doc.blocks.length - 1, this.b + 1); this.o = 0; break;
      case 'i': this.setMode('insert'); break;
      case 'a': this.o = Math.min(len, this.o + 1); this.setMode('insert'); break;
      case 'I': this.o = 0; this.setMode('insert'); break;
      case 'A': this.o = len; this.setMode('insert'); break;
      case 'o': case 'O': {
        this.checkpoint();
        const nb = block([], blk.kind === 'li' ? 'li' : 'p');
        this.b = k === 'o' ? this.b + 1 : this.b;
        this.doc.blocks.splice(this.b, 0, nb);
        this.o = 0;
        this.setMode('insert');
        break;
      }
      case 'x': case 'Delete':
        if (len) {
          this.checkpoint();
          blk.items.splice(this.o, 1);
          this.clampNormal();
        }
        break;
      case 'D':
        this.checkpoint();
        blk.items.splice(this.o);
        this.clampNormal();
        break;
      case 'J':
        if (this.b < this.doc.blocks.length - 1) {
          this.checkpoint();
          const nxt = this.doc.blocks.splice(this.b + 1, 1)[0];
          this.o = blk.items.length;
          if (len && nxt.items.length) blk.items.push(ch(' '));
          blk.items.push(...nxt.items);
        }
        break;
      case 'Enter': case 'c':
        if (this.mathItem) this.enterMath(true);
        else if (k === 'Enter') { this.b = Math.min(this.doc.blocks.length - 1, this.b + 1); this.o = 0; }
        break;
      case 'u': this.undo(); break;
      case 'C-r': this.redo(); break;
      case '\\': case ':': this.openPalette('text'); break;
      case 'f': this.startArrow(); break;
      case '?': this.showHelp = !this.showHelp; break;
      case 'Escape': this.showHelp = false; break;
      default: return false;
    }
    return true;
  }

  private deleteBlock() {
    this.checkpoint();
    if (this.doc.blocks.length === 1) this.doc.blocks[0] = block();
    else this.doc.blocks.splice(this.b, 1);
    this.b = Math.min(this.b, this.doc.blocks.length - 1);
    this.o = 0;
  }

  private deleteWord() {
    const items = this.blk.items;
    let e = this.o;
    while (e < items.length && !isSpace(items[e])) e++;
    while (e < items.length && isSpace(items[e])) e++;
    if (e === this.o) e = this.o + 1;
    this.checkpoint();
    items.splice(this.o, e - this.o);
    this.clampNormal();
  }

  private wordMotion(dir: 1 | -1) {
    let { b, o } = this;
    const at = (b: number, o: number) => this.doc.blocks[b]?.items[o];
    const step = () => {
      o += dir;
      if (o < 0) { if (b === 0) { o = 0; return false; } b--; o = Math.max(0, this.doc.blocks[b].items.length - 1); return 'jump'; }
      if (o >= this.doc.blocks[b].items.length) { if (b === this.doc.blocks.length - 1) { o -= 1; return false; } b++; o = 0; return 'jump'; }
      return true;
    };
    if (dir === 1) {
      // skip rest of current word, then whitespace
      const startMath = at(b, o)?.t === 'm';
      if (!startMath) while (at(b, o) && !isSpace(at(b, o)!) && at(b, o)!.t !== 'm') { const r = step(); if (r !== true) break; }
      else step();
      while (at(b, o) && isSpace(at(b, o)!)) { if (step() === false) break; }
    } else {
      step();
      while (at(b, o) && isSpace(at(b, o)!)) { if (step() === false) break; }
      if (at(b, o)?.t !== 'm') while (o > 0 && at(b, o - 1) && !isSpace(at(b, o - 1)!) && at(b, o - 1)!.t !== 'm') o--;
    }
    this.b = b;
    this.o = Math.max(0, Math.min(o, Math.max(0, this.doc.blocks[b].items.length - 1)));
  }

  /** Move by visual line, keeping a goal column. */
  private vertical(dir: 1 | -1, insert: boolean) {
    const cur = this.stopRect(this.b, Math.min(this.o, this.blk.items.length)) ;
    if (!cur) return;
    const curMid = cur.top + cur.height / 2;
    if (this.goalX === null) this.goalX = insert ? cur.left : cur.left + cur.width / 2;
    const gx = this.goalX;
    let line: { top: number; bottom: number } | null = null;
    let best: { b: number; o: number; d: number } | null = null;
    const nb = this.doc.blocks.length;
    for (let b = this.b; b >= 0 && b < nb; b += dir) {
      const items = this.doc.blocks[b].items;
      const n = items.length + (insert || items.length === 0 ? 1 : 0);
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
          if (dir === 1 ? r.top > line.bottom : r.bottom < line.top) { b = -2; break; }
          continue;
        }
        const x = insert ? r.left : r.left + r.width / 2;
        const d = Math.abs(x - gx);
        if (!best || d < best.d) best = { b, o, d };
      }
      if (b === -2) break;
    }
    void curMid;
    if (best) {
      this.b = best.b;
      this.o = best.o;
      if (!insert) this.clampNormal();
    }
  }

  // ── insert ──

  private insertKey(k: string): boolean {
    const blk = this.blk;
    if (k !== 'Up' && k !== 'Down') this.goalX = null;
    switch (k) {
      case 'Escape':
        this.setMode('normal');
        this.o = Math.max(0, this.o - 1);
        this.clampNormal();
        return true;
      case 'Enter': {
        this.checkpoint();
        if (blk.kind === 'li' && blk.items.length === 0) { blk.kind = 'p'; return true; }
        const rest = blk.items.splice(this.o);
        const nb = block(rest, blk.kind === 'li' ? 'li' : 'p');
        this.doc.blocks.splice(this.b + 1, 0, nb);
        this.b++;
        this.o = 0;
        return true;
      }
      case 'Backspace': {
        if (this.o > 0) {
          const prev = blk.items[this.o - 1];
          if (prev.t === 'm') { this.o--; this.enterMath(true); return true; }
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
      case 'Delete':
        if (this.o < blk.items.length) { this.checkpoint(); blk.items.splice(this.o, 1); }
        else if (this.b < this.doc.blocks.length - 1) {
          this.checkpoint();
          blk.items.push(...this.doc.blocks.splice(this.b + 1, 1)[0].items);
        }
        return true;
      case 'Left':
        if (this.o > 0 && blk.items[this.o - 1].t === 'm') { this.o--; this.enterMath(true); }
        else if (this.o > 0) this.o--;
        else if (this.b > 0) { this.b--; this.o = this.blk.items.length; }
        return true;
      case 'Right':
        if (blk.items[this.o]?.t === 'm') this.enterMath(false);
        else if (this.o < blk.items.length) this.o++;
        else if (this.b < this.doc.blocks.length - 1) { this.b++; this.o = 0; }
        return true;
      case 'Up': this.vertical(-1, true); return true;
      case 'Down': this.vertical(1, true); return true;
      case 'Home': this.o = 0; return true;
      case 'End': this.o = blk.items.length; return true;
      case 'C-z': this.undo(); return true;
      case 'C-y': case 'C-S-z': this.redo(); return true;
      case '$': this.insertMath(false); return true;
      case '\\': this.openPalette('text'); return true;
    }
    if (k.length === 1) {
      this.checkpoint('type');
      blk.items.splice(this.o, 0, ch(k));
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
    this.mc = { path: [], off: atEnd ? m.root.length : 0 };
    this.setMode('math');
  }

  /** Leave math into insert mode, before or after the item. */
  private exitMath(after: boolean) {
    this.o += after ? 1 : 0;
    this.setMode('insert');
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
      case 'Escape': this.setMode('normal'); return true;
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
          if (!root.length) { this.blk.items.splice(this.o, 1); this.setMode('insert'); }
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
      { name: 'math', desc: 'inline math', run: () => { if (this.prevMode === 'normal' && this.blk.items.length) this.o++; this.insertMath(false); } },
      { name: 'display', desc: 'display math block', run: () => this.insertMath(true) },
      { name: 'h1', desc: 'heading 1', run: setKind('h1') },
      { name: 'h2', desc: 'heading 2', run: setKind('h2') },
      { name: 'h3', desc: 'heading 3', run: setKind('h3') },
      { name: 'p', desc: 'paragraph', run: setKind('p') },
      { name: 'li', desc: 'list item', run: setKind('li') },
      { name: 'theme', desc: `cycle theme (${this.theme})`, run: () => this.cycleTheme() },
      { name: 'export', desc: 'copy document as LaTeX', run: () => this.copy(docToLatex($state.snapshot(this.doc) as Doc), 'LaTeX') },
      { name: 'json', desc: 'copy document as JSON', run: () => this.copy(JSON.stringify($state.snapshot(this.doc)), 'JSON') },
      { name: 'import', desc: 'replace document with JSON from clipboard', run: () => this.importJSON() },
      { name: 'new', desc: 'clear the document (undoable)', run: () => { this.checkpoint(); this.doc = { blocks: [block()], arrows: [] }; this.b = 0; this.o = 0; } },
      { name: 'welcome', desc: 'load the welcome note', run: () => { this.checkpoint(); this.doc = welcomeDoc(); this.b = 0; this.o = 0; } },
      { name: 'help', desc: 'toggle key reference', run: () => (this.showHelp = !this.showHelp) },
    ];
  }

  cycleTheme() {
    this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
    try { localStorage.setItem('notex.theme', this.theme); } catch {}
    this.flash(`theme: ${this.theme}`);
  }

  private async copy(s: string, what: string) {
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
    this.flash('pick start: hjkl move · K/J out/in · H/L extend · f hints · enter confirm');
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
        this.setMode('normal');
        return true;
      case 'h': case 'Left': case 'b': move(-1); return true;
      case 'l': case 'Right': case 'w': move(1); return true;
      case 'j': case 'Down': this.pickVertical(1); return true;
      case 'k': case 'Up': this.pickVertical(-1); return true;
      case 'K': pk.loc = this.parentLoc(l); return true;
      case 'J': pk.loc = this.childLoc(l); return true;
      case 'H': case 'L': pk.loc = this.extendLoc(l, k === 'L' ? 1 : -1); return true;
      case 'f': this.hintTargets(); return true;
      case 'Enter': case ' ':
        if (pk.phase === 'from') {
          const next = l0[idx + 1] ?? l;
          this.pick = { phase: 'to', from: l, loc: idx >= 0 ? next : l };
          this.flash('pick end');
        } else this.finishArrow();
        return true;
    }
    return true;
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
    this.flash('style: j/k bend · = straight · r reverse · t heads · d dash · b box · i label · x delete · enter done');
  }

  private styleKey(k: string): boolean {
    const a = this.doc.arrows.find((x) => x.id === this.styling);
    if (!a) { this.setMode('normal'); return true; }
    const dir = this.arrowGeos[a.id]?.dir ?? 1;
    const edit = (f: () => void) => { this.checkpoint('style'); f(); };
    switch (k) {
      case 'Escape': case 'Enter': this.styling = null; this.setMode('normal'); return true;
      case 'k': edit(() => (a.bend = round(a.bend + 0.1 * dir))); return true;
      case 'j': edit(() => (a.bend = round(a.bend - 0.1 * dir))); return true;
      case '=': edit(() => (a.bend = 0)); return true;
      case 'r': edit(() => { [a.from, a.to] = [a.to, a.from]; a.bend = -a.bend; }); return true;
      case 't': edit(() => (a.head = a.head === 'end' ? 'both' : a.head === 'both' ? 'none' : 'end')); return true;
      case 'd': edit(() => (a.dash = !a.dash)); return true;
      case 'b': edit(() => (a.boxed = !a.boxed)); return true;
      case 'i': case '"': this.label = { text: a.label }; this.setMode('label'); return true;
      case 'x': case 'Delete':
        this.checkpoint();
        this.doc.arrows.splice(this.doc.arrows.indexOf(a), 1);
        this.styling = null;
        this.setMode('normal');
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
    this.prevMode = 'normal';
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
  if (e.shiftKey && base.length > 1) mods += 'S-';
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
      P('keyboard-first math notes. press ? for keys, \\ or : for commands.'),
      b1,
      b2,
      P('try it', 'h2'),
      P('in normal mode press i to type. $ starts math: try x^2 / y, ;a for alpha, sum, ->, oo.', 'li'),
      P('press f to draw an arrow: hjkl moves the selection, K/J zoom out/in, f shows jump labels.', 'li'),
      P('after drawing, j/k bend the arrow, t toggles heads, d dashes it, i adds a label.', 'li'),
    ],
    arrows: [],
  };
  // An example arrow: from the normalizing constant to the "normalized" word.
  const frac = eq.root[3];
  const word = b1.items.slice(-11, -1).map((i) => i.id);
  doc.arrows.push({ id: uid(), from: [frac.id], to: word, bend: 0.5, head: 'end', dash: true, boxed: false, label: 'makes total mass 1' });
  return doc;
}
