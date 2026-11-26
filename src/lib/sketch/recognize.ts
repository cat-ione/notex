// A stroke drawn roughly, as the shape it was meant to be: a line, a box, an ellipse or a
// diamond (when the pen is held still at its end, see Sketcher). Null: not one of them.

import { segDist, simplify, type Box, type Pt } from './shapes';

export type Recognized = { k: 'line'; a: Pt; b: Pt } | { k: 'rect' | 'ellipse' | 'diamond'; box: Box };

const pairs = (pts: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
};

export function recognize(pts: number[]): Recognized | null {
  const ps = pairs(pts);
  if (ps.length < 3) return null;
  let len = 0;
  for (let i = 1; i < ps.length; i++) len += Math.hypot(ps[i].x - ps[i - 1].x, ps[i].y - ps[i - 1].y);
  if (len < 16) return null;
  const a = ps[0], z = ps[ps.length - 1];
  const gap = Math.hypot(z.x - a.x, z.y - a.y);
  // nearly straight from end to end: a line
  const dev = Math.max(...ps.map((p) => segDist(p, a, z)));
  if (gap > 0.6 * len && dev < Math.max(4, 0.06 * gap)) return { k: 'line', a, b: z };
  // ends close together: a closed shape
  if (gap > 0.22 * len) return null;
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const box: Box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (box.w < 8 || box.h < 8) return null;
  const diag = Math.hypot(box.w, box.h);
  // its corners: the points a coarse simplification keeps (the ends are one corner, or none)
  const flat = ps.flatMap((p) => [p.x, p.y, 0.5]);
  const corners = pairs(simplify([...flat, a.x, a.y, 0.5], diag * 0.09)).slice(0, -1);
  const near = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) < diag * 0.2;
  const boxCorners = [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
  const mids = [{ x: box.x + box.w / 2, y: box.y }, { x: box.x + box.w, y: box.y + box.h / 2 }, { x: box.x + box.w / 2, y: box.y + box.h }, { x: box.x, y: box.y + box.h / 2 }];
  // round: points stay about as far from the middle as an ellipse's outline is (a box's or a
  // diamond's are some 15–19% off it on average)
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const off = ps.map((p) => Math.abs(Math.hypot((p.x - c.x) / (box.w / 2), (p.y - c.y) / (box.h / 2)) - 1));
  const round = off.reduce((s, v) => s + v, 0) / off.length;
  if (round < 0.1) return { k: 'ellipse', box };
  // (each of the four found: near a corner of the box, or near the middle of its sides)
  const hits = (targets: Pt[]) => targets.filter((t) => corners.some((c) => near(c, t))).length;
  if (corners.length >= 3 && corners.length <= 6) {
    if (hits(boxCorners) >= 3) return { k: 'rect', box };
    if (hits(mids) >= 3) return { k: 'diamond', box };
  }
  return round < 0.14 ? { k: 'ellipse', box } : null;
}
