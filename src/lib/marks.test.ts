import { describe, expect, it } from 'vitest';
import { byLine } from './geom';
import { MARK_KINDS, markGeo, spread } from './marks';

const r = (x: number, y: number, w = 10, h = 16) => ({ x, y, w, h });

describe('byLine', () => {
  it('groups rects on the same visual line', () => {
    const lines = byLine([r(0, 0), r(12, 1), r(0, 30), r(24, 0, 10, 20)]);
    expect(lines).toEqual([{ x: 0, y: 0, w: 34, h: 20 }, { x: 0, y: 30, w: 10, h: 16 }]);
  });
});

describe('markGeo', () => {
  it('produces a path for every kind', () => {
    for (const k of MARK_KINDS) expect(markGeo(k, [r(10, 10, 50)])?.d).toMatch(/^M/);
  });

  it('line-based marks get one segment per line, shapes enclose everything', () => {
    const lines = [r(100, 0, 200), r(0, 30, 80)];
    expect(markGeo('underline', lines)!.d.match(/M/g)).toHaveLength(2);
    expect(markGeo('highlight', lines)!.d.match(/M/g)).toHaveLength(2);
    expect(markGeo('box', lines)!.d.match(/M/g)).toHaveLength(1);
  });

  it('a circle encloses the corners of its target', () => {
    const t = r(0, 0, 120, 20);
    const m = /A([\d.]+),([\d.]+)/.exec(markGeo('circle', [t])!.d)!;
    const [rx, ry] = [+m[1], +m[2]];
    expect((t.w / 2) ** 2 / rx ** 2 + (t.h / 2) ** 2 / ry ** 2).toBeLessThanOrEqual(1);
  });

  it('puts brace and underline notes below, others above', () => {
    expect(markGeo('brace', [r(0, 0, 50)])!.label.below).toBe(true);
    expect(markGeo('circle', [r(0, 0, 50)])!.label.below).toBe(false);
  });
});

describe('arrows to outlined targets', () => {
  it('end on the circle, not on the text inside it', async () => {
    const { arrowGeo } = await import('./arrows');
    const text = r(200, 0, 40, 16);
    const circle = markGeo('circle', [text])!.outline!;
    const g = arrowGeo(r(0, 0), text, 0, { to: circle })!;
    const end = g.d.split(' ').pop()!.split(',').map(Number);
    const plain = arrowGeo(r(0, 0), text, 0)!.d.split(' ').pop()!.split(',').map(Number);
    expect(end[0]).toBeLessThan(plain[0] - 4);
    // on the (padded) ellipse
    const o = { cx: circle.r.x + circle.r.w / 2, cy: circle.r.y + circle.r.h / 2, rx: circle.r.w / 2 + 2, ry: circle.r.h / 2 + 2 };
    expect(((end[0] - o.cx) / o.rx) ** 2 + ((end[1] - o.cy) / o.ry) ** 2).toBeCloseTo(1, 1);
  });
});

describe('spread', () => {
  it('leaves boxes that fit alone', () => {
    expect(spread([{ x: 0, w: 20 }, { x: 100, w: 20 }])).toEqual({ x: [0, 100], groups: [[0], [1]] });
  });

  it('pushes overlapping boxes apart around their average', () => {
    const { x, groups } = spread([{ x: 50, w: 60 }, { x: 60, w: 60 }], 8);
    expect(groups).toEqual([[0, 1]]);
    expect(x[1] - x[0]).toBe(68);
    expect((x[0] + x[1]) / 2).toBe(55);
  });

  it('keeps reading order and cascades merges', () => {
    const { x, groups } = spread([{ x: 30, w: 40 }, { x: 0, w: 40 }, { x: 60, w: 40 }], 0);
    expect(groups).toEqual([[1, 0, 2]]);
    expect(x[1]).toBeLessThan(x[0]);
    expect(x[0]).toBeLessThan(x[2]);
  });
});
