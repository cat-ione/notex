import { describe, expect, it } from 'vitest';
import { besideNote, layoutRow, noteItems, noteTex, noteText, pinnedLeader, renderLabel, type RowNote } from './labels';
import type { Item } from './model';
import { setSubstitutions } from './math/edit';
import { SUB_GROUPS } from './math/defs';

// notes' math is typed with names (pi, int): every substitution group on
setSubstitutions(Object.fromEntries(SUB_GROUPS.map((g) => [g.id, true])));

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

describe('renderLabel', () => {
  // a prose part as drawn: tagged with where it starts in the text
  const w = (o: number, h: string) => `<span data-o="${o}">${h}</span>`;
  it('tags each part with its offsets, so a click maps back to the text', () => {
    const h = renderLabel('ab $x$ c');
    expect(h.startsWith(w(0, 'ab '))).toBe(true);
    expect(h).toContain('<span data-o="3" data-e="6">');
    expect(h.endsWith(w(6, ' c'))).toBe(true);
  });
  it('draws stars as bold / italic (tagged where their text starts)', () => {
    expect(renderLabel('a **b** *c*')).toBe(w(0, 'a ') + w(4, '<b>b</b>') + w(7, ' ') + w(9, '<i>c</i>'));
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

describe('pinnedLeader', () => {
  const shape = { x: 100, y: 100, w: 40, h: 20 };
  it('is absent when the note sits at its shape', () => {
    expect(pinnedLeader(shape, { x: 142, y: 100, w: 50, h: 14 })).toBeNull();
  });
  it('runs from the shape edge to the note edge, along the line between them', () => {
    const l = pinnedLeader(shape, { x: 200, y: 150, w: 40, h: 20 })!;
    expect(l[0]).toBeCloseTo(140); // leaves the shape's right side
    expect(l[2]).toBeCloseTo(200); // reaches the note's left side
    expect(l[1]).toBeGreaterThan(110);
    expect(l[3]).toBeLessThan(160);
  });
});

describe('math in notes', () => {
  it('is typed the way math is typed on the page', () => {
    const t = (src: string) => noteTex(src).replace(/\s+/g, '');
    expect(t('1/pi')).toBe('\\frac{1}{\\pi}');
    expect(t('x^2+1')).toBe('x^{2}+1');
    expect(t('int_0^(2pi) f')).toBe('\\int_{0}^{2\\pi}f');
    // written as LaTeX: as is
    expect(noteTex('\\frac{a}{b}')).toBe('\\frac{a}{b}');
  });
});

describe('a note typed as a paragraph', () => {
  const shape = (items: Item[]) => items.map((i) => (i.t === 'm' ? 'M' : i.b && i.i ? '#' : i.b ? 'B' : i.i ? 'I' : '.')).join('');
  it('comes from its text: formulas from $…$, bold / italic from stars', () => {
    const { items, index } = noteItems('a $x^2$ **bo** *it*');
    expect(shape(items)).toBe('..M.BB.II');
    // offsets in the text → offsets among the items (inside a formula: after it)
    expect(index(0)).toBe(0);
    expect(index(2)).toBe(2);
    expect(index(4)).toBe(3);
    expect(index(19)).toBe(9);
  });
  it('goes back to the same text', () => {
    for (const t of ['a $x^{2}$ **bo** *it*', 'plain', '***both*** and $\\frac{1}{2}$']) expect(noteText(noteItems(t).items)).toBe(t);
  });
  it('turns typed shorthand into LaTeX', () => {
    expect(noteText(noteItems('$1/pi$').items)).toBe('$\\frac{1}{\\pi }$');
  });
});
