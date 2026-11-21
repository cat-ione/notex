// Notes on shapes: rendering, measuring, and laying out a row of them.
//
// The layout follows how people annotate by hand / in textbooks:
//  - a note sits centred on its shape (the tip of a brace, the top of a circle);
//  - notes along the same line and side share one baseline and keep their order;
//  - when they crowd, long notes wrap onto two or three short lines first, then
//    notes fan out sideways (the row dropping a little so leaders get some
//    angle), or alternate between two rows;
//  - a note gets a leader line only when it no longer sits right at its shape;
//  - nothing leaves the text column, leaders never cross.
// Candidate layouts are scored and the cheapest wins (see `cost`).

import katex from 'katex';
import { spread } from './marks';
import type { Rect } from './geom';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const htmlCache = new Map<string, string>();
/** Note text as HTML: prose with `$math$` rendered by KaTeX. */
export function renderLabel(text: string): string {
  let html = htmlCache.get(text);
  if (html === undefined) {
    html = text
      .split(/(\$[^$]+\$)/)
      .map((p) => (/^\$[^$]+\$$/.test(p) ? katex.renderToString(p.slice(1, -1), { throwOnError: false, strict: 'ignore', output: 'html' }) : esc(p)))
      .join('');
    if (htmlCache.size > 300) htmlCache.clear();
    htmlCache.set(text, html);
  }
  return html;
}

let measurer: HTMLDivElement | null = null;
const sizeCache = new Map<string, { w: number; h: number }>();
/** Size of a note as LabelLayer draws it (class `dlabel`), optionally wrapped to `maxW`. */
export function measureLabel(text: string, maxW = Infinity): { w: number; h: number } {
  const key = `${maxW}|${text}`;
  const hit = sizeCache.get(key);
  if (hit) return hit;
  if (!measurer) {
    measurer = document.createElement('div');
    measurer.className = 'dlabel nx-measure';
    measurer.style.cssText = 'position:absolute; left:-9999px; top:0; visibility:hidden; transform:none';
    (document.querySelector('.page') ?? document.body).appendChild(measurer);
  }
  measurer.innerHTML = renderLabel(text);
  measurer.style.whiteSpace = maxW === Infinity ? 'nowrap' : 'normal';
  measurer.style.width = maxW === Infinity ? 'auto' : 'max-content';
  measurer.style.maxWidth = maxW === Infinity ? 'none' : `${maxW}px`;
  const r = measurer.getBoundingClientRect();
  // a word longer than maxW overflows the box: count the overflow
  const size = { w: Math.ceil(Math.max(r.width, measurer.scrollWidth)), h: Math.ceil(r.height) };
  if (sizeCache.size > 1000) sizeCache.clear();
  sizeCache.set(key, size);
  return size;
}

// ── row layout ──

export type RowNote = {
  id: string;
  /** Where the note attaches: the brace tip / underline middle (below) or top of the shape (above). */
  tip: { x: number; y: number };
  /** The note's edge nearest the shape when placed right at it (top edge below, bottom edge above). */
  edge: number;
  /** Size of the note when wrapped to at most `maxW` (Infinity: one line). */
  size: (maxW: number) => { w: number; h: number };
  /** Identifies the note's content (its text), for memoising layouts. */
  key?: string;
};

export type Placed = { id: string; box: Rect; maxW: number; leader: [number, number, number, number] | null };

type Opts = {
  below: boolean;
  left: number;
  right: number;
  gap?: number;
  /** Ink on the line, other shapes and notes already placed: notes and leaders keep off these. */
  obstacles?: Rect[];
};

/** Notes wider than this (px) wrap into a block. */
const COMFY = 200;

/**
 * Spread boxes along a row, then keep them inside [left, right] (order is kept).
 * Wider notes absorb more of the shift: they can move further and still sit under their shape.
 */
