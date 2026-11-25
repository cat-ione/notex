// PDFs and printing: the note is laid out for paper first (its width, the PDF theme, page
// breaks that don't cut through a line or a formula), and put back afterwards.
import { test, expect, open, fresh, type, ed } from './helpers';
import type { Page } from '@playwright/test';

/** A long note: filler paragraphs, then the welcome note's drawings on later pages. */
async function longNote(page: Page) {
  await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    let n = 0;
    const line = (t: string) => ({ id: 'f' + n++, kind: 'p', items: [...t].map((ch) => ({ t: 'c', ch, id: 'fc' + n++ })) });
    const filler = Array.from({ length: 30 }, (_, i) => line(`Filler paragraph ${i + 1}: ordinary lecture text, long enough to wrap onto a second line on paper.`));
    e.doc.blocks.splice(1, 0, ...filler);
    e.touch();
  });
  await page.waitForTimeout(400);
}

/** Where every block lies in the paper layout, and the page height (CSS px). */
function blocksOnPaper(page: Page) {
  return page.evaluate(() => {
    const e = (window as any).__nx.ed;
    const paper = e.config.pdf.paper === 'Letter' ? { h: 11 } : { h: 11.69 };
    const height = (paper.h - 2 * 0.7) * 96;
    const pg = document.querySelector('.page')!;
    const top = pg.getBoundingClientRect().top;
    const blocks = [...pg.children].filter((x) => x.classList.contains('block')).map((b) => {
      const r = b.getBoundingClientRect();
      return { top: r.top - top, bottom: r.bottom - top, tall: r.height > height };
    });
    return { height, blocks };
  });
}

test('laid out for paper: the PDF theme and the paper width, then back as it was', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, w: document.querySelector('.page')!.getBoundingClientRect().width }));
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const during = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    w: document.querySelector('.page')!.getBoundingClientRect().width,
    printing: document.documentElement.classList.contains('nx-print'),
  }));
  expect(during).toEqual({ theme: 'paper', w: Math.floor((8.27 - 1.4) * 96), printing: true });
  await expect(page.locator('.veil')).toBeVisible();
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
  const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, w: document.querySelector('.page')!.getBoundingClientRect().width }));
  expect(after).toEqual(before);
  await expect(page.locator('.veil')).toHaveCount(0);
  await expect(page.locator('.nx-page-push')).toHaveCount(0);
});

test('Letter paper and another theme, from the settings', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__nx.ed.updateConfig({ pdf: { theme: 'midnight', paper: 'Letter' } }));
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const w = await page.evaluate(() => document.querySelector('.page')!.getBoundingClientRect().width);
  expect(w).toBe(Math.floor((8.5 - 1.4) * 96));
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('midnight');
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});

test('no line or formula is cut by a page break', async ({ page }) => {
  await open(page);
  await longNote(page);
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const { height, blocks } = await blocksOnPaper(page);
  const cut = blocks.filter((b) => !b.tall && Math.floor(b.top / height) !== Math.floor((b.bottom - 1) / height));
  expect(cut).toEqual([]);
  // and some did have to move to the next page
  expect(await page.locator('.nx-page-push').count()).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});

test('drawings stay on their words in the paper layout', async ({ page }) => {
  await open(page);
  await longNote(page);
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const off = await ed(page, (e) => {
    const origin = e.page.getBoundingClientRect();
    const out: string[] = [];
    for (const a of e.doc.arrows) {
      const g = e.arrowGeos[a.id];
      const els = a.to.map((id: string) => document.querySelector(`[data-nx="${id}"]`)!.getBoundingClientRect());
      const left = Math.min(...els.map((r: DOMRect) => r.left)) - origin.left;
      const top = Math.min(...els.map((r: DOMRect) => r.top)) - origin.top;
      if (Math.abs(g.to.x - left) > 5 || Math.abs(g.to.y - top) > 5) out.push(a.label || a.id);
    }
    return out;
  });
  expect(off).toEqual([]);
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});

test('a PDF comes out, several A4 pages long', async ({ page }) => {
  await open(page);
  await longNote(page);
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
  const s = pdf.toString('latin1');
  expect(s.startsWith('%PDF-')).toBe(true);
  const pages = s.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  expect(pages).toBeGreaterThanOrEqual(3);
  // A4: 595 × 842 points
  expect(s).toMatch(/\/MediaBox\s*\[\s*0 0 59[45]\.\d* 84[12]\.\d*\s*\]/);
});

test('ctrl+p prints the paper layout and puts the screen back after', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    (window as any).__printed = null;
    window.print = () => {
      (window as any).__printed = {
        theme: document.documentElement.dataset.theme,
        printing: document.documentElement.classList.contains('nx-print'),
      };
    };
  });
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toEqual({ theme: 'paper', printing: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('nx-print'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('midnight');
});

test('\\pdf in the browser goes through the print dialog', async ({ page }) => {
  await open(page);
  await fresh(page);
  await page.evaluate(() => {
    (window as any).__prints = 0;
    window.print = () => void (window as any).__prints++;
  });
  await type(page, '\\pdf');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(1);
});

test('the editing marks (caret, selection, markers) are not printed', async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'some **bold** text');
  await page.keyboard.press('Shift+Home');
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  await page.emulateMedia({ media: 'print' });
  for (const sel of ['.caret', '.selrect', '.ch.mk']) {
    const shown = await page.locator(sel).evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
    expect(shown, sel).toBe(0);
  }
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});
