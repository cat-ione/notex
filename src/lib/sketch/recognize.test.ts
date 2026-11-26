import { describe, expect, it } from 'vitest';
import { recognize } from './recognize';

/** Points along a path, a little shaky, with a pressure. */
const path = (f: (t: number) => [number, number], n = 60, shake = 1.5) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const [x, y] = f(i / n);
    const j = Math.sin(i * 7.3) * shake;
    return [x + j, y - j, 0.5];
  }).flat();

/** Along the corners of a polygon, in order (back to the first). */
const poly = (ps: [number, number][], n = 80) =>
  path((t) => {
    const k = ps.length, s = t * k, i = Math.min(k - 1, Math.floor(s)), u = s - i;
    const [x0, y0] = ps[i], [x1, y1] = ps[(i + 1) % k];
    return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
  }, n);

describe('recognizing a rough stroke', () => {
  it('a nearly straight one is a line, end to end', () => {
    const r = recognize(path((t) => [10 + 200 * t, 50 + 30 * t]));
    expect(r?.k).toBe('line');
    if (r?.k === 'line') expect(Math.round(r.b.x)).toBeGreaterThan(200);
  });
  it('round and closed: an ellipse in its box', () => {
    const r = recognize(path((t) => [100 + 80 * Math.cos(t * 2 * Math.PI), 60 + 40 * Math.sin(t * 2 * Math.PI)]));
    expect(r?.k).toBe('ellipse');
    if (r && r.k !== 'line') {
      expect(r.box.w).toBeGreaterThan(150);
      expect(r.box.h).toBeGreaterThan(75);
    }
  });
  it('four corners at the corners of its box: a box', () => {
    expect(recognize(poly([[0, 0], [160, 0], [160, 90], [0, 90]]))?.k).toBe('rect');
  });
  it('four corners at the middles of its sides: a diamond', () => {
    expect(recognize(poly([[80, 0], [160, 60], [80, 120], [0, 60]]))?.k).toBe('diamond');
  });
  it('a scribble, a curve or a tiny stroke is nothing', () => {
    expect(recognize(path((t) => [t * 100, Math.sin(t * 12) * 40]))).toBeNull();
    expect(recognize(path((t) => [100 * t, 100 * t * t]))).toBeNull();
    expect(recognize([0, 0, 0.5, 2, 2, 0.5, 3, 1, 0.5])).toBeNull();
  });
});
