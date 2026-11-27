// What's on the PDF's pages, read back from the file: the sheets drawn in the browser
// (src/lib/pdf.ts) checked against the paper layout they were drawn from, as the screen
// shows it (the text where it was, every drawing on its words, fills in their colours).
import { test, expect, open, fresh, type, ed } from './helpers';
import { readPdf, sample, paperPicture, differences, type PdfPage } from './pdfread';
import type { Page } from '@playwright/test';

// (the PDF's pictures are 2.5 pixels to a CSS pixel: the screenshots too, to compare)
test.use({ deviceScaleFactor: 2.5 });

/** Make the PDF (the browser's way: a download) and read it back. */
async function makePdf(page: Page): Promise<PdfPage[]> {
  await page.evaluate(() => {
    delete (Window.prototype as any).showSaveFilePicker;
    delete (window as any).showSaveFilePicker;
    const make = URL.createObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => (((window as any).__blob = b), make(b));
  });
  await page.evaluate(() => (window as any).__nx.ed.paper.exportPdf());
  return readPdf(page);
}

/** The paper: its size (inches), and its text's height (CSS px), as the PDF is made. */
const paper = (page: Page) =>
  ed(page, (e) => {
    const [w, h] = e.config.pdf.paper === 'Letter' ? [8.5, 11] : [8.27, 11.69];
    return { w, h, text: (h - 1.4) * 96 };
  });

/** Every sheet of the PDF is the screen's paper layout, that part of it. */
async function matchesScreen(page: Page, pages: PdfPage[]) {
  const { text } = await paper(page);
  for (let i = 0; i < pages.length; i++) {
    const d = await differences(page, i, text);
    const ink = d.ink.flatMap((v, k) => (v > 0.03 ? [`${k * 10}px: ${(v * 100).toFixed(0)}% of the ink`] : []));
    const tone = d.tone.flatMap((v, k) => (v > 60 ? [`${k * 10}px: colour off by ${Math.round(v)}`] : []));
    expect([...ink, ...tone], `sheet ${i + 1}`).toEqual([]);
  }
}

/** Where the note's last block ends in the paper layout (CSS px). */
const extent = (page: Page) =>
  ed(page, (e) => {
    e.paper.beginPrint();
    const pg = e.page as HTMLElement, top = pg.getBoundingClientRect().top;
    const bottom = Math.max(...[...pg.querySelectorAll('.block')].map((b) => b.getBoundingClientRect().bottom - top));
    e.paper.endPrint();
    return bottom;
  });

/**
 * The welcome note pushed down by paragraphs (so its drawings land on later sheets, past the
 * first few drawn together), each with a highlight on a phrase, and a picture among them.
 */
async function longNote(page: Page) {
  await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    let n = 0;
    const colours = ['yellow', 'green', 'blue', 'red'];
    const filler = Array.from({ length: 24 }, (_, i) => {
      const t = `Paragraph ${i + 1}: ordinary lecture text, with one phrase highlighted, long enough to wrap onto another line.`;
      const items = [...t].map((ch) => ({ t: 'c', ch, id: `pc${n++}` }));
      const at = t.indexOf('one phrase');
      e.doc.marks.push({ id: `pm${i}`, kind: 'highlight', at: items.slice(at, at + 10).map((c) => c.id), dash: false, label: '', color: colours[i % 4] });
      return { id: `pb${i}`, kind: 'p', items };
    });
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 90;
    const g = c.getContext('2d')!;
    ['#d33', '#3a3', '#33d'].forEach((col, k) => ((g.fillStyle = col), g.fillRect(k * 80, 0, 80, 90)));
    const img = { id: 'pimg', kind: 'img', src: c.toDataURL(), w: 240, items: [...'a picture'].map((ch) => ({ t: 'c', ch, id: `pc${n++}` })) };
    e.doc.blocks.splice(1, 0, ...filler.slice(0, 12), img, ...filler.slice(12));
    e.touch();
  });
  await page.waitForTimeout(500);
}

test('the welcome note: every sheet as the screen shows it for paper, on A4 pages, inside the margins', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const { w, h, text } = await paper(page);
  const bottom = await extent(page);
  await paperPicture(page);
  const pages = await makePdf(page);
  // a page for each sheet's worth, and no more
  expect(pages.length).toBe(Math.ceil(bottom / text));
  for (const p of pages) {
    expect(p.box.map(Math.round)).toEqual([0, 0, Math.round(w * 72), Math.round(h * 72)]);
    // the picture in the margins (0.7in): the text's width and height, at 2.5 pixels a CSS pixel
    expect(p.at.map((v) => Math.round(v * 10) / 10)).toEqual([50.4, 50.4, Math.round((w - 1.4) * 720) / 10, Math.round((h - 1.4) * 720) / 10]);
    expect([p.w, p.h]).toEqual([Math.round(Math.floor((w - 1.4) * 96) * 2.5), Math.round(text * 2.5)]);
  }
  await matchesScreen(page, pages);
});

