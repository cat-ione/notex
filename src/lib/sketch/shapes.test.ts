import { describe, expect, it } from 'vitest';
import {
  attachTarget, boundsOf, bounds, boxOf, boxShape, cloneShapes, detach, erased, hits, inkShape, lineEnds, lineShape, lookupIn,
  moved, outlinePoint, penOutline, scaled, shapeAt, shapesIn, simplify, smoothPath, type BoxShape, type LineShape,
} from './shapes';

const rect = (x: number, y: number, w = 100, h = 50, k: BoxShape['k'] = 'rect') => boxShape(k, { x, y, w, h });

describe('boxes', () => {
  it('a box dragged up and left is turned round', () => {
    expect(boxOf({ x: 50, y: 40 }, { x: 10, y: 0 })).toEqual({ x: 10, y: 0, w: 40, h: 40 });
  });
  it('the outline point of a rectangle faces the target', () => {
    const r = rect(0, 0, 100, 50);
    expect(outlinePoint(r, { x: 500, y: 25 }, 0)).toEqual({ x: 100, y: 25 });
    expect(outlinePoint(r, { x: 50, y: -100 }, 0)).toEqual({ x: 50, y: 0 });
  });
  it('an ellipse and a diamond meet the ray on their own outline', () => {
    const e = rect(0, 0, 100, 50, 'ellipse');
    const p = outlinePoint(e, { x: 50, y: 500 }, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
    const d = rect(0, 0, 100, 100, 'diamond');
    const q = outlinePoint(d, { x: 100, y: 100 }, 0);
    expect(q.x).toBeCloseTo(75);
    expect(q.y).toBeCloseTo(75);
  });
});

describe('attached lines', () => {
  const A = rect(0, 0), B = rect(300, 0);
  const l = lineShape({ x: 0, y: 0, to: A.id }, { x: 0, y: 0, to: B.id }, 'end');
  const find = lookupIn([A, B, l]);
  it('run between the outlines of the shapes they join', () => {
    const [a, b] = lineEnds(l, find);
    expect(a.x).toBeCloseTo(103);
    expect(a.y).toBeCloseTo(25);
    expect(b.x).toBeCloseTo(297);
  });
  it('follow a shape that moves', () => {
    const B2 = moved(B, 0, 200);
    const [, b] = lineEnds(l, lookupIn([A, B2, l]));
    expect(b.y).toBeLessThan(200);
    expect(b.y).toBeGreaterThan(190);
  });
  it('one end free: the other faces it', () => {
    const half = lineShape({ x: 0, y: 0, to: A.id }, { x: 50, y: 300 }, 'end');
    const [a] = lineEnds(half, lookupIn([A, half]));
    expect(a.y).toBeCloseTo(53);
  });
  it('let go of a deleted shape where they were drawn', () => {
    const [out] = detach([l], new Set([B.id]), find) as LineShape[];
    expect(out.b.to).toBeUndefined();
    expect(out.b.x).toBeCloseTo(297);
    expect(out.a.to).toBe(A.id);
  });
  it('copied together, stay together; copied alone, let go', () => {
    const [a2, b2, l2] = cloneShapes([A, B, l]);
    expect((l2 as LineShape).a.to).toBe(a2.id);
    expect((l2 as LineShape).b.to).toBe(b2.id);
    expect(a2.id).not.toBe(A.id);
    const [lone] = cloneShapes([l]);
    expect((lone as LineShape).a.to).toBeUndefined();
  });
  it('an end dropped on a box attaches to it, not to a line', () => {
    expect(attachTarget([A, B, l], { x: 320, y: 20 }, 4)?.id).toBe(B.id);
    expect(attachTarget([A, B, l], { x: 200, y: 25 }, 4)).toBeNull();
  });
});

describe('hitting', () => {
  const ink = inkShape([0, 0, 0.5, 50, 0, 0.5, 100, 0, 0.5], false);
  it('a stroke near its path, not beside it', () => {
    expect(hits(ink, { x: 60, y: 3 }, 4)).toBe(true);
    expect(hits(ink, { x: 60, y: 20 }, 4)).toBe(false);
  });
  it('a box anywhere inside, and just outside its outline', () => {
    const r = rect(0, 0);
    expect(hits(r, { x: 50, y: 25 }, 4)).toBe(true);
    expect(hits(r, { x: 103, y: 25 }, 4)).toBe(true);
    expect(hits(r, { x: 120, y: 25 }, 4)).toBe(false);
  });
  it('an ellipse not in its corners', () => {
    expect(hits(rect(0, 0, 100, 100, 'ellipse'), { x: 3, y: 3 }, 2)).toBe(false);
  });
  it('the topmost shape wins', () => {
    const a = rect(0, 0), b = rect(20, 10);
    expect(shapeAt([a, b], { x: 30, y: 20 }, 2)?.id).toBe(b.id);
  });
  it('a selection rectangle takes what lies wholly inside it', () => {
    const a = rect(0, 0, 10, 10), b = rect(50, 50, 100, 100);
    expect(shapesIn([a, b], { x: -5, y: -5, w: 60, h: 60 }).map((s) => s.id)).toEqual([a.id]);
  });
  it('the eraser takes strokes it crosses, and boxes by their outline', () => {
    const r = rect(200, 0, 100, 100);
    expect(erased([ink, r], { x: 50, y: -10 }, { x: 50, y: 10 }, 3).map((s) => s.id)).toEqual([ink.id]);
    // through the middle of an empty box: not erased; across its edge: erased
    expect(erased([r], { x: 240, y: 40 }, { x: 260, y: 60 }, 3)).toEqual([]);
    expect(erased([r], { x: 190, y: 50 }, { x: 210, y: 50 }, 3)).toHaveLength(1);
  });
});

describe('moving and resizing', () => {
  it('moves every kind', () => {
    const ink = inkShape([0, 0, 0.3, 10, 10, 0.9], true);
    expect(moved(ink, 5, -5).pts).toEqual([5, -5, 0.3, 15, 5, 0.9]);
    expect(moved(rect(0, 0), 3, 4)).toMatchObject({ x: 3, y: 4 });
  });
  it('scales a selection into a new box', () => {
    const r = rect(10, 10, 10, 10);
    expect(scaled(r, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 50 })).toMatchObject({ x: 20, y: 5, w: 20, h: 5 });
  });
  it('bounds of a group', () => {
    expect(boundsOf([rect(0, 0, 10, 10), rect(50, 20, 10, 10)])).toEqual({ x: 0, y: 0, w: 60, h: 30 });
    expect(bounds(lineShape({ x: 5, y: 5 }, { x: 1, y: 9 }, 'none'))).toEqual({ x: 1, y: 5, w: 4, h: 4 });
  });
});

describe('strokes', () => {
  it('simplify keeps the ends and the corners, drops points on a straight run', () => {
    const pts = [0, 0, 0.5, 1, 0, 0.5, 2, 0, 0.5, 3, 0, 0.5, 3, 3, 0.5];
    expect(simplify(pts)).toEqual([0, 0, 0.5, 3, 0, 0.5, 3, 3, 0.5]);
  });
  it('simplify keeps a change of pressure', () => {
    const pts = [0, 0, 0.1, 1, 0, 0.9, 2, 0, 0.1];
    expect(simplify(pts)).toHaveLength(9);
  });
  it('paths for one, two and many points', () => {
    expect(smoothPath([{ x: 1, y: 1 }])).toMatch(/^M1,1/);
    expect(smoothPath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe('M0,0L5,5');
    expect(smoothPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])).toContain('Q5,5');
  });
  it('a pen outline is a closed shape, a dot a circle', () => {
    expect(penOutline([0, 0, 0.5, 10, 0, 1, 20, 5, 0.2], 3)).toMatch(/^M.*Z$/);
    expect(penOutline([5, 5, 1], 4)).toMatch(/a.*a.*Z$/);
  });
});