function spreadIn(items: { x: number; w: number }[], left: number, right: number, gap: number): number[] {
  const { x } = spread(items.map((it) => ({ ...it, wt: 1 / it.w })), gap);
  const order = items.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  for (let k = 0; k < order.length; k++) {
    const i = order[k], lo = k ? x[order[k - 1]] + items[order[k - 1]].w / 2 + gap + items[i].w / 2 : left + items[i].w / 2;
    x[i] = Math.max(x[i], lo);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k], hi = k < order.length - 1 ? x[order[k + 1]] - items[order[k + 1]].w / 2 - gap - items[i].w / 2 : right - items[i].w / 2;
    x[i] = Math.min(x[i], hi);
  }
  return x;
}

/**
 * Leader from the tip to the facing edge of the box, or null when the note sits
 * right at its shape: the tip comfortably within the note's width, and close.
 */
export function leaderFor(n: RowNote, box: Rect, below: boolean): Placed['leader'] {
  const ey = below ? box.y : box.y + box.h;
  // "comfortably": the tip within the middle 70% of the note
  const m = Math.max(4, box.w * 0.15);
  if (n.tip.x >= box.x + m && n.tip.x <= box.x + box.w - m && Math.abs(ey - n.tip.y) <= 8) return null;
  const inset = Math.min(10, box.w / 2);
  return [n.tip.x, n.tip.y, Math.max(box.x + inset, Math.min(box.x + box.w - inset, n.tip.x)), ey];
}

const cross = (a: number[], b: number[]) => {
  const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (!d) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
};
/** Does the segment pass through the rect (sampled, ignoring its ends)? */
const segHitsBox = (s: number[], r: Rect) => {
  const [x1, y1, x2, y2] = s;
  for (let t = 0.1; t < 0.95; t += 0.05) {
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
};
const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Minimum space between two notes after tightening (spreading uses the roomier `gap`). */
const TIGHT = 10;
/** A leader shorter than this (vertically) reads as a stray tick, not a leader. */
const MIN_LEAD = 10;

/**
 * What a tightened layout must never make worse: notes touching, leaders
 * crossing or grazing notes, covering ink, leaving the column.
 */
function clash(placed: Placed[], o: Opts): number {
  let c = 0;
  const obstacles = o.obstacles ?? [];
  for (let a = 0; a < placed.length; a++) {
    const b = placed[a].box;
    for (let k = a + 1; k < placed.length; k++) c += area(grow(b, TIGHT / 2), grow(placed[k].box, TIGHT / 2));
    for (const r of obstacles) c += area(grow(b, -1), r);
    c += (Math.max(0, o.left - b.x) + Math.max(0, b.x + b.w - o.right)) * 10;
  }
  const ls = placed.map((p) => p.leader).filter((l): l is NonNullable<typeof l> => !!l);
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) if (cross(ls[a], ls[b])) c += 1000;
  for (const p of placed) for (const q of placed) if (p !== q && p.leader && segHitsBox(p.leader, grow(q.box, 3))) c += 1000;
  for (const p of placed) if (p.leader) for (const r of obstacles) if (segHitsBox(p.leader, grow(r, -1))) c += 1000;
  for (const p of placed) if (p.leader && Math.abs(p.leader[3] - p.leader[1]) < MIN_LEAD) c += 1000;
  return c;
}

/**
 * Pack the chosen layout a little tighter: put wrapped notes back on one line
 * where that fits, and slide every note towards its shape as far as it can go
 * without making anything clash. Rows and order stay as they are.
 */