test('a long note in another theme, on Letter, zoomed and scrolled: every drawing on its words, every sheet as on screen', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await longNote(page);
  await page.evaluate(() => (window as any).__nx.ed.updateConfig({ pdf: { theme: 'midnight', paper: 'Letter' } }));
  // (how the note is looked at isn't what's printed)
  await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    e.setZoom(1.5);
    e.page.parentElement.scrollTop = 3000;
  });
  await page.waitForTimeout(300);
  const { w, text } = await paper(page);
  const bottom = await extent(page);
  await paperPicture(page);
  const pages = await makePdf(page);
  expect(pages.length).toBe(Math.ceil(bottom / text));
  expect(pages.length).toBeGreaterThan(5);
  expect(pages.every((p) => Math.round(p.box[2]) === Math.round(w * 72))).toBe(true);
  // the theme's dark background, the margins the colour of the picture's
  for (let i = 0; i < pages.length; i++) {
    const { bg } = await sample(page, i, { x: 0, y: 0, w: 1, h: 1 });
    expect(bg[0] + bg[1] + bg[2], 'a dark sheet').toBeLessThan(200);
    expect(pages[i].fill!.map((v, k) => Math.abs(v - bg[k]) <= 2), `sheet ${i + 1}: margins ${pages[i].fill}, picture ${bg}`).toEqual([true, true, true]);
  }
  await matchesScreen(page, pages);
  // and the screen as it was
  expect(await ed(page, (e) => e.zoom)).toBe(1.5);
});

test('no sheet is empty but the only one of an empty note', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const { text } = await paper(page);
  const pages = await makePdf(page);
  for (let i = 0; i < pages.length; i++) expect((await sample(page, i, { x: 0, y: 0, w: 2000, h: text })).ink, `sheet ${i + 1}`).toBeGreaterThan(0.002);
  await fresh(page);
  const empty = await makePdf(page);
  expect(empty).toHaveLength(1);
  expect((await sample(page, 0, { x: 0, y: 0, w: 2000, h: text })).ink).toBe(0);
});

test('made twice, the same PDF: nothing laid out afresh in between moves a note or a line', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await fresh(page);
  await type(page, 'Euler: ');
  await type(page, '$$e^(i pi) + 1 = 0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await type(page, 'and some text after it, to see that it stays where it was.');
  // a note on a drawing round the formula: placed with room made for it
  await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    const m = e.doc.blocks.flatMap((b: any) => b.items).find((i: any) => i.t === 'm');
    e.doc.marks.push({ id: 'twice', kind: 'box', at: [m.root[0].id], dash: false, label: 'a note above it', color: 'red' });
    e.touch();
  });
  await page.waitForTimeout(400);
  const first = await makePdf(page);
  // (the first PDF's sheet stands in for the screenshot)
  await page.evaluate(() => void ((window as any).__paper = (window as any).__sheets[0]));
  const second = await makePdf(page);
  expect(second).toHaveLength(first.length);
  const d = await differences(page, 0, (await paper(page)).text);
  expect(d.ink.every((v) => v === 0)).toBe(true);
  expect(Math.max(...d.tone)).toBeLessThan(10);
});

/** What the paper layout sets that the copy (pdf.ts) needn't: nothing a picture shows, or what another says. */
const NOT_SHOWN = [
  /^--/, // (the theme's variables: values have them filled in)
  /^(cursor|pointer-events|user-select|touch-action|caret-color|transition-.*|animation-.*|will-change)$/,
  /^contain-intrinsic-/, // (only with content-visibility)
  /^perspective-origin$/, // (only with perspective)
  /^(column-rule-color|row-rule-color|text-emphasis-color|-webkit-text-decorations-in-effect)$/, // (the text's colour, as it is anyway)
  /(-block|-inline)(-|$)|^inset-|^(block|inline)-size$|-(start|end)-(start|end)-radius$/, // (the physical ones say it)
  /^(text-decoration|font-variant)$/, // (shorthands of ones it has)
];

test('the copy for the PDF writes every property the paper layout uses to look as it does', async ({ page }) => {
  await open(page);
  const missing = await page.evaluate((notShown) => {
    const e = (window as any).__nx.ed;
    const has = new Set<string>((window as any).__nx.paperStyles);
    const skip = notShown.map((s) => new RegExp(s));
    e.paper.beginPrint();
    // a property is used where an element's value isn't a fresh element's of its kind (with no stylesheet)
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const fd = frame.contentDocument!;
    fd.open();
    fd.write('<!doctype html><html><body></body></html>');
    fd.close();
    const props = Array.from(getComputedStyle(document.documentElement)).filter((p) => !has.has(p) && !skip.some((r) => r.test(p)));
    const fresh = new Map<string, CSSStyleDeclaration>();
    const out = new Map<string, string>();
    for (const el of [e.page, ...e.page.querySelectorAll('*')] as Element[]) {
      // (an SVG's insides are written by inlineSvgStyles)
      if (el instanceof SVGElement && el.localName !== 'svg') continue;
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && ['', 'none', 'normal'].includes(cs.getPropertyValue('content'))) continue;
        const key = el.localName + (pseudo ?? '');
        if (!fresh.has(key)) {
          const f = fd.createElementNS(el.namespaceURI, el.localName);
          fd.body.appendChild(f);
          fresh.set(key, frame.contentWindow!.getComputedStyle(f, pseudo));
        }
        const base = fresh.get(key)!;
        for (const p of props) if (!out.has(p) && cs.getPropertyValue(p) !== base.getPropertyValue(p)) out.set(p, `${key}.${el.classList[0] ?? ''}: ${cs.getPropertyValue(p)}`);
      }
    }
    frame.remove();
    e.paper.endPrint();
    return [...out].map(([p, eg]) => `${p} (${eg})`);
  }, NOT_SHOWN.map((r) => r.source));
  expect(missing).toEqual([]);
});
