// Arrow geometry: a quadratic curve between two anchor boxes, clipped to the
// box edges along the curve's tangent so arrowheads touch the target.

import { center, pad, type Rect } from './geom';
import type { Attach } from './model';

type Pt = { x: number; y: number };
export type ArrowGeo = { d: string; mid: Pt; dir: number; from: Rect; to: Rect; p0: Pt; p2: Pt; leader?: string };

/** An arrow end that should touch an outline (a circled / boxed target) instead of the text. */
export type Outline = { r: Rect; round: boolean };

function rayExit(r: Rect, c: { x: number; y: number }, toward: { x: number; y: number }, round = false) {
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (round) {
    const t = Math.min(1, 1 / Math.hypot(dx / (r.w / 2), dy / (r.h / 2)));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  const tx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** The point an Attach names on a box (on its outline, for a circled target). */
function attachPoint(r: Rect, at: Attach, round = false): Pt {
  return rayExit(r, center(r), { x: r.x + at.x * r.w, y: r.y + at.y * r.h }, round);
}

export function arrowGeo(a: Rect, b: Rect, bend: number, outline: { from?: Outline; to?: Outline } = {}, at: { from?: Attach; to?: Attach } = {}): ArrowGeo | null {
  const pa = outline.from ? pad(outline.from.r, 2) : pad(a, 3), pb = outline.to ? pad(outline.to.r, 2) : pad(b, 3);
  const ca = center(pa), cb = center(pb);
  // an end attached at a chosen point runs from there; otherwise from the middle, clipped
  const fa = at.from && attachPoint(pa, at.from, outline.from?.round), fb = at.to && attachPoint(pb, at.to, outline.to?.round);
  const A = fa ?? ca, B = fb ?? cb;
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  // Left-hand perpendicular in screen coordinates: positive bend arcs "up" for a rightward arrow.
  const nx = dy / len, ny = -dx / len;
  const ctrl = { x: (A.x + B.x) / 2 + nx * bend * len, y: (A.y + B.y) / 2 + ny * bend * len };
  const p0 = fa ?? rayExit(pa, ca, ctrl, outline.from?.round);
  const p2 = fb ?? rayExit(pb, cb, ctrl, outline.to?.round);
  const mid = { x: 0.25 * p0.x + 0.5 * ctrl.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * ctrl.y + 0.25 * p2.y };
  const f = (n: number) => n.toFixed(1);
  return { d: `M${f(p0.x)},${f(p0.y)} Q${f(ctrl.x)},${f(ctrl.y)} ${f(p2.x)},${f(p2.y)}`, mid, dir: Math.sign(dx) || 1, from: pa, to: pb, p0, p2 };
}

/**
 * Where on a target box a dropped arrow end attaches: onto the nearest side from the drop
 * point; near the middle, nowhere in particular (undefined: it faces the other end).
 */
export function attachAt(r: Rect, p: Pt): Attach | undefined {
  const x = (p.x - r.x) / r.w, y = (p.y - r.y) / r.h;
  // the middle: a small spot, so even a single letter's sides are easy to hit
  if (Math.abs(x - 0.5) * r.w < Math.max(2, 0.15 * r.w) && Math.abs(y - 0.5) * r.h < Math.max(2, 0.15 * r.h)) return undefined;
  const cx = Math.max(0, Math.min(1, x)), cy = Math.max(0, Math.min(1, y));
  // distance to each side, in pixels: the nearest one wins
  const d = { top: cy * r.h, bottom: (1 - cy) * r.h, left: cx * r.w, right: (1 - cx) * r.w };
  const side = (Object.keys(d) as (keyof typeof d)[]).reduce((m, k) => (d[k] < d[m] ? k : m), 'top');
  const q = (v: number) => Math.round(v * 20) / 20;
  return side === 'top' ? { x: q(cx), y: 0 } : side === 'bottom' ? { x: q(cx), y: 1 } : side === 'left' ? { x: 0, y: q(cy) } : { x: 1, y: q(cy) };
}

/** The four sides' middles, in the order Shift+S / Shift+E go through them (after automatic). */
export const SIDES: { name: string; at: Attach }[] = [
  { name: 'top', at: { x: 0.5, y: 0 } },
  { name: 'right', at: { x: 1, y: 0.5 } },
  { name: 'bottom', at: { x: 0.5, y: 1 } },
  { name: 'left', at: { x: 0, y: 0.5 } },
];
export const sideName = (at: Attach | undefined) => (at ? (SIDES.find((s) => s.at.x === at.x && s.at.y === at.y)?.name ?? 'there') : 'auto');
/** The next of automatic, top, right, bottom, left (a dragged spot goes on to the top). */
export function nextSide(at: Attach | undefined): Attach | undefined {
  if (!at) return { ...SIDES[0].at };
  const i = SIDES.findIndex((s) => s.at.x === at.x && s.at.y === at.y);
  return i < 0 ? { ...SIDES[0].at } : i === SIDES.length - 1 ? undefined : { ...SIDES[i + 1].at };
}

/** The bend that puts the curve's middle at `p` (for dragging the bend handle). */
export function bendThrough(a: Rect, b: Rect, p: Pt, at: { from?: Attach; to?: Attach } = {}): number {
  const ca = at.from ? attachPoint(a, at.from) : center(a), cb = at.to ? attachPoint(b, at.to) : center(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy) || 1;
  // The curve's midpoint sits halfway between the chord's midpoint and the control point.
  const off = (p.x - (ca.x + cb.x) / 2) * (dy / len) + (p.y - (ca.y + cb.y) / 2) * (-dx / len);
  return Math.round(((2 * off) / len) * 100) / 100;
}

/** A pleasant default curvature: arc over the text when roughly horizontal. */
export function defaultBend(a: Rect, b: Rect) {
  const dx = center(b).x - center(a).x, dy = center(b).y - center(a).y;
  const horizontal = Math.abs(dy) < Math.max(a.h, b.h);
  // Cap the arc's height so long arrows don't loop far above the text.
  const len = Math.hypot(dx, dy) || 1;
  const mag = Math.min(horizontal ? 0.35 : 0.2, (horizontal ? 36 : 28) / len);
  return dx >= 0 ? mag : -mag;
}
