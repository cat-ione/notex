import { describe, expect, it } from 'vitest';
import { compile, parsePlot, plotGeometry, ticks } from './plot';

describe('expressions in x', () => {
  it.each([
    ['x^2', 3, 9],
    ['2x + 1', 3, 7],
    ['x(x+1)', 3, 12],
    ['(x+1)(x-1)', 3, 8],
    ['-x^2', 3, -9],
    ['2^3^2', 0, 512],
    ['sin x', Math.PI / 2, 1],
    ['sin 2x', Math.PI / 4, 1],
    ['sin x cos x', Math.PI / 4, 0.5],
    ['sin^2 x + cos^2 x', 1.3, 1],
    ['2 sin(x)', Math.PI / 2, 2],
    ['e^x', 1, Math.E],
    ['exp(-x^2/2)', 0, 1],
    ['ln e', 0, 1],
    ['log 100', 0, 2],
    ['sqrt(x) + |x - 5|', 4, 3],
    ['2pi', 0, 2 * Math.PI],
    ['πx', 1, Math.PI],
    ['1/x', 4, 0.25],
    ['max(x, 2)', 1, 2],
    ['x²', 3, 9],
    ['1.5e2', 0, 150],
    ['2e', 0, 2 * Math.E],
    // as LaTeX writes it
    ['\\frac{1}{2} x^{2}', 2, 2],
    ['\\sqrt{x} \\cdot 3', 4, 6],
    ['\\sin\\left(x\\right)', Math.PI / 2, 1],
  ])('%s at %s is %s', (src, x, want) => {
    expect(compile(src)(x)).toBeCloseTo(want, 9);
  });
  it.each([['x +'], ['(x'], ['t^2'], ['x $ 2'], ['sin']])('%s: says what is wrong', (src) => {
    expect(() => compile(src)).toThrow();
  });
});

describe('a graph’s label', () => {
  it('functions one a line (y = and f(x) = or not), ranges for x and y', () => {
    const p = parsePlot('y = sin x\nf(x) = x^2\ncos x; x: -2pi..2pi\ny: -2..2');
    expect(p.fns.map((f) => f.src)).toEqual(['sin x', 'x^2', 'cos x']);
    expect(p.xr[0]).toBeCloseTo(-2 * Math.PI);
    expect(p.xr[1]).toBeCloseTo(2 * Math.PI);
    expect(p.yr).toEqual([-2, 2]);
    expect(p.piTicks).toBe(true);
  });
  it('a line that isn’t a function is kept with what’s wrong with it; the default range', () => {
    const p = parsePlot('y = x +\nx^2');
    expect(p.fns[0].f).toBeNull();
    expect(p.fns[0].err).toBeTruthy();
    expect(p.fns[1].f!(2)).toBe(4);
    expect(p.xr).toEqual([-5, 5]);
    expect(p.yr).toBeNull();
  });
});

describe('laying a graph out', () => {
  it('ticks at round steps, or in π', () => {
    expect(ticks(-5, 5, 5).map((t) => t.label)).toEqual(['−4', '−2', '0', '2', '4']);
    expect(ticks(0, 1, 4).map((t) => t.label)).toEqual(['0.0', '0.5', '1.0']);
    expect(ticks(0, 1, 6).map((t) => t.label)).toEqual(['0.0', '0.2', '0.4', '0.6', '0.8', '1.0']);
    expect(ticks(-Math.PI, Math.PI, 4, true).map((t) => t.label)).toEqual(['−π', '−π/2', '0', 'π/2', 'π']);
  });
  it('a curve in the box, the y range fitted to it, the axes where 0 is', () => {
    const g = plotGeometry(parsePlot('x^2\nx: -2..2'), { x: 0, y: 0, w: 212, h: 112 });
    expect(g.curves).toHaveLength(1);
    const pts = [...g.curves[0].d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(6, 0);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(206, 0);
    // the vertex near the bottom (0 is in the range), the ends near the top
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(95);
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(20);
    expect(g.axes[1].x1).toBeCloseTo(106, 0);
  });
  it('an asymptote breaks the curve rather than joining its two sides', () => {
    const g = plotGeometry(parsePlot('1/x\ny: -5..5'), { x: 0, y: 0, w: 200, h: 100 }, 201);
    expect(g.curves[0].d.match(/M/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('what is wrong is said', () => {
    expect(plotGeometry(parsePlot('y = 2 +'), { x: 0, y: 0, w: 100, h: 100 }).errors).toHaveLength(1);
  });
});

describe('a graph in LaTeX', () => {
  it('its axes, ticks and curves (each a plot through its points)', async () => {
    const { diagramTikz } = await import('./tikz');
    const { boxShape } = await import('./shapes');
    const s = boxShape('plot', { x: 0, y: 0, w: 200, h: 120 }, { label: 'y = sin x\ny = cos x\nx: -pi..pi' });
    const tex = diagramTikz([s], 200, (c) => c, (t) => t).join('\n');
    expect(tex.match(/plot coordinates/g)).toHaveLength(2);
    expect(tex).toContain(String.raw`{$-\pi$}`);
    expect(tex).toContain('draw[blue');
    expect(tex).toContain('draw[red');
  });
});
