// Arrow geometry: a quadratic curve between two anchor boxes, clipped to the
// box edges along the curve's tangent so arrowheads touch the target.

import { center, pad, type Rect } from './geom';

export type ArrowGeo = { d: string; mid: { x: number; y: number }; dir: number; from: Rect; to: Rect };

function rayExit(r: Rect, c: { x: number; y: number }, toward: { x: number; y: number }) {
  const dx = toward.x - c.x, dy = toward.y - c.y;
  const tx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export function arrowGeo(a: Rect, b: Rect, bend: number): ArrowGeo | null {
  const pa = pad(a, 3), pb = pad(b, 3);
  const ca = center(pa), cb = center(pb);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  // Left-hand perpendicular in screen coordinates: positive bend arcs "up" for a rightward arrow.
  const nx = dy / len, ny = -dx / len;
  const ctrl = { x: (ca.x + cb.x) / 2 + nx * bend * len, y: (ca.y + cb.y) / 2 + ny * bend * len };
  const p0 = rayExit(pa, ca, ctrl);
  const p2 = rayExit(pb, cb, ctrl);
  const mid = { x: 0.25 * p0.x + 0.5 * ctrl.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * ctrl.y + 0.25 * p2.y };
  const f = (n: number) => n.toFixed(1);
  return { d: `M${f(p0.x)},${f(p0.y)} Q${f(ctrl.x)},${f(ctrl.y)} ${f(p2.x)},${f(p2.y)}`, mid, dir: Math.sign(dx) || 1, from: pa, to: pb };
}

/** A pleasant default curvature: arc over the text when roughly horizontal. */
export function defaultBend(a: Rect, b: Rect) {
  const dx = center(b).x - center(a).x, dy = center(b).y - center(a).y;
  const horizontal = Math.abs(dy) < Math.max(a.h, b.h);
  const mag = horizontal ? 0.35 : 0.2;
  return dx >= 0 ? mag : -mag;
}
