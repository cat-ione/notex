// Drawing and diagramming, in a diagram block or on top of the note: tools, the pen, touch
// and the mouse, keys, the selection. The editor owns the document and the undo history;
// this works on the shapes of whatever is being drawn on (the target).
//
// Input: a pen draws (on the note, even outside sketching, unless that's switched off); its
// eraser end erases. A finger draws until a pen has been seen, then it scrolls (so a palm on
// the screen does nothing). The mouse draws with the tool chosen.

import type { DrawingAction, Editor } from '../editor.svelte';
import { block, type Block, type Id } from '../model';
import { INKS } from '../marks';
import {
  attachTarget, boundsOf, boxOf, boxShape, centre, cloneShapes, detach, erased, inkShape, isBox, labelled, lineShape, lookupIn,
  lineEnds, moved, scaled, shapeAt, shapesIn, simplify, WIDTHS, bounds,
  type Box, type BoxKind, type BoxShape, type End, type LineShape, type Placed, type Pt, type Shape, type Width,
} from './shapes';

export type Tool = 'select' | 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'eraser';
/** What's drawn on: the note itself, or a diagram block. */
export type Target = { kind: 'free' } | { kind: 'block'; id: Id };

/** The tools, their keys (as in Excalidraw: a letter, or a number) and what they do. */
export const TOOLS: { tool: Tool; key: string; num: string; desc: string }[] = [
  { tool: 'select', key: 'v', num: '1', desc: 'select and move' },
  { tool: 'pen', key: 'p', num: '7', desc: 'pen' },
  { tool: 'line', key: 'l', num: '6', desc: 'line' },
  { tool: 'arrow', key: 'a', num: '5', desc: 'arrow (from box to box, it stays attached)' },
  { tool: 'rect', key: 'r', num: '2', desc: 'box' },
  { tool: 'ellipse', key: 'o', num: '4', desc: 'ellipse' },
  { tool: 'diamond', key: 'd', num: '3', desc: 'diamond' },
  { tool: 'text', key: 't', num: '8', desc: 'text ($math$ too)' },
  { tool: 'eraser', key: 'e', num: '0', desc: 'eraser' },
];
const BOX_TOOLS: Tool[] = ['rect', 'ellipse', 'diamond', 'text'];
/** A new box placed with a tap, or from the keyboard. */
const NEW_BOX = { w: 120, h: 56 };
/** How far a pointer may be from something to pick it up (more for a finger). */
const TOL = { mouse: 5, pen: 6, touch: 12 } as Record<string, number>;
/** A diagram's canvas: its height when made, and its least. */
export const DIAGRAM_H = 280;
const MIN_H = 80;
/** A diagram's grid: shapes drawn and moved in it keep to it (the dots on its canvas are twice as far apart). */
const GRID = 8;

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'a' | 'b';
type Gesture =
  | { k: 'draw'; id: number; pen: boolean; pts: number[] }
  | { k: 'shape'; id: number; from: Pt; raw: Pt; tool: Tool; attach?: Id; moved: boolean }
  | { k: 'erase'; id: number; last: Pt; hit: boolean }
  | { k: 'move'; id: number; from: Pt; orig: Shape[]; done: boolean }
  | { k: 'handle'; id: number; h: Handle; from: Pt; orig: Shape[]; box: Box; done: boolean }
  | { k: 'marquee'; id: number; from: Pt; add: Id[] }
  | { k: 'pan'; id: number; y: number; x: number; t: number; v: number; sx: number; sy: number }
  | { k: 'resize'; id: number; y: number; h: number };

export class Sketcher {
  /** What's being drawn on (null: not sketching). */
  on = $state<Target | null>(null);
  /** Started by putting a pen on the note: keys go back to typing. */
  auto = $state(false);
  tool = $state<Tool>('pen');
  color = $state('');
  width = $state<Width>(2);
  dash = $state(false);
  fill = $state(false);
  sel = $state<Id[]>([]);
  /** The shape being drawn, in the target's coordinates. */
  draft = $state.raw<Shape | null>(null);
  /** The selection rectangle being dragged. */
  marquee = $state.raw<Box | null>(null);
  /** The shape whose label is being typed. */
  editing = $state<Id | null>(null);
  /** Where each block that has drawings on it is on the page (for what's drawn on the note). */
  inkAt = $state.raw<Record<Id, Pt>>({});
  /** A pen is near the screen (hovering): fingers on the screen are a palm, and the pen draws. */
  penNear = $state(false);
  /** A pen has been used here: fingers scroll rather than draw (see touchDraws). */
  penSeen = $state(false);

  private g: Gesture | null = null;
  private lastDown: { t: number; x: number; y: number } | null = null;
  private double = false;
  private penTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPen = 0;
  private clip: Shape[] | null = null;

  constructor(private ed: Editor) {
    try {
      this.penSeen = localStorage.getItem('notex.penSeen') === '1';
    } catch {}
  }

  // ── what's drawn on ──

  get active() {
    return this.on !== null;
  }
  isOn(id: Id) {
    return this.on?.kind === 'block' && this.on.id === id;
  }
  private blockOf(id: Id): Block | undefined {
    return this.ed.doc.blocks.find((b) => b.id === id);
  }
  private get page(): HTMLElement | null {
    return this.ed.page;
  }

  /** The shapes of a target, in its coordinates (on the note: the page's). */
  shapes(t: Target | null = this.on): Shape[] {
    if (!t) return [];
    if (t.kind === 'block') return this.blockOf(t.id)?.shapes ?? [];
    return (this.ed.doc.ink ?? []).map((s) => {
      const o = this.inkAt[s.at] ?? this.offsetOf(s.at);
      return o ? (moved(s, o.x, o.y) as Placed) : s;
    });
  }

  /** The selected shapes. */
  get selected(): Shape[] {
    const ids = new Set(this.sel);
    return this.shapes().filter((s) => ids.has(s.id));
  }

