// Diagrams and sketches: the shapes, and the geometry to draw, hit, move and connect them.
//
// The same shapes live in a diagram block (in its own coordinates) and on top of a note
// (each pinned to the block under it, see Placed). Lines can end on a shape (`to`): that end
// follows the shape, meeting its outline on the side facing the other end.

import { uid, type Id } from '../model';

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** Stroke width, thin to bold. */
export type Width = 1 | 2 | 3;
export const WIDTHS: Width[] = [1, 2, 3];
/** The line's width in pixels (a pen stroke's at full pressure). */
export const strokePx = (w: Width | undefined) => [1.25, 2, 3.5][(w ?? 2) - 1];

type Base = {
  id: Id;
  /** An ink colour (see INKS); absent: the text colour. */
  color?: string;
  width?: Width;
  dash?: boolean;
};
/** A stroke of the pen: x, y and pressure (0–1) for each point. `pen`: drawn with a pen (its width follows the pressure). */
export type InkShape = Base & { k: 'ink'; pts: number[]; pen?: true };
/** A line's end: where it is, and the shape it's attached to (if any). */
export type End = Pt & { to?: Id };
export type Head = 'none' | 'end' | 'both';
/** A line, with an optional label at its middle. */
export type LineShape = Base & { k: 'line'; a: End; b: End; head: Head; label?: string };
/** A box, ellipse or diamond (with a label inside), or a text (a label with no outline). */
export type BoxKind = 'rect' | 'ellipse' | 'diamond' | 'text';
export type BoxShape = Base & Box & { k: BoxKind; label?: string; fill?: boolean };
export type Shape = InkShape | LineShape | BoxShape;
export type ShapeKind = Shape['k'];

/** A shape on top of a note: pinned to a block (`at`), in coordinates from that block's top left. */
export type Placed = Shape & { at: Id };

export const isBox = (s: Shape): s is BoxShape => s.k === 'rect' || s.k === 'ellipse' || s.k === 'diamond' || s.k === 'text';

// ── making them ──

export const inkShape = (pts: number[], pen: boolean, style: Partial<Base> = {}): InkShape => ({ id: uid(), k: 'ink', pts, ...(pen ? { pen: true as const } : {}), ...style });
export const lineShape = (a: End, b: End, head: Head, style: Partial<Base> = {}): LineShape => ({ id: uid(), k: 'line', a, b, head, ...style });
export const boxShape = (k: BoxKind, box: Box, style: Partial<Base> & { label?: string; fill?: boolean } = {}): BoxShape => ({ id: uid(), k, ...normBox(box), ...style });

/** A box with a positive width and height (dragged up or left, it's turned round). */
export function normBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}
export const boxOf = (a: Pt, b: Pt): Box => normBox({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });

/** A copy with fresh ids; lines attached among the copied shapes stay attached to the copies. */
export function cloneShapes<S extends Shape>(list: S[]): S[] {
  const ids = new Map(list.map((s) => [s.id, uid()]));
  return list.map((s) => {
    const c = structuredClone(s) as S;
    c.id = ids.get(s.id)!;
    if (c.k === 'line') {
      for (const e of [c.a, c.b]) {
        if (e.to && ids.has(e.to)) e.to = ids.get(e.to);
        else delete e.to;
      }
    }
    return c;
  });
}

// ── where they are ──

const pairs = (pts: number[]) => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
};
export const inkPoints = (s: InkShape) => pairs(s.pts);

export const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** The shapes by id, for attached lines to find their ends. */
export type Lookup = (id: Id) => Shape | undefined;
export const lookupIn = (list: Shape[]): Lookup => {
  const m = new Map(list.map((s) => [s.id, s]));
  return (id) => m.get(id);
};

/** How far outside its outline a line attached to a shape stops. */
const GAP = 3;