function tighten(ns: RowNote[], placed: Placed[], o: Opts): Placed[] {
  let cur = placed.map((p) => ({ ...p, box: { ...p.box } }));
  let base = clash(cur, o);
  const at = (i: number, box: Rect, maxW: number) => cur.map((q, k) => (k === i ? { ...q, box, maxW, leader: leaderFor(ns[i], box, o.below) } : q));
  // keep order: a note may not pass its neighbours in the same row
  const sameRow = (i: number, k: number) => Math.abs(cur[i].box.y - cur[k].box.y) < 2 || Math.abs(cur[i].box.y + cur[i].box.h - (cur[k].box.y + cur[k].box.h)) < 2;
  const ordered = (i: number, x: number, w: number) =>
    cur.every((q, k) => k === i || !sameRow(i, k) || (k < i ? q.box.x + q.box.w <= x : x + w <= q.box.x));
  // the closest spot to the shape for a box of width w, scanning outward from the ideal
  const nearest = (i: number, w: number, h: number, maxW: number, limit: number) => {
    const ideal = ns[i].tip.x - w / 2;
    const y = o.below ? cur[i].box.y : cur[i].box.y + cur[i].box.h - h;
    for (let d = 0; d <= limit; d++)
      for (const x of d ? [ideal - d, ideal + d] : [ideal]) {
        if (!ordered(i, x, w)) continue;
        const box = { x, y, w, h };
        const next = at(i, box, maxW);
        const c = clash(next, o);
        if (c <= base + 0.5) return { next, c, d };
      }
    return null;
  };
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < ns.length; i++) {
      const p = cur[i];
      const one = ns[i].size(Infinity);
      // back on one line, if that fits near the shape; only a lone wrapped note in its row,
      // so a row wrapped as a set (crowded runs) stays uniform
      const loneWrap = cur.every((q, k) => k === i || !sameRow(i, k) || q.maxW === Infinity || q.maxW === COMFY);
      if (p.maxW !== Infinity && one.w <= COMFY && one.h < p.box.h && loneWrap) {
        const r = nearest(i, one.w, one.h, Infinity, one.w);
        if (r) { cur = r.next; base = r.c; continue; }
      }
      const off = Math.abs(p.box.x + p.box.w / 2 - ns[i].tip.x);
      const r = nearest(i, p.box.w, p.box.h, p.maxW, Math.ceil(off));
      if (r && r.d < off - 0.5) (cur = r.next), (base = r.c);
    }
  // rows: move each (as a whole, keeping its baseline) back towards the shapes, nearest first
  const rows = [...new Set(cur.map((q) => Math.round(o.below ? q.box.y : q.box.y + q.box.h)))].sort((a, b) => (o.below ? a - b : b - a));
  for (const edge of rows) {
    const idx = cur.map((_, i) => i).filter((i) => Math.round(o.below ? cur[i].box.y : cur[i].box.y + cur[i].box.h) === edge);
    const room = Math.min(...idx.map((i) => Math.abs((o.below ? cur[i].box.y : cur[i].box.y + cur[i].box.h) - ns[i].edge)));
    for (let d = Math.floor(room); d >= 1; d--) {
      const dy = o.below ? -d : d;
      const next = cur.map((q, k) => {
        if (!idx.includes(k)) return q;
        const box = { ...q.box, y: q.box.y + dy };
        return { ...q, box, leader: leaderFor(ns[k], box, o.below) };
      });
      if (clash(next, o) <= base + 0.5) {
        cur = next;
        base = clash(cur, o);
        break;
      }
    }
  }
  return cur;
}

/** How unnatural a layout looks (lower is better). */
export function cost(notes: RowNote[], placed: Placed[], o: Opts): number {
  let c = 0;
  const obstacles = o.obstacles ?? [];
  placed.forEach((p, i) => {
    const n = notes[i], b = p.box;
    // distance from being centred on the shape, relative to the note's size
    const d = (b.x + b.w / 2 - n.tip.x) / (b.w / 2 + 6);
    c += d * d * 12;
    if (p.leader) {
      const dx = Math.abs(p.leader[2] - p.leader[0]), dy = Math.abs(p.leader[3] - p.leader[1]);
      // leaders are a cost, and flat ones look like stray underlines
      c += 8 + Math.hypot(dx, dy) * 0.25 + Math.max(0, dx * 0.7 - dy) * 1.2;
      // a leader needs room to be seen: a stub under the shape reads as no leader at all
      if (dy < MIN_LEAD) c += 80;
      for (const r of obstacles) if (segHitsBox(p.leader, grow(r, -1))) c += 40;
    }
    // extra lines from wrapping, and distance from the shape (vertical space used)
    c += Math.max(0, Math.round(b.h / n.size(Infinity).h) - 1) * 16;
    c += Math.abs((o.below ? b.y : b.y + b.h) - n.edge) * 0.5;
    c += (Math.max(0, o.left - b.x) + Math.max(0, b.x + b.w - o.right)) * 20;
    // covering ink, shapes or other notes
    const inner = grow(b, -1);
    for (const r of obstacles) c += area(inner, r) * 4;
  });
  const ls = placed.map((p) => p.leader).filter((l): l is NonNullable<typeof l> => !!l);
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) if (cross(ls[a], ls[b])) c += 300;
  // a leader through (or grazing) another note
  for (const p of placed) for (const q of placed) if (p !== q && p.leader && segHitsBox(p.leader, grow(q.box, 3))) c += 300;
  return c;
}

