// Notes on drawings never sit on the text, on each other, or under an arrow's tip: checked
// on the welcome note (which has every kind of drawing) in each theme, at two widths, and
// laid out for paper.
import { test, expect, open, ed } from './helpers';
import type { Page } from '@playwright/test';

type Hit = { what: string; a: string; b: string; area: number };

/** Everything that overlaps, as found on the page now. */
function collisions(page: Page): Promise<Hit[]> {
  return page.evaluate(() => {
    const nx = (window as any).__nx;
    const e = nx.ed;
    type R = { x: number; y: number; w: number; h: number };
    const R = (r: DOMRect): R => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const overlap = (a: R, b: R) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const shrink = (r: R, d: number): R => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
    const labels = [...document.querySelectorAll<HTMLElement>('.dlabel')]
      .filter((l) => l.offsetParent && l.textContent?.trim())
      .map((l) => ({ text: l.textContent!.trim(), r: shrink(R(l.getBoundingClientRect()), 1) }));
    // the text's ink: each character, and each formula's glyphs (not its box's padding)
    const ink = [
      ...[...document.querySelectorAll<HTMLElement>('.page .block .ch')]
        .filter((c) => c.offsetParent && c.textContent!.trim())
        .map((c) => {
          // a character's box, trimmed to its glyph height (the line's spacing is not ink)
          const r = R(c.getBoundingClientRect());
          const pad = r.h * 0.18;
          return { text: c.textContent!, r: { x: r.x, y: r.y + pad, w: r.w, h: r.h - 2 * pad } };
        }),
      ...[...document.querySelectorAll<HTMLElement>('.page .block .math .katex-html .base')].map((m) => ({ text: '$' + (m.textContent ?? '').slice(0, 12) + '$', r: R(m.getBoundingClientRect()) })),
    ];
    const hits: Hit[] = [];
    for (const l of labels) {
      for (const c of ink) {
        const a = overlap(l.r, c.r);
        if (a > 4) hits.push({ what: 'note on text', a: l.text, b: c.text, area: Math.round(a) });
      }
    }
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = overlap(labels[i].r, labels[j].r);
        if (a > 0) hits.push({ what: 'note on note', a: labels[i].text, b: labels[j].text, area: Math.round(a) });
      }
    const origin = e.page.getBoundingClientRect();
    for (const ar of e.doc.arrows) {
      const g = e.arrowGeos[ar.id];
      if (!g) continue;
      const tip = { x: g.p2.x + origin.left, y: g.p2.y + origin.top };
      for (const l of labels) {
        const r = shrink(l.r, -3);
        if (tip.x > r.x && tip.x < r.x + r.w && tip.y > r.y && tip.y < r.y + r.h) hits.push({ what: 'arrow tip on note', a: ar.label || 'arrow', b: l.text, area: 0 });
      }
      // the curve itself, through another drawing's note
      const path = document.querySelector<SVGPathElement>(`svg.arrows g.arrow[data-id="${ar.id}"] path:not(.hit):not(.leader):not(.box)`);
      const m = path?.getScreenCTM();
      if (!path || !m) continue;
      const len = path.getTotalLength();
      for (const l of labels) {
        if (l.text === ar.label) continue;
        for (let k = 0; k <= 40; k++) {
          const p = path.getPointAtLength((len * k) / 40);
          const x = m.a * p.x + m.c * p.y + m.e, y = m.b * p.x + m.d * p.y + m.f;
          if (x > l.r.x && x < l.r.x + l.r.w && y > l.r.y && y < l.r.y + l.r.h) {
            hits.push({ what: 'arrow through note', a: ar.label || 'arrow', b: l.text, area: 0 });
            break;
          }
        }
      }
    }
    return hits;
  });
}

/** Let the notes settle (they are placed over a few passes). */
async function settle(page: Page) {
  await page.evaluate(() => ((window as any).__nx.ed.cullScreens = Infinity));
  await page.evaluate(() => (window as any).__nx.ed.relayoutAll());
  await page.waitForTimeout(700);
}

