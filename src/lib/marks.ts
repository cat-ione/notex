// Geometry for marks: shapes drawn around / under a run of text or math.
//
// Every mark is a single SVG path so it can be "drawn in" with the same
// stroke animation as arrows.

import { union, type Rect } from './geom';
import type { MarkKind } from './model';

export const MARK_KINDS: MarkKind[] = ['box', 'circle', 'underline', 'highlight', 'brace', 'strike'];

export type MarkGeo = {
  d: string;
  filled: boolean;
  label: { x: number; y: number; below: boolean };
  /** For enclosing shapes, the outline arrows should touch. */
  outline?: { r: Rect; round: boolean };
  /** Extent of the drawn ink (without the label). */
  bounds: Rect;
  /** A line from the shape to its note, when the note had to move away (set by layout). */
  leader?: string;
};

const f = (n: number) => Math.round(n * 10) / 10;

/** Geometry for a mark over `lines` (one rect per visual line the target spans). */
export function markGeo(kind: MarkKind, lines: Rect[]): MarkGeo | null {
  if (!lines.length) return null;
  if (kind === 'underline' || kind === 'strike' || kind === 'highlight') {
    // Line-based marks follow the text across line wraps.
    const parts = lines.map((r) => shape(kind, r));
    return { d: parts.map((p) => p.d).join(' '), filled: parts[0].filled, label: parts[parts.length - 1].label, bounds: union(parts.map((p) => p.bounds))! };
  }
  return shape(kind, union(lines)!);
}

function shape(kind: MarkKind, r: Rect): MarkGeo {
  const g = path(kind, r);
  const bounds =
    g.outline?.r ??
    (kind === 'underline' ? { x: r.x, y: r.y + r.h + 1, w: r.w, h: 2 }
      : kind === 'brace' ? { x: r.x, y: r.y + r.h + 3, w: r.w, h: Math.min(8, Math.max(5, r.w / 10)) }
      : r);
  return { ...g, bounds };
}

function path(kind: MarkKind, r: Rect): Omit<MarkGeo, 'bounds'> {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const below = { x: cx, y: r.y + r.h + 16, below: true };
  const above = { x: cx, y: r.y - 8, below: false };
  switch (kind) {
    case 'box': {
      const p = 3, x = r.x - p, y = r.y - p, w = r.w + 2 * p, h = r.h + 2 * p, c = 4;
      return {
        d: `M${f(x + c)},${f(y)} H${f(x + w - c)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + c)} V${f(y + h - c)} Q${f(x + w)},${f(y + h)} ${f(x + w - c)},${f(y + h)} H${f(x + c)} Q${f(x)},${f(y + h)} ${f(x)},${f(y + h - c)} V${f(y + c)} Q${f(x)},${f(y)} ${f(x + c)},${f(y)} Z`,
        filled: false,
        label: { ...above, y: y - 6 },
        outline: { r: { x, y, w, h }, round: false },
      };
    }
    case 'circle': {
      // Smallest-ish ellipse through the padded rect's corners.
      const hw = r.w / 2 + 2, hh = r.h / 2 + 2;
      const rx = hw + Math.max(6, Math.min(16, hw * 0.25));
      const ry = hh / Math.sqrt(1 - (hw * hw) / (rx * rx));
      return {
        d: `M${f(cx - rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 1 ${f(cx + rx)},${f(cy)} A${f(rx)},${f(ry)} 0 1 1 ${f(cx - rx)},${f(cy)}`,
        filled: false,
        label: { ...above, y: cy - ry - 6 },
        outline: { r: { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry }, round: true },
      };
    }
    case 'underline': {
      const y = r.y + r.h + 2;
      return { d: `M${f(r.x)},${f(y)} H${f(r.x + r.w)}`, filled: false, label: { ...below, y: y + 14 } };
    }
    case 'strike':
      return { d: `M${f(r.x - 2)},${f(cy)} H${f(r.x + r.w + 2)}`, filled: false, label: above };
    case 'highlight': {
      const x = r.x - 2, y = r.y, w = r.w + 4, h = r.h;
      return { d: `M${f(x)},${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`, filled: true, label: above };
    }
    case 'brace': {
      // Horizontal curly brace under the target, tip pointing down.
      const y = r.y + r.h + 3, d = Math.min(8, Math.max(5, r.w / 10)), x0 = r.x, x1 = r.x + r.w, m = cx;
      return {
        d: `M${f(x0)},${f(y)} Q${f(x0)},${f(y + d / 2)} ${f(x0 + d)},${f(y + d / 2)} H${f(m - d)} Q${f(m)},${f(y + d / 2)} ${f(m)},${f(y + d)} Q${f(m)},${f(y + d / 2)} ${f(m + d)},${f(y + d / 2)} H${f(x1 - d)} Q${f(x1)},${f(y + d / 2)} ${f(x1)},${f(y)}`,
        filled: false,
        label: { ...below, y: y + d + 13 },
      };
    }
  }
}

/** Colours a drawing can take; '' is the theme's arrow colour. */
export const INKS = ['', 'red', 'green', 'blue', 'purple'] as const;
export type Ink = (typeof INKS)[number];
export const inkVar = (c: string | undefined) => (c ? `var(--ink-${c})` : 'var(--arrow)');

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Find a spot for a note box that doesn't cover any obstacle: first slide it
 * sideways (at most `maxDx`, so it stays attached to its shape), then move it
 * away from the shape (`dir` 1 = down, -1 = up) a step at a time and slide again.
 * Returns the box's offset, or none if nothing nearby is free.
 */
export function placeLabel(box: Rect, dir: 1 | -1, obstacles: Rect[], maxDx: number, gap = 2): { dx: number; dy: number } {
  const step = 4;
  const dxs = [0];
  for (let d = step; d <= maxDx; d += step) dxs.push(d, -d);
  for (let n = 0; n <= 8; n++) {
    const dy = dir * n * 5;
    for (const dx of dxs) {
      const r = { x: box.x + dx - gap, y: box.y + dy - gap, w: box.w + 2 * gap, h: box.h + 2 * gap };
      if (!obstacles.some((o) => overlaps(o, r))) return { dx, dy };
    }
  }
  return { dx: 0, dy: 0 };
}

/**
 * Spread boxes along a row so they don't overlap, keeping each as close to its
 * wanted centre as possible: overlapping boxes merge into a cluster centred on
 * the average of what its members want (the classic label-spreading method).
 * Returns the new centres and the clusters (indices) that ended up touching.
 */
export function spread(items: { x: number; w: number }[], gap = 8): { x: number[]; groups: number[][] } {
  type C = { idx: number[]; start: number; width: number };
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  const place = (idx: number[]): C => {
    let off = 0, sum = 0;
    for (const i of idx) {
      sum += items[i].x - (off + items[i].w / 2);
      off += items[i].w + gap;
    }
    return { idx, start: sum / idx.length, width: off - gap };
  };
  const cs: C[] = [];
  for (const i of order) {
    cs.push(place([i]));
    while (cs.length > 1) {
      const [a, b] = cs.slice(-2);
      if (a.start + a.width + gap <= b.start) break;
      cs.splice(-2, 2, place([...a.idx, ...b.idx]));
    }
  }
  const x = new Array<number>(items.length);
  for (const c of cs) {
    let off = c.start;
    for (const i of c.idx) {
      x[i] = off + items[i].w / 2;
      off += items[i].w + gap;
    }
  }
  return { x, groups: cs.map((c) => c.idx) };
}