/** Where a ray from a box's middle towards `to` leaves its outline (plus `gap`). */
export function outlinePoint(s: BoxShape, to: Pt, gap = GAP): Pt {
  const c = centre(s);
  let dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) dy = 1;
  const hw = s.w / 2 + gap, hh = s.h / 2 + gap;
  let t: number;
  if (s.k === 'ellipse') t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  else if (s.k === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * A line's two ends, as drawn: an end attached to a shape meets its outline, facing the other
 * end (or the other shape's middle).
 */
export function lineEnds(s: LineShape, find: Lookup): [Pt, Pt] {
  const ta = s.a.to ? find(s.a.to) : undefined, tb = s.b.to ? find(s.b.to) : undefined;
  const A = ta && isBox(ta) ? ta : undefined, B = tb && isBox(tb) ? tb : undefined;
  const aim = (box: BoxShape | undefined, e: End) => (box ? centre(box) : { x: e.x, y: e.y });
  const pa = A ? outlinePoint(A, aim(B, s.b)) : { x: s.a.x, y: s.a.y };
  const pb = B ? outlinePoint(B, A ? centre(A) : pa) : { x: s.b.x, y: s.b.y };
  // (re-aim the first end at where the second really is)
  return [A && !B ? outlinePoint(A, pb) : pa, pb];
}

/** Where a line's label goes: a box round its middle. */
export function lineLabelBox(s: LineShape, find: Lookup, w = 160, h = 26): Box {
  const [a, b] = lineEnds(s, find);
  return { x: (a.x + b.x) / 2 - w / 2, y: (a.y + b.y) / 2 - h / 2, w, h };
}

/** Whether a shape can have a label (typed with enter or a double-click). */
export const labelled = (s: Shape): s is BoxShape | LineShape => isBox(s) || s.k === 'line';

/** The smallest box around a shape (an attached line's ends as drawn). */
export function bounds(s: Shape, find: Lookup = () => undefined): Box {
  if (isBox(s)) return { x: s.x, y: s.y, w: s.w, h: s.h };
  const ps = s.k === 'ink' ? inkPoints(s) : lineEnds(s, find);
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The box around several shapes (null: none). */
export function boundsOf(list: Shape[], find: Lookup = lookupIn(list)): Box | null {
  if (!list.length) return null;
  const bs = list.map((s) => bounds(s, find));
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** Distance from p to the segment a–b. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const polyDist = (p: Pt, ps: Pt[]) => (ps.length === 1 ? Math.hypot(p.x - ps[0].x, p.y - ps[0].y) : Math.min(...ps.slice(1).map((q, i) => segDist(p, ps[i], q))));

/** Whether p is inside a box shape's outline. */
function inside(s: BoxShape, p: Pt): boolean {
  const c = centre(s), dx = Math.abs(p.x - c.x), dy = Math.abs(p.y - c.y), hw = s.w / 2, hh = s.h / 2;
  if (s.k === 'ellipse') return hw > 0 && hh > 0 && (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
  if (s.k === 'diamond') return hw > 0 && hh > 0 && dx / hw + dy / hh <= 1;
  return dx <= hw && dy <= hh;
}

/**
 * Whether p (within `tol`) is on a shape: a stroke or line near its path; a box, ellipse,
 * diamond or text anywhere inside (easier to pick up than its outline alone).
 */
export function hits(s: Shape, p: Pt, tol: number, find: Lookup = () => undefined): boolean {
  const w = strokePx(s.width) / 2;
  if (s.k === 'ink') return polyDist(p, inkPoints(s)) <= tol + w;
  if (s.k === 'line') {
    const [a, b] = lineEnds(s, find);
    return segDist(p, a, b) <= tol + w;
  }
  if (inside(s, p)) return true;
  // just outside: near the outline
  const grown = { ...s, x: s.x - tol, y: s.y - tol, w: s.w + 2 * tol, h: s.h + 2 * tol };
  return inside(grown, p);
}

/** The topmost shape at p (the last drawn), or null. */
export function shapeAt(list: Shape[], p: Pt, tol: number, find: Lookup = lookupIn(list)): Shape | null {
  for (let i = list.length - 1; i >= 0; i--) if (hits(list[i], p, tol, find)) return list[i];
  return null;
}

/** Whether a box lies wholly inside another. */
export const within = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** The shapes wholly inside a box (a selection rectangle). */
export const shapesIn = (list: Shape[], r: Box, find: Lookup = lookupIn(list)) => list.filter((s) => within(bounds(s, find), r));

/** The shapes a stroke of the eraser from a to b goes over (within `tol`). */
export function erased(list: Shape[], a: Pt, b: Pt, tol: number, find: Lookup = lookupIn(list)): Shape[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, tol)));
  const steps = Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  return list.filter((s) => {
    // (a box is erased by going over its outline or label, not by passing through an empty inside)
    if (isBox(s) && s.k !== 'text' && !s.fill && !s.label) {
      const ring = (p: Pt) => hits(s, p, tol, find) && !hits({ ...s, x: s.x + tol, y: s.y + tol, w: s.w - 2 * tol, h: s.h - 2 * tol }, p, 0, find);
      return steps.some(ring);
    }
    return steps.some((p) => hits(s, p, tol, find));
  });
}

// ── changing them ──

/** A shape moved by (dx, dy). An attached end stays attached (it follows its shape). */
export function moved<S extends Shape>(s: S, dx: number, dy: number): S {
  if (s.k === 'ink') return { ...s, pts: s.pts.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v)) };
  if (s.k === 'line') return { ...s, a: { ...s.a, x: s.a.x + dx, y: s.a.y + dy }, b: { ...s.b, x: s.b.x + dx, y: s.b.y + dy } };
  return { ...s, x: (s as BoxShape).x + dx, y: (s as BoxShape).y + dy };
}

