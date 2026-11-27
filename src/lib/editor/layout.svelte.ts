// Laying out the page after each render: where the caret, the selection, find's matches and
// every drawing are, the room made for drawings' notes, and only for what's near the screen in
// a long note. Part of the Editor (see editor.svelte.ts).

import { tick } from 'svelte';
import { arrowGeo, type ArrowGeo, type Outline } from '../arrows';
import { markGeo, type MarkGeo } from '../marks';
import { besideNote, layoutRow, measureLabel, noteText, pinnedLeader, provisional, solves, type RowNote } from '../labels';
import { isWall, wall } from '../tables';
import { byLine, fromDOM, inkRects, measure, relTo, releaseRange, sharedRange, union, type Rect } from '../geom';
import * as M from '../math/edit';
import { BIG_OPS, CMDS } from '../math/defs';
import { Drawings } from './drawings.svelte';
import { block, cmd, math, plainCopy, sym, type Arrow, type Mark, type MarkKind, type Id, type Item, type MNode } from '../model';
import type { Editor, Spacer } from '../editor.svelte';
import { NOTE_B, MAX_ROOM, SPACES, round, idKey } from '../editor.svelte';

export class PageLayout {
  constructor(private ed: Editor) {}

  // ───────────────────────── layout ─────────────────────────

  /** Recompute every DOM-dependent overlay. Called after renders and resizes. */
  layout() {
    if (!this.ed.page) return;
    const outer = this.ed.frame;
    this.ed.frame = { rects: new Map(), ink: new Map() };
    try {
      this.layoutFrame();
    } finally {
      this.ed.frame = outer;
      this.laidHeight = this.ed.page.offsetHeight;
    }
  }
  /** The page's height when it was last laid out (a change since: see Editor.svelte's ResizeObserver). */
  laidHeight = 0;