  /**
   * How far down the page a drawing's anchor is: a character of the line it's on (so it goes
   * where that line goes), or a block with no text. Only the height: a drawing keeps its
   * place across the page. (null: not on the page)
   */
  private offsetOf(id: Id): Pt | null {
    const page = this.page;
    const el = page?.querySelector(`.ch[data-nx="${id}"]`) ?? page?.querySelector(`[data-bid="${id}"]`);
    if (!page || !el) return null;
    const o = page.getBoundingClientRect(), r = el.getBoundingClientRect();
    const blk = (el.closest('[data-bid]') as HTMLElement | null)?.dataset.bid;
    if (blk) this.anchorBlock.set(id, blk);
    return { x: 0, y: Math.round(r.top - o.top) };
  }
  /** The block each anchor was last seen in (for anchors that have gone since). */
  private anchorBlock = new Map<Id, Id>();

  /** Measure where the blocks with drawings on them are (after each layout). */
  measure() {
    const ink = this.ed.doc.ink;
    if (!ink?.length && !Object.keys(this.inkAt).length) return;
    const next: Record<Id, Pt> = {};
    for (const s of ink ?? []) if (!next[s.at]) next[s.at] = this.offsetOf(s.at) ?? this.inkAt[s.at] ?? { x: 0, y: 0 };
    const old = this.inkAt;
    const same = Object.keys(next).length === Object.keys(old).length && Object.entries(next).every(([k, p]) => old[k] && old[k].x === p.x && old[k].y === p.y);
    if (!same) this.inkAt = next;
  }

  /**
   * What a drawing whose top is at page height y is pinned to: in the last block starting
   * above it (not a table row), the first character of the line there; a block with no
   * text, the block.
   */
  private anchorAt(y: number): { id: Id; off: Pt } | null {
    const page = this.page;
    if (!page) return null;
    const top = page.getBoundingClientRect().top;
    let best: HTMLElement | null = null;
    for (const el of page.querySelectorAll<HTMLElement>('[data-bid]')) {
      if (el.classList.contains('tr')) continue;
      if (best && el.getBoundingClientRect().top - top > y) break;
      best = el;
    }
    if (!best) return null;
    const bid = best.dataset.bid!;
    const chars = [...best.querySelectorAll<HTMLElement>(':scope > .ch[data-nx]')];
    if (chars.length) {
      // the line at (or after) y, and its first character
      let i = chars.findIndex((c) => c.getBoundingClientRect().bottom - top >= y);
      if (i < 0) i = chars.length - 1;
      const line = chars[i].getBoundingClientRect().top;
      while (i > 0 && Math.abs(chars[i - 1].getBoundingClientRect().top - line) < 2) i--;
      const id = chars[i].dataset.nx!;
      this.anchorBlock.set(id, bid);
      return { id, off: { x: 0, y: Math.round(chars[i].getBoundingClientRect().top - top) } };
    }
    return { id: bid, off: { x: 0, y: Math.round(best.getBoundingClientRect().top - top) } };
  }

  /**
   * Put a target's shapes back, as given in its coordinates. On the note, the shapes in
   * `changed` are pinned again to the block under their top; the others stay as they were.
   */
  private write(list: Shape[], changed: Set<Id> = new Set(list.map((s) => s.id)), t: Target | null = this.on) {
    if (!t) return;
    if (t.kind === 'block') {
      const blk = this.blockOf(t.id);
      if (!blk) return;
      blk.shapes = list;
      // the canvas grows to hold what's drawn below its bottom
      const b = boundsOf(list);
      if (b && b.y + b.h + 16 > (blk.h ?? DIAGRAM_H)) blk.h = Math.ceil(b.y + b.h + 24);
      this.ed.forgetBlock(blk);
      return;
    }
    const old = new Map((this.ed.doc.ink ?? []).map((s) => [s.id, s]));
    const out: Placed[] = [];
    const at = { ...this.inkAt };
    for (const s of list) {
      if (!changed.has(s.id) && old.has(s.id)) {
        out.push(old.get(s.id)!);
        continue;
      }
      const a = this.anchorAt(bounds(s, lookupIn(list)).y);
      if (!a) continue;
      at[a.id] = a.off;
      out.push({ ...(moved(s, -a.off.x, -a.off.y) as Shape), at: a.id } as Placed);
    }
    this.inkAt = at;
    this.ed.doc.ink = out;
  }

  /** Pointer position in a target's coordinates. */
  private toSurface(e: { clientX: number; clientY: number }, t: Target | null = this.on): Pt {
    return roundPt(this.rawSurface(e, t));
  }

  private rawSurface(e: { clientX: number; clientY: number }, t: Target | null = this.on): Pt {
    if (t?.kind === 'block') {
      const svg = this.canvas(t.id);
      const m = svg?.getScreenCTM();
      if (svg && m) {
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        const blk = this.blockOf(t.id);
        return { x: Math.max(0, Math.min(blk?.w ?? 1e6, p.x)), y: Math.max(0, p.y) };
      }
    }
    const o = this.page?.getBoundingClientRect();
    return { x: e.clientX - (o?.left ?? 0), y: e.clientY - (o?.top ?? 0) };
  }

  /** A diagram's canvas (its svg). */
  canvas(id: Id): SVGSVGElement | null {
    return this.page?.querySelector(`[data-diagram="${id}"] svg.canvas`) ?? null;
  }

  /** A box in a target's coordinates, as a box on the page (for the label editor over it). */
  pageBox(b: Box, t: Target | null = this.on): Box {
    if (t?.kind !== 'block') return b;
    const svg = this.canvas(t.id), page = this.page;
    const m = svg?.getScreenCTM();
    if (!svg || !m || !page) return b;
    const o = page.getBoundingClientRect();
    const p = new DOMPoint(b.x, b.y).matrixTransform(m);
    return { x: p.x - o.left, y: p.y - o.top, w: b.w * m.a, h: b.h * m.d };
  }