/** A shape fitted from one box into another (resizing a selection). */
export function scaled<S extends Shape>(s: S, from: Box, to: Box): S {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const X = (x: number) => to.x + (x - from.x) * sx, Y = (y: number) => to.y + (y - from.y) * sy;
  if (s.k === 'ink') return { ...s, pts: s.pts.map((v, i) => (i % 3 === 0 ? X(v) : i % 3 === 1 ? Y(v) : v)) };
  if (s.k === 'line') return { ...s, a: { ...s.a, x: X(s.a.x), y: Y(s.a.y) }, b: { ...s.b, x: X(s.b.x), y: Y(s.b.y) } };
  const b = s as BoxShape;
  return { ...s, ...normBox({ x: X(b.x), y: Y(b.y), w: b.w * sx, h: b.h * sy }) };
}

/** Lines attached to any of `ids` let go of them, keeping their ends where they are drawn. */
export function detach(list: Shape[], ids: Set<Id>, find: Lookup = lookupIn(list)): Shape[] {
  return list.map((s) => {
    if (s.k !== 'line' || !((s.a.to && ids.has(s.a.to)) || (s.b.to && ids.has(s.b.to)))) return s;
    const [pa, pb] = lineEnds(s, find);
    const a: End = s.a.to && ids.has(s.a.to) ? pa : s.a, b: End = s.b.to && ids.has(s.b.to) ? pb : s.b;
    return { ...s, a: { ...a }, b: { ...b } };
  });
}

/** The box shape (not a line) an end dropped at p would attach to: the topmost one at p, if any. */
export function attachTarget(list: Shape[], p: Pt, tol: number, not?: Id): BoxShape | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (isBox(s) && s.id !== not && hits(s, p, tol)) return s;
  }
  return null;
}

// ── strokes ──