  private layoutFrame() {
    const page = this.ed.page!;
    const origin = page.getBoundingClientRect();
    const rel = (r: Rect | null) => (r ? relTo(r, origin) : null);

    // Caret
    const base = this.ed.mode === 'palette' || this.ed.mode === 'hint' ? this.ed.prevMode : this.ed.mode;
    let caret: typeof this.ed.caret = null;
    if (base === 'math') caret = this.mathCaret(origin);
    else if (base === 'text') {
      const blk = this.ed.blk;
      const r = this.ed.stopRect(this.ed.b, this.ed.o);
      const prev = this.ed.o > 0 ? blk.items[this.ed.o - 1] : null;
      const pr = prev?.t === 'c' ? this.ed.el(prev.id, this.ed.b)?.getBoundingClientRect() : null;
      // right after a display formula: at its end, not on a line of its own below it
      const dm = prev?.t === 'm' && prev.display ? this.ed.el(prev.id, this.ed.b)?.querySelector('.katex')?.getBoundingClientRect() : null;
      if (dm) caret = { r: relTo({ x: dm.right + 3, y: dm.top, w: 2, h: dm.height }, origin), shape: 'bar' };
      else if (r) {
        // Prefer the previous char's line when wrapping put the next item on a new line.
        const nextIsMath = blk.items[this.ed.o]?.t === 'm';
        // (before a cell wall: the end of the cell, right after its text or at its start)
        const useprev = pr && (blk.items[this.ed.o]?.t !== 'c' || isWall(blk.items[this.ed.o]) || Math.abs(pr.top - r.top) > 4);
        const x = useprev ? pr!.right : r.left;
        const h = useprev ? pr!.height : nextIsMath ? 22 : r.height;
        const y = useprev ? pr!.top : nextIsMath ? r.top + r.height / 2 - h / 2 : r.top;
        caret = { r: relTo({ x, y, w: 2, h }, origin), shape: 'bar' };
      }
    }
    this.ed.caret = caret;
    this.ed.selRects = [...this.selectionRects(origin), ...this.mathSelRects(origin)];
    this.ed.findRects = this.ed.find ? this.ed.finder.findHitRects(origin) : this.ed.findRects.length ? [] : this.ed.findRects;
    this.ed.mathFrame = this.ed.drawings.inFormula ? this.mathFrameRect(origin) : null;

    // Pick highlights
    if (this.ed.pick) {
      this.ed.pickRects = {
        cur: rel(this.ed.rectOfIds(this.ed.drawings.anchorIds(this.ed.pick.loc))),
        from: this.ed.pick.from ? rel(this.ed.rectOfIds(this.ed.drawings.anchorIds(this.ed.pick.from))) : null,
      };
    } else this.ed.pickRects = { cur: null, from: null };

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
    for (const pm of this.ed.doc.marks) {
      const id = pm.id, bi = pm.at.length ? this.ed.blockOf(pm.at[0]) : -1;
      if (bi >= 0 && !near.has(bi) && id !== this.ed.styling) {
        const old = this.ed.markGeos[id];
        if (old && kept(id, near.at(bi))) mgeos[id] = old;
        continue;
      }
      const m = plainCopy(pm);
      // a label being typed is laid out as typed
      if (this.ed.noteEd.note?.id === m.id) m.label = noteText(this.ed.noteEd.note.blk.items);
      act.push(m);
      active.add(m.id);
      if (bi >= 0) this.geoTops.set(m.id, { epoch: this.geoEpoch, tops: near.at(bi) });
      lines[m.id] = byLine(this.ed.rectsOfIds(m.at)).map((r) => relTo(r, origin));
      const g = markGeo(m.kind, lines[m.id]);
      if (g) mgeos[m.id] = g;
    }
    this.ed.frame!.marks = act;
    provisional();
    this.placeLabels(mgeos, lines, origin, active);
    if (provisional()) {
      // rows moved by typing kept their last layout; solve them properly once typing
      // pauses, a few at a time (each pass solves for up to 8ms)
      const settling = !this.quickLabels;
      // (passes in a row: a safety net, as each one solves at least a row)
      this.settlePasses = settling ? this.settlePasses + 1 : 0;
      clearTimeout(this.settleTimer);
      if (this.settlePasses < 100)
        this.settleTimer = setTimeout(() => {
          this.quickLabels = false;
          this.solveMs = 8;
          this.ed.spacerPasses = 0;
          try {
            this.layout();
          } finally {
            this.quickLabels = true;
            this.solveMs = Infinity;
          }
        }, settling ? 16 : 200);
    }
    for (const m of this.ed.doc.marks) if (mgeos[m.id]?.outline) outlines.set(idKey(m.at), mgeos[m.id].outline!);
    // the selected shape's ends, for its resize handles: on the shape itself (a brace's
    // ends, a circle's sides), wherever layout put it (a brace below the notes it contains)
    const sm = this.ed.styling && mgeos[this.ed.styling] && lines[this.ed.styling]?.length ? this.ed.styling : null;
    if (sm) {
      const g = mgeos[sm], ls = lines[sm], b = g.bounds;
      const mk = this.ed.doc.marks.find((x) => x.id === sm);
      const under = mk?.kind === 'brace' || mk?.kind === 'underline';
      const first = ls[0], last = ls[ls.length - 1];
      const y = (r: Rect) => (under ? r.y + r.h + 4 : r.y + r.h / 2);
      // (a formula is one line, even when a sum's limits split its ink into rows)
      const inMath = !!mk?.at.length && !!this.ed.el(mk.at[0])?.closest('.math');
      this.ed.markEnds = ls.length === 1 || inMath
        ? { id: sm, a: { x: b.x - 1, y: b.y + b.h / 2 }, b: { x: b.x + b.w + 1, y: b.y + b.h / 2 } }
        : { id: sm, a: { x: first.x - 2, y: y(first) }, b: { x: last.x + last.w + 2, y: y(last) } };
    } else if (this.ed.markEnds) this.ed.markEnds = null;
    this.ed.markGeos = mgeos;

    // Arrows
    const geos: Record<Id, ArrowGeo> = {};
    for (const pa of this.ed.doc.arrows) {
      const ends = [pa.from[0], pa.to[0]].map((id) => (id ? this.ed.blockOf(id) : -1));
      if (ends.every((bi) => bi >= 0 && !near.has(bi)) && pa.id !== this.ed.styling && this.ed.handleDrag?.id !== pa.id) {
        const old = this.ed.arrowGeos[pa.id];
        if (old && kept(pa.id, ends.flatMap(near.at))) geos[pa.id] = old;
        continue;
      }
      const a = plainCopy(pa);
      if (ends.every((bi) => bi >= 0)) this.geoTops.set(a.id, { epoch: this.geoEpoch, tops: ends.flatMap(near.at) });
      const fa = rel(this.ed.rectOfIds(a.from));
      const ta = rel(this.ed.rectOfIds(a.to));
      if (!fa || !ta) continue;
      const g = arrowGeo(fa, ta, a.bend, { from: outlines.get(idKey(a.from)), to: outlines.get(idKey(a.to)) }, { from: a.fromAt, to: a.toAt }, a.skew);
      if (g && a.note && a.label) {
        const ld = pinnedLeader({ x: g.mid.x - 2, y: g.mid.y - 2, w: 4, h: 4 }, this.pinnedBox(a, g));
        if (ld) g.leader = `M${ld[0].toFixed(1)},${ld[1].toFixed(1)} L${ld[2].toFixed(1)},${ld[3].toFixed(1)}`;
      }
      if (g) geos[a.id] = g;
    }
    this.ed.arrowGeos = geos;
    // (after the arrows: room is made for their notes too)
    this.makeRoom(mgeos, origin, active, near);
    // what's drawn on the note follows its blocks
    this.ed.sketch.measure();

    // Keep the caret in view (after an action; not while the page is being scrolled)
    if (this.ed.version !== this.followed) {
      this.followed = this.ed.version;
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
  quickLabels = true;
  /** How long placing notes may spend solving rows, while settling them. */
  private solveMs = Infinity;
  private settlePasses = 0;
  settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Where each drawing's blocks were (top, height; page coordinates) when it was last laid out. */
  private geoTops = new Map<Id, { epoch: number; tops: number[] }>();
  /** Bumped when everything has to be laid out again (width, fonts, settings). */
  geoEpoch = 0;
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
  nearScreen(origin: DOMRect) {
    const page = this.ed.page!;
    const scroller = page.parentElement!;
    const boxes = new Map<number, { top: number; height: number }>();
    const box = (bi: number) => {
      let b = boxes.get(bi);
      if (!b) {
        const r = this.ed.blockEl(bi)?.getBoundingClientRect();
        b = { top: (r?.top ?? 0) - origin.top, height: r?.height ?? 0 };
        boxes.set(bi, b);
      }
      return b;
    };
    const top = (bi: number) => box(bi).top;
    const n = this.ed.doc.blocks.length;
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
    const extra = new Set([this.ed.b, this.ed.anchor?.b ?? -1]);
    // where a block is and how tall: a drawing's geometry still holds while both are unchanged
    const at = (bi: number) => [box(bi).top, box(bi).height];
    return { has: (bi: number) => (bi >= lo && bi <= hi) || extra.has(bi), top, at };
  }

  /** On scroll: lay out again once the screen gets near the edge of what was laid out. */
  scrolled() {
    if (!this.ed.page || this.scrollQueued) return;
    this.scrollQueued = true;
    requestAnimationFrame(() => {
      this.scrollQueued = false;
      const page = this.ed.page;
      if (!page) return;
      const view = page.parentElement!.getBoundingClientRect(), origin = page.getBoundingClientRect();
      const margin = (view.height * this.cullScreens) / 2;
      if (view.top - origin.top < this.covered.top + margin || view.bottom - origin.top > this.covered.bottom - margin) {
        this.ed.spacerPasses = 0; // new lines to make room on: a fresh round of passes
        this.layout();
      }
    });
  }
  private scrollQueued = false;

  /** The box of a hand-placed note (page coordinates). */
  private pinnedBox(d: Mark | Arrow, g: MarkGeo | ArrowGeo): Rect {
    const s = this.ed.noteEd.noteSize(d);
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
    const page = this.ed.page!;
    const cs = getComputedStyle(page);
    const left = parseFloat(cs.paddingLeft) || 0, right = page.clientWidth - (parseFloat(cs.paddingRight) || 0);
    const UNDER = new Set<MarkKind>(['brace', 'underline']);
    // the time for solving rows counts from here, not from the layout's start (measuring
    // the page could use it all up, and then no row would ever be solved), and at least
    // one row is solved, so settling gets somewhere each pass
    const until = performance.now() + this.solveMs, solvedBefore = solves();

    // Ink of each block grouped into lines (rects overlapping vertically, transitively),
    // so a sum's limits belong to the sum's line.
    const blockLines = new Map<Element, Rect[][]>();
    const inkLines = (el: Element) => {
      let ls = blockLines.get(el);
      if (!ls) {
        ls = [];
        let bottom = -Infinity;
        for (const r of this.ed.blockInk(el).map((r) => relTo(r, origin)).sort((a, b) => a.y - b.y)) {
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
    for (const m of this.ed.fMarks) {
      const g = geos[m.id];
      if (!g || !active.has(m.id)) continue;
      g.leader = undefined;
      const target = this.ed.rectOfIds(m.at);
      const blockEl = m.at.length ? this.ed.el(m.at[0])?.closest('.block') : null;
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
      const r = besideNote(shape, this.ed.noteEd.noteSize(m), { left, right, obstacles: [...inkLines(i.blockEl)[i.line], ...others, ...placed] });
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
          // (the note being typed has the size it's drawn at)
          const live = this.ed.noteEd.typingLabel === m.id ? this.ed.noteEd.noteSize(m) : null;
          return { id: m.id, tip: { x: g.label.x, y: below ? edge - 1 : edge + 1 }, edge, size: (maxW: number) => live ?? measureLabel(m.label, maxW), key: live ? `\u0000${live.w}x${live.h}` : m.label };
        });
        // keep off ink on this line, other shapes and notes already placed
        const mine = new Set(row.map((i) => i.m.id));
        const ink = row[0].line >= 0 ? inkLines(row[0].blockEl)[row[0].line] : [];
        const others = infos.filter((i) => !mine.has(i.m.id)).map((i) => i.g.bounds);
        // (laid out for paper, always solved: a layout coming after beginPrint's, as the page's
        // narrowing makes, mustn't move notes the page breaks were measured with)
        const quick = !this.ed.paper.printing && (this.quickLabels || (solves() > solvedBefore && performance.now() > until));
        const res = layoutRow(notes, { below, left, right, obstacles: [...ink, ...others, ...placed], quick });
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
    const page = this.ed.page!;
    const GAP = 3;
    type Item = { anchor: Id; side: 'above' | 'below'; r: Rect };
    const items: Item[] = [];
    for (const m of this.ed.fMarks) {
      const g = geos[m.id];
      if (!g || !active.has(m.id)) continue;
      const target = this.ed.rectOfIds(m.at);
      if (!target) continue;
      // anchor the room on the item at the start (above) / end (below) of the target
      const anchors = m.at.flatMap((id) => {
        const el = this.ed.el(id);
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
        const s = this.ed.noteEd.noteSize(m, g.label.maxW ?? Infinity);
        const x = g.label.x + origin.left - s.w / 2;
        const y = g.label.below ? g.label.y - 12 + origin.top : g.label.y + 3 - s.h + origin.top;
        items.push({ anchor: g.label.below ? last : first, side: g.label.below ? 'below' : 'above', r: { x, y, w: s.w, h: s.h } });
      }
    }

    // Arrows: their notes (standing just above the curve's middle, as LabelLayer draws
    // them), or the top of the curve.
    // They answer to the line of the higher end (above) or the lower end (below).
    const itemOf = (id: Id) => (this.ed.el(id)?.closest('.ch, .math') as HTMLElement | null)?.dataset.nx;
    for (const a of this.ed.doc.arrows) {
      const g = this.ed.arrowGeos[a.id];
      const from = itemOf(a.from[0]), to = itemOf(a.to[0]);
      if (!g || !from || !to || a.note) continue;
      const fromHigher = g.from.y <= g.to.y;
      const top = Math.min(g.from.y, g.to.y), bottom = Math.max(g.from.y + g.from.h, g.to.y + g.to.h);
      const s = a.label ? this.ed.noteEd.noteSize(a) : { w: 4, h: 4 };
      const r = { x: g.mid.x - s.w / 2 + origin.left, y: (a.label ? g.mid.y - 1 - s.h : g.mid.y - 2) + origin.top, w: s.w, h: s.h };
      if (r.y < top + origin.top - 4) items.push({ anchor: fromHigher ? from : to, side: 'above', r });
      else if (r.y + r.h > bottom + origin.top + 4) items.push({ anchor: fromHigher ? to : from, side: 'below', r });
      // between the lines of its ends: the lower line makes room under the upper one's text
      else if (a.label && this.ed.blockOf(from) !== this.ed.blockOf(to)) items.push({ anchor: fromHigher ? to : from, side: 'above', r });
    }

    // ink near each anchor: its own block and the blocks on either side
    const near = new Map<number, Rect[]>();
    const inkNear = (anchor: Id) => {
      const bi = this.ed.blockOf(anchor);
      let r = near.get(bi);
      if (!r) {
        r = [bi - 1, bi, bi + 1].flatMap((i) => {
          const e = i >= 0 ? this.ed.blockEl(i) : undefined;
          return e ? this.ed.blockInk(e) : [];
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
    // A block put on the page just now (by enter, a paste) is drawn from the next frame on
    // (content-visibility): till then it stands in at a guessed height, and what's under it
    // doesn't move for the room made in it, so the room asked for would swing between some
    // and none, pass after pass. Its lines keep their room till it's drawn, then are measured.
    const shown = page.parentElement!.getBoundingClientRect();
    let undrawn = false;
    const drawn = (el: Element) => {
      if (!el.checkVisibility || el.checkVisibility({ contentVisibilityAuto: true })) return true;
      // (off the screen it isn't drawn either, but that lasts: measured as it is)
      const r = el.getBoundingClientRect();
      if (r.bottom < shown.top || r.top > shown.bottom) return true;
      undrawn = true;
      return false;
    };
    // The anchor's line: its edges from the probes (prose) or the formula's box (display).
    // Only ink beyond these edges is in the way; ink on the same line moves with it.
    const edges = (id: Id): { top: number; bottom: number } | null => {
      const el = this.ed.el(id);
      if (el && !drawn(el)) return null;
      if (el?.classList.contains('display')) {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }
      const t = mid(this.ed.spEl('pt', id)), b = mid(this.ed.spEl('pb', id));
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
      // (or, not drawn yet, once it is)
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

    // (blocks are drawn as a frame is: laid out again after the next one)
    if (undrawn && !this.ed.drawQueued) {
      this.ed.drawQueued = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.ed.drawQueued = false;
        this.ed.spacerPasses = 0;
        this.layout();
      }));
    }

    const next: Record<Id, Spacer> = {};
    // lines that weren't looked at keep their room
    for (const [k, v] of Object.entries(this.ed.room)) {
      const bi = this.ed.blockOf(k);
      if (bi >= 0 && !view.has(bi)) next[k] = { ...v };
    }
    for (const key of unmeasured) {
      const [id, side] = key.split(':') as [Id, 'above' | 'below'];
      (next[id] ??= {})[side] = this.ed.room[id]?.[side] ?? 0;
    }
    for (const [id, n] of Object.entries(need)) {
      const el = this.ed.el(id);
      if (!el) continue;
      const cur = this.ed.room[id] ?? {};
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
        const edge = mid(this.ed.spEl(side === 'below' ? 'pb' : 'pt', id));
        const at = mid(this.ed.spEl('sp', id, side));
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
    if (this.ed.spacerVersion !== this.ed.version) (this.ed.spacerVersion = this.ed.version), (this.ed.spacerPasses = 0);
    // A note below one line and a note above the next both move the same gap: correcting
    // both at once overshoots. Settle the "below" spacers first, then the "above" ones.
    const moved = (k: Id) => Math.abs((next[k].below ?? 0) - (this.ed.room[k]?.below ?? 0)) > 1;
    if (Object.keys(next).some(moved))
      for (const [k, v] of Object.entries(next)) if (v.above !== undefined && this.ed.room[k]?.above !== undefined) v.above = this.ed.room[k].above;
    if (same(next, this.ed.room)) return;
    if (++this.ed.spacerPasses > 8) return; // never loop forever on odd layouts
    this.ed.setRoom(next);
    tick().then(() => this.layout());
  }

  /**
   * The selection's rectangles, merged per line. Drawn as an overlay rather than
   * a class on every character: changing a selection then costs what is selected,
   * not the length of the note.
   */
  private selectionRects(origin: DOMRect): Rect[] {
    const r = this.ed.selection;
    if (!r || r.s.b === NOTE_B) return [];
    // runs of text by their line boxes, formulas by their whole box (a range's rects
    // only cover a formula's text line, not what sticks out above and below)
    const rects: DOMRect[] = [];
    const range = sharedRange();
    const run = (b: number, o0: number, o1: number) => {
      const a = this.stopEl(b, o0), z = this.ed.el(this.ed.noteEd.blockAt(b).items[o1 - 1].id, b);
      if (!a || !z) return;
      range.setStartBefore(a);
      range.setEndAfter(z);
      rects.push(...range.getClientRects());
    };
    // (whole cells selected show as cells: see Editor.svelte; table rows are never drawn over)
    const cells = !!this.ed.tables.cellSelection;
    for (let b = r.s.b; b <= r.e.b; b++) {
      const items = this.ed.doc.blocks[b].items;
      if (this.ed.doc.blocks[b].kind === 'tr' && (cells || r.s.b !== r.e.b)) continue;
      const o1 = b === r.e.b ? r.e.o : items.length;
      let start = b === r.s.b ? r.s.o : 0;
      for (let o = start; o <= o1; o++) {
        if (o < o1 && items[o].t !== 'm') continue;
        if (o > start) run(b, start, o);
        if (o < o1) {
          const m = this.ed.el(items[o].id, b);
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
    if (this.ed.noteEd.note) return []; // (drawn in the note: see LabelLayer)
    const item = this.ed.mathSelRange ? this.ed.mathItem : null;
    const sel = item ? this.ed.el(item.id, this.ed.b)?.querySelector('.nx-sel') : null;
    if (!sel) return [];
    const box = union([fromDOM(sel.getBoundingClientRect()), ...inkRects(sel)].filter((r) => r.w || r.h));
    return box ? [relTo({ x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }, origin)] : [];
  }

  /**
   * The frame around the formula being edited: everything it draws (limits, fractions
   * and scripts reach past its line box) with some room, so a selection inside fits.
   */
  private mathFrameRect(origin: DOMRect): Rect | null {
    if (this.ed.noteEd.note) return null; // (the note's ring frames it)
    const item = this.ed.mathItem;
    const mel = item ? this.ed.el(item.id, this.ed.b) : null;
    if (!mel) return null;
    const line = fromDOM(mel.getBoundingClientRect());
    const box = union([line, ...inkRects(mel)].filter((r) => r.w || r.h))!;
    const PX = 3, PY = 3;
    // a display formula's frame spans its line, as its block does
    const x0 = item!.display ? line.x : box.x - PX, x1 = item!.display ? line.x + line.w : box.x + box.w + PX;
    return relTo({ x: x0, y: box.y - PY, w: x1 - x0, h: box.h + 2 * PY }, origin);
  }

  /** The element at caret stop (b, o): the item there, or the end-of-line marker. */
  stopEl(b: number, o: number): Element | null {
    const blk = this.ed.noteEd.blockAt(b);
    if (!blk) return null;
    if (o < blk.items.length) return this.ed.el(blk.items[o].id, b);
    if (b === NOTE_B) return this.ed.noteEd.noteRoot()?.querySelector('.eol') ?? null;
    return this.ed.frame ? (this.ed.blockMap(b).get('eol')?.[0] ?? null) : (this.ed.page?.querySelector(`[data-eol="${blk.id}"]`) ?? null);
  }

  private mathCaret(origin: DOMRect): typeof this.ed.caret {
    const item = this.ed.mathItem;
    if (!item) return null;
    const mel = this.ed.el(item.id, this.ed.b);
    const cel = mel?.querySelector('.nx-caret');
    if (!mel || !cel) return null;
    const row = M.rowAt(item.root, this.ed.mc.path);
    const next = row[this.ed.mc.off];
    let x = cel.getBoundingClientRect().left;
    if (next?.k === 'cmd' && CMDS[next.name]?.script && this.ed.mc.off > 0) {
      const r = this.ed.rectOfIds([next.id]);
      if (r) x = r.x;
    }
    // The caret is as tall as what it stands next to on its own row: after a base with
    // scripts or primes, that base (not the small script just before the caret);
    // for an operator with limits, the operator itself; spacing has no height of its own.
    const small = (n: MNode | undefined) => M.isAttached(n) || (n?.k === 'sym' && SPACES.has(n.v));
    const extent = (n: MNode | undefined): Rect | null => {
      if (!n) return null;
      const r = n.k === 'sym' && BIG_OPS.has(n.v)
        ? (() => { const op = this.ed.el(n.id, this.ed.b)?.querySelector('.mop'); return op ? fromDOM(op.getBoundingClientRect()) : null; })() ?? this.ed.rectOfIds([n.id])
        : this.ed.rectOfIds([n.id]);
      return r && r.h >= 4 ? r : null;
    };
    let i = this.ed.mc.off - 1;
    while (i > 0 && small(row[i])) i--;
    let v = extent(row[i]) ?? (small(next) ? null : extent(next)) ?? extent(row[this.ed.mc.off - 1]) ?? extent(next);
    if (!v) {
      const empty = mel.querySelector('.nx-active-row .nx-empty') ?? mel.querySelector('.nx-empty');
      v = empty ? measure(empty) : measure(mel);
    }
    if (!v) return null;
    return { r: relTo({ x: x - 1, y: v.y, w: 2, h: Math.max(v.h, 14) }, origin), shape: 'math' };
  }
}