const memo = new Map<string, Placed[]>();

/**
 * Lay out the notes of one line and side (memoised: rows are laid out again on
 * every edit, usually only moved). See `solveRow`.
 */
export function layoutRow(notes: RowNote[], o: Opts): Placed[] {
  if (!notes.length) return [];
  // only obstacles near the row matter
  const xs = notes.map((n) => n.tip.x), es = notes.map((n) => n.edge);
  const x0 = Math.min(...xs) - 320, x1 = Math.max(...xs) + 320;
  const y0 = o.below ? Math.min(...es) - 12 : Math.min(...es) - 160, y1 = o.below ? Math.max(...es) + 160 : Math.max(...es) + 12;
  const obstacles = (o.obstacles ?? []).filter((r) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0);
  // key: everything relative to the first note's tip, rounded
  const ox = notes[0].tip.x, oy = notes[0].edge;
  const R = (v: number) => Math.round(v);
  const key = notes.some((n) => n.key === undefined)
    ? null
    : JSON.stringify([
        o.below, R(o.left - ox), R(o.right - ox), o.gap ?? 16,
        notes.map((n) => [n.key, R(n.tip.x - ox), R(n.tip.y - oy), R(n.edge - oy)]),
        obstacles.map((r) => [R(r.x - ox), R(r.y - oy), R(r.w), R(r.h)]),
      ]);
  const hit = key !== null ? memo.get(key) : undefined;
  const shift = (ps: Placed[], dx: number, dy: number): Placed[] =>
    ps.map((p) => ({
      ...p,
      box: { ...p.box, x: p.box.x + dx, y: p.box.y + dy },
      leader: p.leader && [p.leader[0] + dx, p.leader[1] + dy, p.leader[2] + dx, p.leader[3] + dy],
    }));
  if (hit) return shift(hit, ox, oy);
  const res = solveRow(notes, { ...o, obstacles });
  if (key !== null) {
    if (memo.size > 400) memo.clear();
    memo.set(key, shift(res, -ox, -oy));
  }
  return res;
}

/**
 * Lay out the notes of one line and side. Candidates: one row or two
 * alternating rows; notes at natural width, wrapped greedily, or all wrapped to
 * two or three lines; each slid and dropped by a little. The cheapest wins and
 * is then tightened.
 */
