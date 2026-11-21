import { describe, expect, it } from 'vitest';
import { arrowGeo, attachAt, nextSide, sideName } from './arrows';

describe('where an arrow end attaches', () => {
  const box = { x: 100, y: 100, w: 40, h: 20 };
  it('snaps a drop point onto the nearest side, and the middle means automatic', () => {
    expect(attachAt(box, { x: 120, y: 102 })).toEqual({ x: 0.5, y: 0 });
    expect(attachAt(box, { x: 139, y: 110 })).toEqual({ x: 1, y: 0.5 });
    expect(attachAt(box, { x: 104, y: 119 })).toEqual({ x: 0.1, y: 1 });
    expect(attachAt(box, { x: 120, y: 110 })).toBeUndefined();
    // outside the box: clamped onto it
    expect(attachAt(box, { x: 90, y: 110 })).toEqual({ x: 0, y: 0.5 });
  });
  it('cycles automatic → top → right → bottom → left → automatic', () => {
    const seen: string[] = [];
    let at = undefined as ReturnType<typeof nextSide>;
    for (let k = 0; k < 5; k++) seen.push(sideName((at = nextSide(at))));
    expect(seen).toEqual(['top', 'right', 'bottom', 'left', 'auto']);
  });
  it('starts the curve at the chosen point', () => {
    const a = { x: 0, y: 0, w: 20, h: 20 }, b = { x: 200, y: 0, w: 20, h: 20 };
    const g = arrowGeo(a, b, 0, {}, { to: { x: 0.5, y: 0 } })!;
    // the tip on the top edge of b (padded by 3), in its middle
    expect(g.p2.x).toBeCloseTo(210);
    expect(g.p2.y).toBeCloseTo(-3);
  });
});
