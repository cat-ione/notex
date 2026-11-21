import { describe, expect, it } from 'vitest';
import { besideNote, layoutRow, renderLabel, type RowNote } from './labels';

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
    expect(renderLabel('abc', { at: 1, anchor: null })).toBe(`a${C}bc`);
    expect(renderLabel('abc', { at: 0, anchor: null })).toBe(`${C}abc`);
    expect(renderLabel('abc', { at: 3, anchor: null })).toBe(`abc${C}`);
  });
  it('shows in an empty label', () => {
    expect(renderLabel('', { at: 0, anchor: null })).toBe(C);
  });
  it('goes after a math part it is inside, once at a boundary', () => {
    const html = renderLabel('a $x+y$ b', { at: 5, anchor: null });
    expect(html.split(C).length).toBe(2);
    expect(html.indexOf(C)).toBeGreaterThan(html.lastIndexOf('katex'));
    expect(renderLabel('a $x$', { at: 2, anchor: null }).indexOf(C)).toBe(2); // right before the math
    expect(renderLabel('a $x$', { at: 5, anchor: null }).endsWith(C)).toBe(true);
    for (let i = 0; i <= 'p $x$ q $y$'.length; i++) expect(renderLabel('p $x$ q $y$', { at: i, anchor: null }).split(C).length).toBe(2);
  });
  it('highlights the selection, a math part it touches as a whole', () => {
    expect(renderLabel('abcd', { at: 3, anchor: 1 })).toBe(`a<span class="lsel">bc</span>${C}d`);
    expect(renderLabel('abcd', { at: 1, anchor: 3 })).toBe(`a${C}<span class="lsel">bc</span>d`);
    const m = renderLabel('a $x$ b', { at: 3, anchor: 0 });
    expect(m.startsWith('<span class="lsel">a </span>')).toBe(true);
    expect(m).toMatch(/<span class="lsel"><span class="katex"/);
  });
});

describe('besideNote', () => {
  const shape = { x: 200, y: 100, w: 16, h: 20 }, size = { w: 60, h: 14 };
  const page = { left: 0, right: 800 };
  it('sits level with the shape, on the left when it is free', () => {
    const r = besideNote(shape, size, { ...page, obstacles: [] })!;
    expect(r.box.x + r.box.w).toBe(196);
    expect(r.box.y + r.box.h / 2).toBe(110);
    expect(r.leader).toBeNull();
  });
  it('slides past nearby ink, and takes the closer side', () => {
    const wall = { x: 218, y: 90, w: 300, h: 40 };
    const left = besideNote(shape, size, { ...page, obstacles: [{ x: 190, y: 90, w: 4, h: 40 }, wall] })!;
    expect(left.box.x + left.box.w).toBeLessThanOrEqual(188);
    // further out, its leader would cut through the ink
    expect(besideNote(shape, size, { ...page, obstacles: [{ x: 184, y: 90, w: 6, h: 40 }, wall] })).toBeNull();
    const right = besideNote(shape, size, { ...page, obstacles: [{ x: 100, y: 90, w: 98, h: 40 }] })!;
    expect(right.box.x).toBe(220);
  });
  it('gives up when both sides are blocked or off the page', () => {
    expect(besideNote(shape, size, { ...page, obstacles: [{ x: 100, y: 90, w: 98, h: 40 }, { x: 218, y: 90, w: 98, h: 40 }] })).toBeNull();
    expect(besideNote(shape, size, { left: 180, right: 240, obstacles: [] })).toBeNull();
  });
});