function solveRow(notes: RowNote[], o: Opts): Placed[] {
  const gap = o.gap ?? 16;
  const n = notes.length;
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].tip.x - notes[b].tip.x);
  const ns = order.map((i) => notes[i]);
  const dir = o.below ? 1 : -1;
  const one = ns.map((x) => x.size(Infinity));
  // Notes near each other share a baseline, clear of all their shapes; notes far
  // apart (more than NEAR px between them at natural size) keep their own.
  const NEAR = 40;
  const group: number[] = [];
  ns.forEach((x, i) => {
    const near = i > 0 && x.tip.x - one[i].w / 2 - (ns[i - 1].tip.x + one[i - 1].w / 2) < NEAR;
    group.push(i === 0 ? 0 : near ? group[i - 1] : group[i - 1] + 1);
  });
  const base = group.map((g) => {
    const es = ns.filter((_, i) => group[i] === g).map((x) => x.edge);
    return o.below ? Math.max(...es) : Math.min(...es);
  });

  const build = (maxW: number[], rowOf: number[], dy = 0, dx = 0): Placed[] => {
    const sizes = ns.map((x, i) => x.size(maxW[i]));
    const rows = [...new Set(rowOf)].sort();
    const out: Placed[] = new Array(n);
    // per group: how far the next row starts from the group's baseline
    const offset = new Map<number, number>();
    for (const r of rows) {
      const idx = ns.map((_, i) => i).filter((i) => rowOf[i] === r);
      const xs = spreadIn(idx.map((i) => ({ x: ns[i].tip.x, w: sizes[i].w })), o.left, o.right, gap);
      const used = new Map<number, number>();
      idx.forEach((i, k) => {
        const s = sizes[i];
        const edge = base[i] + dir * (dy + (offset.get(group[i]) ?? 0));
        const box = { x: xs[k] - s.w / 2 + dx, y: o.below ? edge : edge - s.h, w: s.w, h: s.h };
        out[i] = { id: ns[i].id, box, maxW: maxW[i], leader: leaderFor(ns[i], box, o.below) };
        used.set(group[i], Math.max(used.get(group[i]) ?? 0, s.h));
      });
      for (const [g, h] of used) offset.set(g, (offset.get(g) ?? 0) + h + 4);
    }
    return out;
  };

  // notes wider than is comfortable to read under a formula wrap into a block
  const comfy = ns.map((_, i) => (one[i].w > COMFY ? COMFY : Infinity));
  const lines = (maxW: number[], i: number) => Math.round(ns[i].size(maxW[i]).h / one[i].h);
  // the narrowest width that wraps note i onto at most k lines
  const widthFor = (i: number, k: number) => {
    for (let w = Math.max(40, Math.ceil(one[i].w / k)); w < one[i].w; w += 4) if (Math.round(ns[i].size(w).h / one[i].h) <= k) return w;
    return comfy[i];
  };
  const wrapTo = (k: number) => ns.map((_, i) => (one[i].w > 60 ? widthFor(i, k) : comfy[i]));

  // wrapping, greedily: wrap whichever note (one more line) lowers the cost most, until nothing helps
  const greedy = (rowOf: number[]) => {
    let maxW = [...comfy];
    let best = cost(ns, build(maxW, rowOf), o);
    for (let step = 0; step < 2 * n; step++) {
      let pick: number[] | null = null;
      for (let i = 0; i < n; i++) {
        const l = lines(maxW, i);
        if (ns[i].size(maxW[i]).w <= 60 || l >= 3) continue;
        const next = [...maxW];
        next[i] = widthFor(i, l + 1);
        const c = cost(ns, build(next, rowOf), o);
        if (c < best - 0.5) (best = c), (pick = next);
      }
      if (!pick) break;
      maxW = pick;
    }
    return maxW;
  };

  const single = ns.map(() => 0);
  const alt = ns.map((_, i) => i % 2);
  const DX = [0, -4, 4, -8, 8, -12, 12, -16, 16, -24, 24];
  const DY = [0, 4, 8, 12, 16, 24, 32, 44];
  let best: Placed[] | null = null, bestCost = Infinity;
  for (const rowOf of n > 2 ? [single, alt] : [single])
    for (const maxW of [comfy, greedy(rowOf), wrapTo(2), wrapTo(3)])
      for (const dy of DY)
        for (const dx of DX) {
          const p = build(maxW, rowOf, dy, dx);
          const c = cost(ns, p, o) + Math.abs(dx) * 0.3;
          // (the first candidate stands in if every cost is NaN, e.g. on a detached page)
          if (best === null || c < bestCost) (bestCost = c), (best = p);
        }
  best = tighten(ns, best!, o);
  // back to the caller's order
  const res: Placed[] = new Array(n);
  order.forEach((orig, k) => (res[orig] = best![k]));
  return res;
}