  /** In a diagram, a point on its grid (alt held: where it is). */
  private snap(p: Pt, e: { altKey?: boolean }): Pt {
    if (this.on?.kind !== 'block' || e.altKey) return p;
    return { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
  }
  private snapBy(d: number, e: { altKey?: boolean }): number {
    return this.on?.kind !== 'block' || e.altKey ? d : Math.round(d / GRID) * GRID;
  }

  /** How far (in the target's units) a pointer may be from something to pick it. */
  private tol(type: string): number {
    const t = TOL[type] ?? 5;
    const svg = this.on?.kind === 'block' ? this.canvas(this.on.id) : null;
    const scale = svg?.getScreenCTM()?.a ?? 1;
    return t / (scale || 1);
  }

  // ── starting and stopping ──

  /** Start drawing on a target (the note, or a diagram block). */
  enter(t: Target, o: { auto?: boolean; tool?: Tool } = {}) {
    const same = this.on && JSON.stringify(this.on) === JSON.stringify(t);
    if (!same) this.sel = [];
    this.on = t;
    this.auto = !!o.auto;
    if (o.tool) this.tool = o.tool;
    if (this.ed.mode !== 'sketch') this.ed.setMode('sketch');
    if (t.kind === 'block') {
      const b = this.ed.doc.blocks.findIndex((x) => x.id === t.id);
      if (b >= 0) this.ed.placeCaret(b, 0);
    }
    this.ed.touch();
  }

  /** Stop drawing: back to the text (after a diagram: at it). */
  exit() {
    if (!this.on) return;
    this.commitLabel();
    this.on = null;
    this.auto = false;
    this.lastDown = null;
    this.sel = [];
    this.draft = null;
    this.marquee = null;
    this.g = null;
    if (this.ed.mode === 'sketch') this.ed.setMode('text');
  }

  /** Drawing on the note, on or off (the toolbar's pen, ctrl+shift+d). */
  toggleFree() {
    if (this.on?.kind === 'free') this.exit();
    else this.enter({ kind: 'free' }, { tool: this.tool === 'select' || this.tool === 'eraser' ? 'pen' : this.tool });
  }

  /** A new diagram block at the caret, drawn on at once. */
  insertDiagram() {
    const ed = this.ed;
    // as wide as the text (the page less its margins)
    const page = ed.page, cs = page && getComputedStyle(page);
    const inner = page && cs ? page.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 720;
    const w = Math.round(Math.min(Math.max(200, inner), 1200));
    const d = Object.assign(block([], 'diagram'), { w, h: DIAGRAM_H, shapes: [] as Shape[] });
    ed.insertBlock(d);
    this.enter({ kind: 'block', id: d.id }, { tool: 'rect' });
  }

  /** Fingers draw (no pen seen, or set so), or scroll. */
  get touchDraws(): boolean {
    const t = this.ed.config.sketch.touch;
    return t === 'draw' || (t === 'auto' && !this.penSeen);
  }

  private sawPen() {
    this.lastPen = performance.now();
    if (!this.penSeen) {
      this.penSeen = true;
      try {
        localStorage.setItem('notex.penSeen', '1');
      } catch {}
    }
  }

  /** A pen hovering (or leaving): fingers then are a palm, and the page doesn't pan under the pen. */
  penHover(e: PointerEvent, near: boolean) {
    if (e.pointerType !== 'pen') return;
    this.sawPen();
    clearTimeout(this.penTimer);
    this.penNear = near;
    // (some pens never say they've gone)
    if (near) this.penTimer = setTimeout(() => (this.penNear = false), 2000);
  }

  // ── pointers ──

  /**
   * A pointer went down on the page. Returns whether drawing took it (the editor then
   * leaves it alone). `canvas`: the diagram it went down on, if any.
   */
  pointerDown(e: PointerEvent, canvas: Id | null): boolean {
    const ed = this.ed;
    const type = e.pointerType;
    if (type === 'pen') this.sawPen();
    // a palm while the pen is near or drawing
    if (type === 'touch' && (this.penNear || performance.now() - this.lastPen < 600 || this.g?.k === 'draw' && this.g.pen)) return !!this.on || this.penSeen;
    if (this.g && e.pointerId !== this.g.id) {
      // a second finger: whatever the first was doing becomes a scroll
      if (type === 'touch' && this.g.k === 'draw' && !this.g.pen) this.draft = null;
      if (type === 'touch') this.g = { k: 'pan', id: e.pointerId, y: e.clientY, x: e.clientX, t: e.timeStamp, v: 0, sx: e.clientX, sy: e.clientY };
      return true;
    }
    const eraserEnd = type === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (!this.on) {
      const penDraws = type === 'pen' && ed.config.sketch.penDraws && (ed.mode === 'text' || ed.mode === 'math' || ed.mode === 'style');
      if (penDraws) {
        const tool = eraserEnd ? 'eraser' : this.tool === 'select' ? 'pen' : this.tool;
        this.enter(canvas ? { kind: 'block', id: canvas } : { kind: 'free' }, { auto: true, tool });
      } else if (canvas && e.button === 0 && type !== 'pen') {
        // a click (or tap) on a diagram: into it, to select and move what's there
        this.enter({ kind: 'block', id: canvas }, { tool: 'select' });
        if (type === 'touch') return true;
      } else if (type === 'touch' && this.penSeen && ed.config.sketch.penDraws) {
        // (the page doesn't scroll by itself while a pen may draw on it: fingers scroll it here)
        this.g = { k: 'pan', id: e.pointerId, y: e.clientY, x: e.clientX, t: e.timeStamp, v: 0, sx: e.clientX, sy: e.clientY };
        return true;
      } else return false;
    } else if (this.on.kind === 'block' && canvas !== this.on.id) {
      if (canvas) this.enter({ kind: 'block', id: canvas }, { tool: this.tool });
      else {
        // outside the diagram: back to the text, the click acting there
        this.exit();
        return false;
      }
    }
    if (e.button === 2) return false;
    this.commitLabel();
    if (type === 'touch' && !this.touchDraws) {
      this.g = { k: 'pan', id: e.pointerId, y: e.clientY, x: e.clientX, t: e.timeStamp, v: 0, sx: e.clientX, sy: e.clientY };
      return true;
    }
    const p = this.toSurface(e);
    const tool: Tool = eraserEnd ? 'eraser' : this.tool;
    const id = e.pointerId;
    // a second press soon after, near the first: a double-click (or double tap)
    const now = e.timeStamp, last = this.lastDown;
    this.double = !!last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8;
    this.lastDown = this.double ? null : { t: now, x: e.clientX, y: e.clientY };
    if (tool === 'eraser') {
      this.g = { k: 'erase', id, last: p, hit: false };
      this.eraseTo(p, type);
    } else if (tool === 'pen') {
      this.g = { k: 'draw', id, pen: type === 'pen', pts: [p.x, p.y, this.pressure(e)] };
      this.draft = inkShape(this.g.pts.slice(), type === 'pen', this.style());
    } else if (tool === 'select' && type === 'pen' && !this.handleAt(p, type) && !shapeAt(this.shapes(), p, this.tol(type))) {
      // a pen with the select tool: on a shape, it selects; anywhere else it draws
      this.sel = [];
      this.g = { k: 'draw', id, pen: true, pts: [p.x, p.y, this.pressure(e)] };
      this.draft = inkShape(this.g.pts.slice(), true, this.style());
    } else if (tool === 'select') this.selectDown(e, p);
    else if (tool === 'text') {
      const hit = attachTarget(this.shapes(), p, this.tol(type));
      if (hit) return this.select([hit.id]), this.editLabel(hit.id), true;
      const q = this.snap(p, e);
      this.addBox('text', { x: q.x, y: q.y - 12, w: 40, h: 24 });
    } else {
      const attach = tool === 'line' || tool === 'arrow' ? attachTarget(this.shapes(), p, this.tol(type))?.id : undefined;
      const from = this.snap(p, e);
      this.g = { k: 'shape', id, from, raw: p, tool, attach, moved: false };
      this.draft = this.shapeFor(tool, from, from, attach, undefined, e.shiftKey);
    }
    this.ed.touch();
    return true;
  }

  pointerMove(e: PointerEvent) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    if (g.k === 'pan') return this.panTo(e);
    if (g.k === 'resize') return this.resizeTo(e);
    // every point the pen went through (the browser coalesces them between frames)
    const evs = g.k === 'draw' && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const p = this.toSurface(e);
    switch (g.k) {
      case 'draw':
        for (const c of evs.length ? evs : [e]) {
          const q = this.toSurface(c);
          const n = g.pts.length;
          if (Math.hypot(q.x - g.pts[n - 3], q.y - g.pts[n - 2]) < 0.6) continue;
          g.pts.push(q.x, q.y, this.pressure(c));
        }
        this.draft = { ...(this.draft as Shape), pts: g.pts.slice() } as Shape;
        break;
      case 'shape': {
        g.moved ||= Math.hypot(p.x - g.raw.x, p.y - g.raw.y) > 3;
        const to = g.tool === 'line' || g.tool === 'arrow' ? attachTarget(this.shapes(), p, this.tol(e.pointerType), g.attach)?.id : undefined;
        this.draft = this.shapeFor(g.tool, g.from, this.snap(p, e), g.attach, to, e.shiftKey);
        break;
      }
      case 'erase':
        this.eraseTo(p, e.pointerType);
        break;
      case 'move': {
        const dx = this.snapBy(p.x - g.from.x, e), dy = this.snapBy(p.y - g.from.y, e);
        if (!g.done && Math.hypot(p.x - g.from.x, p.y - g.from.y) < 2) return;
        if (!g.done) this.ed.checkpoint('style'), (g.done = true);
        const by = new Map(g.orig.map((s) => [s.id, moved(s, dx, dy)]));
        this.write(this.shapes().map((s) => by.get(s.id) ?? s), new Set(by.keys()));
        break;
      }
      case 'handle':
        this.dragHandle(g, this.snap(p, e), e);
        break;
      case 'marquee': {
        const r = boxOf(g.from, p);
        this.marquee = r;
        this.sel = [...new Set([...g.add, ...shapesIn(this.shapes(), r).map((s) => s.id)])];
        break;
      }
    }
    this.ed.touch();
  }

