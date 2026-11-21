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
  /** Horizontal extent of the shape: a note overlapping it still reads as belonging to it. */
  span: [number, number];
  /** Size of the note when wrapped to at most `maxW` (Infinity: one line). */
  size: (maxW: number) => { w: number; h: number };
};

export type Placed = { id: string; box: Rect; maxW: number; leader: [number, number, number, number] | null };

type Opts = { below: boolean; left: number; right: number; gap?: number };

/** Notes wider than this (px) wrap into a block. */
const COMFY = 200;

/** Spread boxes along a row, then keep them inside [left, right] (order is kept). */
function spreadIn(items: { x: number; w: number }[], left: number, right: number, gap: number): number[] {
  const { x } = spread(items, gap);
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

/** How much of the shape's span the note's box overlaps, horizontally. */
const overlap = (n: RowNote, b: Rect) => Math.min(b.x + b.w, n.span[1]) - Math.max(b.x, n.span[0]);

/**
 * Leader from the tip to the facing edge of the box, or null when the note
 * still sits at its shape: overlapping a good part of it and close below/above.
 */
export function leaderFor(n: RowNote, box: Rect, below: boolean): Placed['leader'] {
  const ey = below ? box.y : box.y + box.h;
  const sits = overlap(n, box) >= Math.min(8, (n.span[1] - n.span[0]) / 2) && Math.abs(ey - n.tip.y) <= 14;
  if (sits) return null;
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
const segHitsBox = (s: number[], r: Rect) => {
  const [x1, y1, x2, y2] = s;
  for (let t = 0.1; t < 1; t += 0.1) {
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
};

/** How unnatural a layout looks (lower is better). */
export function cost(notes: RowNote[], placed: Placed[], o: Opts): number {
  let c = 0;
  const one = notes.map((n) => n.size(Infinity));
  placed.forEach((p, i) => {
    const n = notes[i], b = p.box;
    // a mild pull towards being centred on the shape
    c += Math.abs(b.x + b.w / 2 - n.tip.x) * 0.15;
    // moved off the shape entirely: no longer reads as belonging to it
    c += Math.max(0, -overlap(n, b)) * 0.8;
    if (p.leader) {
      const dx = Math.abs(p.leader[2] - p.leader[0]), dy = Math.abs(p.leader[3] - p.leader[1]);
      // leaders are a cost, and flat ones look like stray underlines
      c += 6 + Math.hypot(dx, dy) * 0.25 + Math.max(0, dx * 0.7 - dy) * 1.2;
    }
    // extra lines from wrapping, and distance from the shape (vertical space used)
    c += Math.max(0, Math.round(b.h / one[i].h) - 1) * 10;
    c += Math.abs((o.below ? b.y : b.y + b.h) - n.edge) * 0.6;
    c += (Math.max(0, o.left - b.x) + Math.max(0, b.x + b.w - o.right)) * 20;
  });
  const ls = placed.map((p) => p.leader).filter((l): l is NonNullable<typeof l> => !!l);
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) if (cross(ls[a], ls[b])) c += 300;
  const inset = (r: Rect): Rect => ({ x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 });
  for (const p of placed) for (const q of placed) if (p !== q && p.leader && segHitsBox(p.leader, inset(q.box))) c += 300;
  return c;
}

/**
 * Lay out the notes of one line and side. Tries: one row at natural width;
 * one row with crowded long notes wrapped; two alternating rows (wrapped);
 * each with a little extra drop when notes moved sideways. Returns the cheapest.
 */
export function layoutRow(notes: RowNote[], o: Opts): Placed[] {
  const gap = o.gap ?? 16;
  const n = notes.length;
  if (!n) return [];
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].tip.x - notes[b].tip.x);
  const ns = order.map((i) => notes[i]);
  const dir = o.below ? 1 : -1;
  // Notes near each other share a baseline, clear of all their shapes; notes far
  // apart (more than NEAR px between them at natural size) keep their own.
  const NEAR = 40;
  const group: number[] = [];
  ns.forEach((x, i) => {
    const w = x.size(Infinity).w, pw = i ? ns[i - 1].size(Infinity).w : 0;
    const near = i > 0 && x.tip.x - w / 2 - (ns[i - 1].tip.x + pw / 2) < NEAR;
    group.push(i === 0 ? 0 : near ? group[i - 1] : group[i - 1] + 1);
  });
  const base = group.map((g) => {
    const es = ns.filter((_, i) => group[i] === g).map((x) => x.edge);
    return o.below ? Math.max(...es) : Math.min(...es);
  });

  const build = (maxW: number[], rowOf: number[], drop: number): Placed[] => {
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
        const edge = base[i] + dir * (drop + (offset.get(group[i]) ?? 0));
        const box = { x: xs[k] - s.w / 2, y: o.below ? edge : edge - s.h, w: s.w, h: s.h };
        out[i] = { id: ns[i].id, box, maxW: maxW[i], leader: leaderFor(ns[i], box, o.below) };
        used.set(group[i], Math.max(used.get(group[i]) ?? 0, s.h));
      });
      for (const [g, h] of used) offset.set(g, (offset.get(g) ?? 0) + h + 4);
    }
    return out;
  };

  // notes wider than is comfortable to read under a formula wrap into a block
  const comfy = ns.map((x) => (x.size(Infinity).w > COMFY ? COMFY : Infinity));

  // wrapping: shrink the widest crowded notes, one step at a time
  // wrapping, greedily: wrap whichever note (one more line) lowers the cost most, until nothing helps
  const wrapped = (rowOf: number[], drop: number) => {
    let maxW = [...comfy];
    let best = cost(ns, build(maxW, rowOf, drop), o);
    for (let step = 0; step < 2 * n; step++) {
      let pick: number[] | null = null;
      for (let i = 0; i < n; i++) {
        const one = ns[i].size(Infinity);
        const cur = ns[i].size(maxW[i]);
        const lines = Math.round(cur.h / one.h);
        if (cur.w <= 60 || lines >= 3) continue;
        const next = [...maxW];
        next[i] = Math.max(56, Math.ceil(one.w / (lines + 1)) + 14);
        const c = cost(ns, build(next, rowOf, drop), o);
        if (c < best - 0.5) (best = c), (pick = next);
      }
      if (!pick) break;
      maxW = pick;
    }
    return maxW;
  };

  const one = ns.map(() => 0);
  const alt = ns.map((_, i) => i % 2);
  const options: Placed[][] = [];
  for (const rowOf of n > 2 ? [one, alt] : [one]) {
    for (const drop of [0, 12, 24, 40]) {
      options.push(build(comfy, rowOf, drop));
      options.push(build(wrapped(rowOf, drop), rowOf, drop));
    }
  }
  const best = options.reduce((a, b) => (cost(ns, b, o) < cost(ns, a, o) ? b : a));
  // back to the caller's order
  const res: Placed[] = new Array(n);
  order.forEach((orig, k) => (res[orig] = best[k]));
  return res;
}
