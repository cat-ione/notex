// Arrow geometry: a quadratic curve between two anchor boxes, clipped to the
// box edges along the curve's tangent so arrowheads touch the target.

import { center, pad, type Rect } from './geom';

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

export function arrowGeo(a: Rect, b: Rect, bend: number, outline: { from?: Outline; to?: Outline } = {}): ArrowGeo | null {
  const pa = outline.from ? pad(outline.from.r, 2) : pad(a, 3), pb = outline.to ? pad(outline.to.r, 2) : pad(b, 3);
  const ca = center(pa), cb = center(pb);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  // Left-hand perpendicular in screen coordinates: positive bend arcs "up" for a rightward arrow.
  const nx = dy / len, ny = -dx / len;
  const ctrl = { x: (ca.x + cb.x) / 2 + nx * bend * len, y: (ca.y + cb.y) / 2 + ny * bend * len };
  const p0 = rayExit(pa, ca, ctrl, outline.from?.round);
  const p2 = rayExit(pb, cb, ctrl, outline.to?.round);
  const mid = { x: 0.25 * p0.x + 0.5 * ctrl.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * ctrl.y + 0.25 * p2.y };
  const f = (n: number) => n.toFixed(1);
  return { d: `M${f(p0.x)},${f(p0.y)} Q${f(ctrl.x)},${f(ctrl.y)} ${f(p2.x)},${f(p2.y)}`, mid, dir: Math.sign(dx) || 1, from: pa, to: pb, p0, p2 };
}

/** The bend that puts the curve's middle at `p` (for dragging the bend handle). */
export function bendThrough(a: Rect, b: Rect, p: Pt): number {
  const ca = center(a), cb = center(b);
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