  pointerUp(e: PointerEvent) {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    this.g = null;
    switch (g.k) {
      case 'draw': {
        this.ed.checkpoint();
        const pts = simplify(g.pts, g.pen ? 0.25 : 0.4);
        const s = inkShape(pts, g.pen, this.style());
        this.write([...this.shapes(), s], new Set([s.id]));
        this.draft = null;
        break;
      }
      case 'shape': {
        const d = this.draft;
        this.draft = null;
        if (!d) break;
        if (g.moved) {
          this.add(d);
          // a box drawn: its label to type next (Esc leaves it without)
          if (isBox(d) && d.k !== 'text') this.editLabel(d.id);
        }
        // a tap with a box tool: a box of the usual size, centred there
        else if (BOX_TOOLS.includes(g.tool)) this.addBox(g.tool as BoxKind, { ...this.snap({ x: g.raw.x - NEW_BOX.w / 2, y: g.raw.y - NEW_BOX.h / 2 }, e), ...NEW_BOX });
        break;
      }
      case 'marquee':
        this.marquee = null;
        break;
      case 'pan':
        // a tap, not a scroll: as a click there (fingers don't reach the text by themselves while a pen may draw)
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 8) {
          if (!this.on) this.ed.tap(e.clientX, e.clientY);
        } else this.coast(g.v);
        // (a scroll changes nothing: the page mustn't go back to the caret)
        return;
    }
    this.ed.touch();
  }

  /** A pointer was taken away (the browser scrolled, the pen left): drop what it was drawing. */
  pointerCancel(e: PointerEvent) {
    if (!this.g || e.pointerId !== this.g.id) return;
    this.g = null;
    this.draft = null;
    this.marquee = null;
    this.ed.touch();
  }

  private pressure(e: PointerEvent): number {
    return e.pointerType === 'pen' ? Math.round((e.pressure || 0.5) * 100) / 100 : 0.5;
  }

  private style(): Partial<Shape> {
    return { ...(this.color ? { color: this.color } : {}), ...(this.width !== 2 ? { width: this.width } : {}), ...(this.dash ? { dash: true } : {}) };
  }

  /** The shape a tool makes from a to b (shift: square, or a line at a multiple of 15°). */
  private shapeFor(tool: Tool, a: Pt, b: Pt, from?: Id, to?: Id, shift = false): Shape {
    if (tool === 'line' || tool === 'arrow') {
      if (shift) {
        const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(b.x - a.x, b.y - a.y);
        b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      }
      const ea: End = { ...roundPt(a), ...(from ? { to: from } : {}) }, eb: End = { ...roundPt(b), ...(to ? { to } : {}) };
      return lineShape(ea, eb, tool === 'arrow' ? 'end' : 'none', this.style());
    }
    if (shift) {
      const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      b = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
    }
    return boxShape(tool as BoxKind, roundBox(boxOf(a, b)), { ...this.style(), ...(this.fill && tool !== 'text' ? { fill: true } : {}) });
  }

  /** Add a shape drawn; then (but for the pen) back to selecting, with it selected. */
  private add(s: Shape) {
    this.ed.checkpoint();
    this.write([...this.shapes(), s], new Set([s.id]));
    this.select([s.id]);
    if (this.tool !== 'pen' && this.tool !== 'eraser') this.tool = 'select';
  }

  /** A new box (or text) where given, selected, its label to type. */
  private addBox(k: BoxKind, b: Box) {
    const s = boxShape(k, b, { ...this.style(), ...(this.fill && k !== 'text' ? { fill: true } : {}) });
    this.add(s);
    this.editLabel(s.id);
  }

  private eraseTo(p: Pt, type: string) {
    const g = this.g;
    if (g?.k !== 'erase') return;
    const list = this.shapes();
    const gone = erased(list, g.last, p, this.tol(type));
    g.last = p;
    if (!gone.length) return;
    if (!g.hit) this.ed.checkpoint(), (g.hit = true);
    const ids = new Set(gone.map((s) => s.id));
    this.write(detach(list, ids).filter((s) => !ids.has(s.id)), new Set());
    this.sel = this.sel.filter((id) => !ids.has(id));
  }

  // ── selecting, moving, resizing ──

  select(ids: Id[]) {
    this.sel = ids;
  }

  /** The selected shapes' box, with its handles (a single line: its two ends). */
  get selBox(): Box | null {
    const list = this.selected;
    return list.length ? boundsOf(list, lookupIn(this.shapes())) : null;
  }

  /** Where the handles are: the selection's corners, or a lone line's ends. */
  handles(): { h: Handle; p: Pt }[] {
    const list = this.selected;
    if (list.length === 1 && list[0].k === 'line') {
      const l = list[0] as LineShape;
      const [a, b] = lineEnds(l, lookupIn(this.shapes()));
      return [{ h: 'a', p: a }, { h: 'b', p: b }];
    }
    const b = this.selBox;
    if (!b) return [];
    return [
      { h: 'nw', p: { x: b.x, y: b.y } },
      { h: 'ne', p: { x: b.x + b.w, y: b.y } },
      { h: 'sw', p: { x: b.x, y: b.y + b.h } },
      { h: 'se', p: { x: b.x + b.w, y: b.y + b.h } },
    ];
  }

  private handleAt(p: Pt, type: string) {
    const tol = this.tol(type);
    return this.handles().find((h) => Math.hypot(h.p.x - p.x, h.p.y - p.y) <= tol + 3);
  }

  private selectDown(e: PointerEvent, p: Pt) {
    const tol = this.tol(e.pointerType);
    const id = e.pointerId;
    const handle = this.handleAt(p, e.pointerType);
    if (handle) {
      this.g = { k: 'handle', id, h: handle.h, from: p, orig: this.selected.map((s) => structuredClone($state.snapshot(s) as Shape)), box: this.selBox!, done: false };
      return;
    }
    const hit = shapeAt(this.shapes(), p, tol);
    if (hit && this.double && labelled(hit)) return void this.editLabel(hit.id);
    if (!hit && this.double) return void this.addBox('text', { x: p.x, y: p.y - 12, w: 40, h: 24 });
    if (hit) {
      if (e.shiftKey) this.sel = this.sel.includes(hit.id) ? this.sel.filter((x) => x !== hit.id) : [...this.sel, hit.id];
      else if (!this.sel.includes(hit.id)) this.sel = [hit.id];
      this.g = { k: 'move', id, from: p, orig: this.selected.map((s) => structuredClone($state.snapshot(s) as Shape)), done: false };
      return;
    }
    this.g = { k: 'marquee', id, from: p, add: e.shiftKey ? [...this.sel] : [] };
    if (!e.shiftKey) this.sel = [];
  }

  private dragHandle(g: Extract<Gesture, { k: 'handle' }>, p: Pt, e: PointerEvent) {
    if (!g.done && Math.hypot(p.x - g.from.x, p.y - g.from.y) < 2) return;
    if (!g.done) this.ed.checkpoint('style'), (g.done = true);
    const list = this.shapes();
    if (g.h === 'a' || g.h === 'b') {
      const l = g.orig[0] as LineShape;
      const to = attachTarget(list, p, this.tol(e.pointerType), l[g.h === 'a' ? 'b' : 'a'].to)?.id;
      const end: End = { x: p.x, y: p.y, ...(to ? { to } : {}) };
      const nl = { ...l, [g.h]: end } as LineShape;
      this.write(list.map((s) => (s.id === l.id ? nl : s)), new Set([l.id]));
      return;
    }
    const b = g.box;
    const fixed = { x: g.h.includes('w') ? b.x + b.w : b.x, y: g.h.includes('n') ? b.y + b.h : b.y };
    let to = boxOf(fixed, p);
    if (e.shiftKey && b.w && b.h) {
      const s = Math.max(to.w / b.w, to.h / b.h);
      to = boxOf(fixed, { x: fixed.x + Math.sign(p.x - fixed.x || 1) * b.w * s, y: fixed.y + Math.sign(p.y - fixed.y || 1) * b.h * s });
    }
    to = { ...to, w: Math.max(4, to.w), h: Math.max(4, to.h) };
    const by = new Map(g.orig.map((s) => [s.id, scaled(s, b, to)]));
    this.write(list.map((s) => by.get(s.id) ?? s), new Set(by.keys()));
  }

  // ── a diagram's height, scrolling by finger ──

  /** Start dragging a diagram's bottom edge. */
  resizeDown(e: PointerEvent, id: Id) {
    const blk = this.blockOf(id);
    if (!blk) return;
    if (!this.isOn(id)) this.enter({ kind: 'block', id }, { tool: this.tool });
    this.ed.checkpoint('style');
    this.g = { k: 'resize', id: e.pointerId, y: e.clientY, h: blk.h ?? DIAGRAM_H };
  }

  private resizeTo(e: PointerEvent) {
    const g = this.g;
    if (g?.k !== 'resize' || this.on?.kind !== 'block') return;
    const blk = this.blockOf(this.on.id), svg = this.canvas(this.on.id);
    if (!blk) return;
    const scale = svg?.getScreenCTM()?.d || 1;
    const b = boundsOf(blk.shapes ?? []);
    blk.h = Math.round(Math.max(MIN_H, b ? b.y + b.h + 8 : 0, g.h + (e.clientY - g.y) / scale));
    this.ed.forgetBlock(blk);
    this.ed.touch();
  }

  private scroller(): HTMLElement | null {
    return (this.page?.closest('.scroller') as HTMLElement | null) ?? null;
  }

  private panTo(e: PointerEvent) {
    const g = this.g;
    if (g?.k !== 'pan') return;
    const sc = this.scroller();
    const dy = e.clientY - g.y, dt = Math.max(1, e.timeStamp - g.t);
    if (sc) sc.scrollTop -= dy;
    // (px per ms, no faster than a quick flick)
    g.v = Math.max(-4, Math.min(4, 0.8 * (dy / dt) + 0.2 * g.v));
    g.y = e.clientY;
    g.t = e.timeStamp;
  }

  /** After a flick: the page keeps going, slowing down. */
  private coast(v: number) {
    const sc = this.scroller();
    if (!sc || Math.abs(v) < 0.1) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      sc.scrollTop -= v * dt;
      v *= Math.pow(0.995, dt);
      if (Math.abs(v) > 0.02 && !this.g) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── labels ──

  /** Start typing a box's or a line's label (or a text's text). */
  editLabel(id: Id) {
    const s = this.shapes().find((x) => x.id === id);
    if (!s || !labelled(s)) return;
    this.editing = id;
  }

  /** The label being typed: set it (an empty text goes). */
  setLabel(id: Id, text: string, size?: { w: number; h: number }) {
    const list = this.shapes();
    const s = list.find((x) => x.id === id);
    if (!s || !labelled(s)) return;
    if (s.k === 'text' && !text.trim()) {
      this.write(list.filter((x) => x.id !== id), new Set());
      this.sel = this.sel.filter((x) => x !== id);
      return;
    }
    if ((s.label ?? '') === text && (!size || s.k !== 'text' || (s.w === Math.ceil(size.w) && s.h === Math.ceil(size.h)))) return;
    // (typing a label is one undo step, as typing text is)
    this.ed.checkpoint('type');
    const next = { ...s, label: text || undefined } as BoxShape | LineShape;
    if (!text) delete next.label;
    // a text is as big as what it says
    if (next.k === 'text' && size) (next.w = Math.ceil(size.w)), (next.h = Math.ceil(size.h));
    this.write(list.map((x) => (x.id === id ? next : x)), new Set([id]));
  }

  /** Done typing a label (the editor component sets it as it goes): that one's, if given. */
  commitLabel(id?: Id) {
    if (!id || this.editing === id) this.editing = null;
  }

  // ── keys ──

  /** A key while sketching. Whether it was used. */
  key(k: string): boolean {
    // (a key between two presses: they're not a double-click)
    this.lastDown = null;
    const sel = this.selected;
    const t = TOOLS.find((x) => x.key === k || x.num === k);
    if (t) {
      this.tool = t.tool;
      if (t.tool !== 'select') this.sel = [];
      return true;
    }
    switch (k) {
      case 'Escape':
        if (this.draft) this.draft = null, (this.g = null);
        else if (this.sel.length) this.sel = [];
        else this.exit();
        return true;
      case 'Delete': case 'Backspace':
        return this.removeSelected(), true;
      case 'Enter':
        if (sel.length === 1 && labelled(sel[0])) this.editLabel(sel[0].id);
        else if (!sel.length) this.placeNew();
        return true;
      case 'Left': case 'Right': case 'Up': case 'Down':
      case 'S-Left': case 'S-Right': case 'S-Up': case 'S-Down': {
        const n = k.startsWith('S-') ? 10 : 1, d = k.replace('S-', '');
        return this.nudge(d === 'Left' ? -n : d === 'Right' ? n : 0, d === 'Up' ? -n : d === 'Down' ? n : 0), true;
      }
      case 'C-Left': case 'C-Right': case 'C-Up': case 'C-Down':
        return this.grow(k.slice(2) as 'Left' | 'Right' | 'Up' | 'Down'), true;
      case 'Tab': case 'S-Tab': {
        const list = this.shapes();
        if (!list.length) return true;
        const i = sel.length ? list.findIndex((s) => s.id === sel[sel.length - 1].id) : -1;
        const n = list.length, j = k === 'Tab' ? (i + 1) % n : (i - 1 + n) % n;
        this.tool = 'select';
        return (this.sel = [list[j].id]), true;
      }
      case 'C-a':
        this.tool = 'select';
        return (this.sel = this.shapes().map((s) => s.id)), true;
      case 'C-d':
        return this.duplicate(), true;
      case ']': case '[':
        return this.restack(k === ']' ? 1 : -1), true;
      case 'c': case 'S-c':
        return this.restyle({ color: next(INKS as readonly string[], this.color, k === 'c' ? 1 : -1) }), true;
      case 'w':
        return this.restyle({ width: next(WIDTHS, this.width, 1) }), true;
      case '-':
        return this.restyle({ dash: !this.dash }), true;
      case 'f':
        return this.restyle({ fill: !this.fill }), true;
      case 'C-z': this.ed.undo(); return true;
      case 'C-y': case 'C-S-z': this.ed.redo(); return true;
    }
    // (everything else does nothing while sketching, rather than typing behind the drawing)
    return k.length === 1 || k.startsWith('S-');
  }

  /**
   * A style for new shapes, and for the selected ones if any: the colour, width, dashes and
   * fill (of what can be filled).
   */
  restyle(o: { color?: string; width?: Width; dash?: boolean; fill?: boolean }) {
    if (o.color !== undefined) this.color = o.color;
    if (o.width !== undefined) this.width = o.width;
    if (o.dash !== undefined) this.dash = o.dash;
    if (o.fill !== undefined) this.fill = o.fill;
    const sel = new Set(this.sel);
    if (!sel.size) return;
    this.ed.checkpoint('style');
    const list = this.shapes().map((s) => {
      if (!sel.has(s.id)) return s;
      const n = { ...s } as Shape & { fill?: boolean };
      if (o.color !== undefined) o.color ? (n.color = o.color) : delete n.color;
      if (o.width !== undefined) o.width !== 2 ? (n.width = o.width) : delete n.width;
      if (o.dash !== undefined) o.dash ? (n.dash = true) : delete n.dash;
      if (o.fill !== undefined && isBox(n) && n.k !== 'text') o.fill ? (n.fill = true) : delete n.fill;
      return n;
    });
    this.write(list, sel);
  }

  /** A right-click: the shape there selected (unless it already is, with others). */
  pickAt(e: { clientX: number; clientY: number }) {
    const hit = shapeAt(this.shapes(), this.toSurface(e), this.tol('mouse'));
    if (!hit) this.sel = [];
    else if (!this.sel.includes(hit.id)) this.sel = [hit.id];
    if (hit) this.tool = 'select';
  }

  /**
   * The right-click menu while drawing: what can be done to the selection; with nothing
   * selected, what can be drawn. Then undo, and done.
   */
  actions(): DrawingAction[] {
    const sel = this.selected;
    const run = (k: string) => () => void this.key(k);
    const one = sel.length === 1 ? sel[0] : null;
    const tool = (t: Tool, desc: string): DrawingAction => ({ name: t, desc, keys: [TOOLS.find((x) => x.tool === t)!.key], run: () => ((this.tool = t), (this.sel = [])) });
    const acts: DrawingAction[] = sel.length
      ? [
          ...(one && labelled(one) ? [{ name: 'label', desc: one.k === 'text' ? 'edit the text' : 'type its label', keys: ['Enter'], run: () => this.editLabel(one.id) }] : []),
          { name: 'copy', desc: 'duplicate', keys: ['C-d'], run: run('C-d') },
          { name: 'front', desc: 'bring to front', keys: [']'], run: run(']') },
          { name: 'back', desc: 'send to back', keys: ['['], run: run('[') },
          { name: 'colour', desc: 'next colour', keys: ['c'], run: run('c'), sep: true },
          { name: 'dash', desc: (one ?? sel[0]).dash ? 'solid' : 'dashed', keys: ['-'], run: run('-') },
          ...(sel.some((x) => isBox(x) && x.k !== 'text') ? [{ name: 'fill', desc: sel.some((x) => isBox(x) && x.fill) ? 'not filled' : 'filled', keys: ['f'], run: run('f') }] : []),
          { name: 'delete', desc: 'delete', keys: ['Delete'], run: run('Delete'), sep: true },
        ]
      : [
          tool('rect', 'draw a box'),
          tool('ellipse', 'draw an ellipse'),
          tool('diamond', 'draw a diamond'),
          tool('arrow', 'draw an arrow'),
          tool('text', 'write text'),
          tool('pen', 'draw with the pen'),
          { name: 'all', desc: 'select everything', keys: ['C-a'], run: run('C-a'), sep: true },
        ];
    return [
      ...acts,
      { name: 'undo', desc: 'undo', keys: ['C-z'], run: () => this.ed.undo(), sep: true },
      { name: 'redo', desc: 'redo', keys: ['C-y'], run: () => this.ed.redo() },
      { name: 'done', desc: 'back to the text', keys: ['Escape'], run: () => this.exit() },
    ];
  }

  /** The selection to the front (d = 1: drawn last, over the rest) or to the back. */
  restack(d: 1 | -1) {
    const ids = new Set(this.sel);
    if (!ids.size) return;
    this.ed.checkpoint('style');
    const list = this.shapes();
    const sel = list.filter((s) => ids.has(s.id)), rest = list.filter((s) => !ids.has(s.id));
    this.write(d > 0 ? [...rest, ...sel] : [...sel, ...rest], new Set());
  }

  removeSelected() {
    const ids = new Set(this.sel);
    if (!ids.size) return;
    this.ed.checkpoint();
    const list = this.shapes();
    this.write(detach(list, ids).filter((s) => !ids.has(s.id)), new Set());
    this.sel = [];
  }

  private nudge(dx: number, dy: number) {
    const ids = new Set(this.sel);
    if (!ids.size) return;
    this.ed.checkpoint('nudge');
    this.write(this.shapes().map((s) => (ids.has(s.id) ? moved(s, dx, dy) : s)), ids);
  }

  duplicate() {
    const sel = this.selected;
    if (!sel.length) return;
    this.ed.checkpoint();
    const copies = cloneShapes($state.snapshot(sel) as Shape[]).map((s) => moved(s, 16, 16));
    this.write([...this.shapes(), ...copies], new Set(copies.map((s) => s.id)));
    this.sel = copies.map((s) => s.id);
  }

  /**
   * From the keyboard: a new box like the selected one, beside it in that direction and
   * joined to it by an arrow, its label to type (flowcharts without the mouse).
   */
  grow(dir: 'Left' | 'Right' | 'Up' | 'Down') {
    const sel = this.selected;
    const from = sel.length === 1 && isBox(sel[0]) ? sel[0] : null;
    if (!from) return this.placeNew();
    const gap = 64;
    const dx = dir === 'Left' ? -(from.w + gap) : dir === 'Right' ? from.w + gap : 0;
    const dy = dir === 'Up' ? -(from.h + gap) : dir === 'Down' ? from.h + gap : 0;
    this.ed.checkpoint();
    const nb: BoxShape = { ...boxShape(from.k === 'text' ? 'rect' : from.k, { x: from.x + dx, y: Math.max(0, from.y + dy), w: from.w, h: from.h }), ...pick(from) };
    const c = centre(from), d = centre(nb);
    const arrow = lineShape({ ...c, to: from.id }, { ...d, to: nb.id }, 'end', { ...(from.color ? { color: from.color } : {}) });
    this.write([...this.shapes(), nb, arrow], new Set([nb.id, arrow.id]));
    this.sel = [nb.id];
    this.tool = 'select';
    this.editLabel(nb.id);
  }

  /** From the keyboard, nothing selected: a new box (of the tool's kind) in view, its label to type. */
  private placeNew() {
    const k: BoxKind = BOX_TOOLS.includes(this.tool) ? (this.tool as BoxKind) : 'rect';
    const list = this.shapes();
    const t = this.on;
    let at: Pt;
    if (t?.kind === 'block') {
      const blk = this.blockOf(t.id)!;
      const b = boundsOf(list);
      at = b ? { x: b.x, y: b.y + b.h + 32 } : { x: ((blk.w ?? 600) - NEW_BOX.w) / 2, y: 40 };
    } else {
      const sc = this.scroller(), o = this.page?.getBoundingClientRect(), r = sc?.getBoundingClientRect();
      at = { x: (this.page?.clientWidth ?? 600) / 2 - NEW_BOX.w / 2, y: (r && o ? r.top + r.height / 2 - o.top : 100) - NEW_BOX.h / 2 };
    }
    this.addBox(k, { ...at, ...(k === 'text' ? { w: 40, h: 24 } : NEW_BOX) });
  }

  // ── the clipboard ──

  /** Copy (or cut) the selected shapes: they paste back as shapes, here or in another diagram. */
  copy(e: ClipboardEvent, cut: boolean): boolean {
    const sel = this.selected;
    if (!sel.length) return false;
    const plain = sel.map((s) => {
      const c = { ...($state.snapshot(s) as Shape) } as Shape & { at?: Id };
      delete c.at;
      return c;
    });
    this.clip = plain;
    e.clipboardData?.setData('text/plain', JSON.stringify({ notex: 'shapes', shapes: plain }));
    e.preventDefault();
    if (cut) this.removeSelected();
    return true;
  }

  /** Paste shapes (copied here, or their JSON), a little offset, selected. */
  paste(text: string): boolean {
    let shapes: Shape[] | null = null;
    try {
      const j = JSON.parse(text);
      if (j?.notex === 'shapes' && Array.isArray(j.shapes)) shapes = j.shapes;
    } catch {}
    if (!shapes) return false;
    this.ed.checkpoint();
    const copies = cloneShapes(shapes).map((s) => moved(s, 16, 16));
    this.write([...this.shapes(), ...copies], new Set(copies.map((s) => s.id)));
    this.sel = copies.map((s) => s.id);
    this.tool = 'select';
    return true;
  }

  /**
   * What's drawn on the note, after an edit: a drawing whose character went is pinned to its
   * block; one whose block went, to the block before where that was.
   */
  tidy(lastIndex: Map<Id, number>) {
    const ink = this.ed.doc.ink;
    if (!ink?.length) return;
    const blocks = this.ed.doc.blocks;
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const here = (at: Id): boolean => {
      if (byId.has(at)) return true;
      const b = byId.get(this.anchorBlock.get(at) ?? '');
      if (b && this.ed.itemIds(b).has(at)) return true;
      // (not seen yet, or now in another block: look for it)
      const found = blocks.find((x) => this.ed.itemIds(x).has(at));
      if (found) this.anchorBlock.set(at, found.id);
      return !!found;
    };
    if (ink.every((s) => here(s.at))) return;
    this.ed.doc.ink = ink.map((s) => {
      if (here(s.at)) return s;
      const was = this.anchorBlock.get(s.at);
      if (was && byId.has(was)) return { ...s, at: was };
      const i = Math.min(blocks.length - 1, Math.max(0, (lastIndex.get(was ?? s.at) ?? 1) - 1));
      return { ...s, at: blocks[i].id };
    });
  }
}

const r10 = (v: number) => Math.round(v * 10) / 10;
const roundPt = (p: Pt): Pt => ({ x: r10(p.x), y: r10(p.y) });
const roundBox = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });

/** The next of a list after `cur` (or before, d = -1), round. */
function next<T>(list: readonly T[], cur: T, d: number): T {
  const i = list.indexOf(cur);
  return list[(i + d + list.length) % list.length];
}

/** The style of a shape, to give another. */
function pick(s: BoxShape): Partial<BoxShape> {
  return { ...(s.color ? { color: s.color } : {}), ...(s.width ? { width: s.width } : {}), ...(s.dash ? { dash: true } : {}), ...(s.fill ? { fill: true } : {}) };
}