for (const theme of ['midnight', 'paper', 'phosphor']) {
  for (const width of [1100, 760]) {
    test(`welcome note, ${theme}, ${width}px wide: notes clear of text and of each other`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.evaluate((theme) => (window as any).__nx.ed.updateConfig({ theme }), theme);
      await settle(page);
      expect(await page.locator('.dlabel:visible').count()).toBeGreaterThan(4);
      expect(await collisions(page)).toEqual([]);
    });
  }
  test(`welcome note laid out for paper in ${theme}: notes clear of text and of each other`, async ({ page }) => {
    await open(page);
    await page.evaluate((theme) => (window as any).__nx.ed.updateConfig({ pdf: { theme, paper: 'A4' } }), theme);
    await page.evaluate(() => (window as any).__nx.ed.beginPrint());
    expect(await collisions(page)).toEqual([]);
    await page.evaluate(() => (window as any).__nx.ed.endPrint());
  });
}

test('every drawing in the welcome note is drawn', async ({ page }) => {
  await open(page);
  await settle(page);
  const counts = await ed(page, (e) => ({ arrows: e.doc.arrows.length, marks: e.doc.marks.length, drawnArrows: Object.keys(e.arrowGeos).length, drawnMarks: Object.keys(e.markGeos).length }));
  expect(counts.drawnArrows).toBe(counts.arrows);
  expect(counts.drawnMarks).toBe(counts.marks);
  // every kind of shape is shown off
  const kinds = await ed(page, (e) => [...new Set(e.doc.marks.map((m: any) => m.kind))].sort());
  expect(kinds).toEqual(['box', 'brace', 'circle', 'highlight', 'strike', 'underline']);
  await expect(page.locator('.nx-err')).toHaveCount(0);
});

test('after a long paste, the caret is drawn where it is, once what was pasted is all drawn', async ({ page }) => {
  await open(page);
  // the whole welcome note copied, and pasted at its end
  const all = await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    e.selectAll();
    let t = '';
    e.copy({ clipboardData: { setData: (k: string, v: string) => void (k === 'text/plain' && (t = v)) }, preventDefault() {} }, false);
    return t;
  });
  expect(all.length).toBeGreaterThan(2000);
  await page.keyboard.press('Control+End');
  await page.evaluate((t) => (window as any).__nx.ed.paste({ clipboardData: { getData: (k: string) => (k === 'text/plain' ? t : ''), types: ['text/plain'], files: [] }, preventDefault() {} }), all);
  // (the caret glides to where it goes; then it's on the character before it)
  const off = () =>
    page.evaluate(() => {
      const e = (window as any).__nx.ed;
      const c = document.querySelector('.caret')!.getBoundingClientRect();
      const prev = e.doc.blocks[e.b].items[e.o - 1];
      const r = document.querySelector(`[data-nx="${prev.id}"]`)!.getBoundingClientRect();
      return Math.round(Math.abs(c.top - r.top) + Math.abs(c.left - r.right));
    });
  await expect.poll(off, { timeout: 3000 }).toBeLessThan(6);
});

test("notes moved by typing are placed properly once typing pauses, and then the page is left alone, however long measuring it takes", async ({ page }) => {
  await open(page);
  await settle(page);
  await ed(page, (e) => {
    const w = window as any;
    w.layouts = 0;
    const layout = e.layout.bind(e);
    e.layout = () => (w.layouts++, layout());
    // measuring the page before its notes are placed, as slow as in a long note (it once
    // used up the time for placing them, every time: they were never placed properly, and
    // the page was laid out again and again for good)
    const near = e.nearScreen.bind(e);
    e.nearScreen = (o: DOMRect) => {
      const t = performance.now();
      while (performance.now() - t < 15);
      return near(o);
    };
    // the caret at the start of a paragraph with notes on it
    const noted = new Set(e.doc.marks.filter((m: any) => m.label).flatMap((m: any) => m.at));
    e.b = e.doc.blocks.findIndex((b: any) => b.items.some((it: any) => noted.has(it.id)));
    e.o = 0;
    e.anchor = null;
    e.touch();
  });
  await page.keyboard.type('ab');
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => (window as any).layouts);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as any).layouts)).toBe(n);
});
