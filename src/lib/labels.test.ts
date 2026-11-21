import { describe, expect, it } from 'vitest';
import { layoutRow, renderLabel, type RowNote } from './labels';

// fake text metrics: 6px per char, 14px lines, words wrap at maxW
function note(id: string, x: number, text: string, edge = 20): RowNote {
  return {
    id,
    tip: { x, y: edge - 1 },
    edge,
    size: (maxW) => {
      if (maxW === Infinity) return { w: text.length * 6 + 6, h: 14 };
      const lines: number[] = [0];
      for (const w of text.split(' ')) {
        const add = (lines[lines.length - 1] ? 1 : 0) + w.length;
        if (lines[lines.length - 1] && (lines[lines.length - 1] + add) * 6 + 6 > maxW) lines.push(w.length);
        else lines[lines.length - 1] += add;
      }
      return { w: Math.max(...lines) * 6 + 6, h: lines.length * 14 };
    },
  };
}
const opts = { below: true, left: 0, right: 800 };
const centre = (p: { box: { x: number; w: number } }) => p.box.x + p.box.w / 2;

describe('layoutRow', () => {
  it('centres a lone note on its tip, without a leader', () => {
    const [p] = layoutRow([note('a', 300, 'the integrand')], opts);
    expect(centre(p)).toBe(300);
    expect(p.box.y).toBe(20);
    expect(p.leader).toBeNull();
  });

  it('puts nearby notes on a shared baseline below the deepest shape', () => {
    const ps = layoutRow([note('a', 100, 'over [0,1]', 30), note('b', 190, 'the integrand', 20)], opts);
    expect(ps[0].box.y).toBe(30);
    expect(ps[1].box.y).toBe(30);
  });

  it('lets notes far apart keep their own baseline', () => {
    const ps = layoutRow([note('a', 100, 'over [0,1]', 30), note('b', 400, 'the integrand', 20)], opts);
    expect(ps[0].box.y).toBe(30);
    expect(ps[1].box.y).toBe(20);
  });

  it('keeps order, never overlaps, and stays in the column', () => {
    const tips = [400, 420, 440, 460, 480, 500];
    const ps = layoutRow(tips.map((x, i) => note(`n${i}`, x, `term number ${i + 1}`)), opts);
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1].box, b = ps[i].box;
      const sameRow = Math.abs(a.y - b.y) < 1;
      if (sameRow) expect(a.x + a.w).toBeLessThanOrEqual(b.x);
    }
    for (const p of ps) expect(p.box.x).toBeGreaterThanOrEqual(0);
  });

  it('a crowded long note wraps or drops a row instead of pushing its neighbours away', () => {
    const ps = layoutRow([note('a', 300, 'n'), note('b', 330, 'this term is always positive'), note('c', 360, 'k')], opts);
    expect(centre(ps[0])).toBe(300);
    expect(centre(ps[2])).toBe(360);
    expect(ps[1].box.h > 14 || ps[1].box.y > ps[0].box.y).toBe(true);
  });

  it('keeps notes inside the column at the page edge', () => {
    const [p] = layoutRow([note('a', 60, 'a long note at the left edge of the page')], { ...opts, left: 32 });
    expect(p.box.x).toBeGreaterThanOrEqual(32);
    expect(p.leader).toBeNull(); // still under its word, so no leader
  });

  it('works above the shapes too', () => {
    const ps = layoutRow([note('a', 100, 'weight', 50), note('b', 120, 'value', 50)], { ...opts, below: false });
    for (const p of ps) expect(p.box.y + p.box.h).toBeLessThanOrEqual(50);
  });
});

describe('renderLabel caret', () => {
  const C = '<span class="lcaret"></span>';
  it('sits between characters without replacing any', () => {
    expect(renderLabel('abc', 1)).toBe(`a${C}bc`);
    expect(renderLabel('abc', 0)).toBe(`${C}abc`);
    expect(renderLabel('abc', 3)).toBe(`abc${C}`);
  });
  it('shows in an empty label', () => {
    expect(renderLabel('', 0)).toBe(C);
  });
  it('goes after a math part it is inside, once at a boundary', () => {
    const html = renderLabel('a $x+y$ b', 5);
    expect(html.split(C).length).toBe(2);
    expect(html.indexOf(C)).toBeGreaterThan(html.lastIndexOf('katex'));
    expect(renderLabel('a $x$', 2).indexOf(C)).toBe(2); // right before the math
    expect(renderLabel('a $x$', 5).endsWith(C)).toBe(true);
    for (let i = 0; i <= 'p $x$ q $y$'.length; i++) expect(renderLabel('p $x$ q $y$', i).split(C).length).toBe(2);
  });
});