/** Fewer points along a stroke, none further than `tol` from where it was (Douglas–Peucker; pressure kept). */
export function simplify(pts: number[], tol = 0.35): number[] {
  const n = pts.length / 3;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const P = (i: number): Pt => ({ x: pts[i * 3], y: pts[i * 3 + 1] });
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, d = tol;
    for (let i = a + 1; i < b; i++) {
      const di = segDist(P(i), P(a), P(b));
      // (pressure changes matter too, for a pen's width)
      const dp = Math.abs(pts[i * 3 + 2] - (pts[a * 3 + 2] + pts[b * 3 + 2]) / 2) * 4;
      if (Math.max(di, dp) > d) (d = Math.max(di, dp)), (far = i);
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A smooth path through points (quadratic curves through the midpoints), for stroking. */
export function smoothPath(ps: Pt[]): string {
  if (!ps.length) return '';
  if (ps.length === 1) return `M${r1(ps[0].x)},${r1(ps[0].y)}l0.01,0`;
  if (ps.length === 2) return `M${r1(ps[0].x)},${r1(ps[0].y)}L${r1(ps[1].x)},${r1(ps[1].y)}`;
  let d = `M${r1(ps[0].x)},${r1(ps[0].y)}`;
  for (let i = 1; i < ps.length - 1; i++) {
    const m = { x: (ps[i].x + ps[i + 1].x) / 2, y: (ps[i].y + ps[i + 1].y) / 2 };
    d += `Q${r1(ps[i].x)},${r1(ps[i].y)} ${r1(m.x)},${r1(m.y)}`;
  }
  const z = ps[ps.length - 1];
  return d + `L${r1(z.x)},${r1(z.y)}`;
}

/**
 * The outline of a pen stroke whose width follows the pressure, to fill: each side offset
 * along the normal by its radius there, round at both ends.
 */
export function penOutline(pts: number[], width: number): string {
  const ps = pairs(pts);
  const n = ps.length;
  if (!n) return '';
  // radius from pressure (a light touch still shows), smoothed so it doesn't flicker
  let rs = Array.from({ length: n }, (_, i) => (width / 2) * (0.35 + 0.9 * Math.min(1, pts[i * 3 + 2] || 0.5)));
  rs = rs.map((r, i) => (rs[Math.max(0, i - 1)] + 2 * r + rs[Math.min(n - 1, i + 1)]) / 4);
  if (n === 1) {
    const { x, y } = ps[0], r = rs[0];
    return `M${r1(x - r)},${r1(y)}a${r1(r)},${r1(r)} 0 1,0 ${r1(2 * r)},0a${r1(r)},${r1(r)} 0 1,0 ${r1(-2 * r)},0Z`;
  }
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ps[Math.max(0, i - 1)], b = ps[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    (tx /= l), (ty /= l);
    left.push({ x: ps[i].x - ty * rs[i], y: ps[i].y + tx * rs[i] });
    right.push({ x: ps[i].x + ty * rs[i], y: ps[i].y - tx * rs[i] });
  }
  const side = (qs: Pt[]) => {
    let d = '';
    for (let i = 1; i < qs.length - 1; i++) d += `Q${r1(qs[i].x)},${r1(qs[i].y)} ${r1((qs[i].x + qs[i + 1].x) / 2)},${r1((qs[i].y + qs[i + 1].y) / 2)}`;
    return d + `L${r1(qs[qs.length - 1].x)},${r1(qs[qs.length - 1].y)}`;
  };
  const back = right.reverse();
  const re = rs[n - 1], rb = rs[0];
  return (
    `M${r1(left[0].x)},${r1(left[0].y)}` +
    side(left) +
    `A${r1(re)},${r1(re)} 0 0,0 ${r1(back[0].x)},${r1(back[0].y)}` +
    side(back) +
    `A${r1(rb)},${r1(rb)} 0 0,0 ${r1(left[0].x)},${r1(left[0].y)}Z`
  );
}

/** A diamond's outline. */
export const diamondPath = (b: Box) => `M${r1(b.x + b.w / 2)},${r1(b.y)}L${r1(b.x + b.w)},${r1(b.y + b.h / 2)}L${r1(b.x + b.w / 2)},${r1(b.y + b.h)}L${r1(b.x)},${r1(b.y + b.h / 2)}Z`;
