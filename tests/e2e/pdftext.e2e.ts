// The PDF's text, read back from the file: real text over the sheets' pictures (invisible, as
// a scanned page's recognised text is), so it can be selected, copied and searched, every
// character as itself; and its links, web addresses and references to what they refer to.
import { test, expect, open, fresh, type } from './helpers';
import { readPdfText } from './pdfread';
import type { Page } from '@playwright/test';

/** Make the PDF (the browser's way: a download) and read its text and links back. */
async function pdfText(page: Page) {
  await page.evaluate(() => {
    delete (Window.prototype as any).showSaveFilePicker;
    delete (window as any).showSaveFilePicker;
    const make = URL.createObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => (((window as any).__blob = b), make(b));
  });
  await page.evaluate(() => (window as any).__nx.ed.exportPdf());
  return readPdfText(page);
}

/** A first line with letters a keyboard here can't type (put in as they'd be pasted). */
const LINE = 'Café déjà vu, señor: α→β ≤ γ, ∑ and π. See https://example.com/a?b=1 for more.';

test('the text can be selected and copied: accents, Greek and symbols as themselves, a formula as its LaTeX', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await fresh(page);
  await page.evaluate((line) => {
    const e = (window as any).__nx.ed;
    let n = 0;
    e.doc.blocks[0].items = [...line].map((ch) => ({ t: 'c', ch, id: 'u' + n++ }));
    e.o = e.doc.blocks[0].items.length;
    e.touch();
  }, LINE);
  await page.keyboard.press('Enter');
  await type(page, 'Some **bold** words and $x^2$ inline.');
  const [first] = await pdfText(page);
  const all = first.text.map((t) => t.text).join('');
  expect(all).toContain(LINE.slice(0, 40));
  expect(all).toContain('∑ and π');
  expect(all).toContain('https://example.com/a?b=1');
  // (the markers that hide on the page aren't in the text either)
  expect(all).toContain('Some bold words and $x^{2}$ inline.');
  // invisible: the picture shows it
  expect(first.text.every((t) => t.invisible)).toBe(true);
  // where it is on the page: the first word at the margin (0.7in), on the first line
  const cafe = first.text.find((t) => t.text.startsWith('Café'))!;
  expect(cafe.x).toBeCloseTo(50.4, 0);
  expect(cafe.y).toBeGreaterThan(50.4);
  expect(cafe.y).toBeLessThan(50.4 + 20);
});

test('a web address is a link to it, over its words', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await fresh(page);
  await page.evaluate((line) => {
    const e = (window as any).__nx.ed;
    let n = 0;
    e.doc.blocks[0].items = [...line].map((ch) => ({ t: 'c', ch, id: 'u' + n++ }));
    e.touch();
  }, LINE);
  const [first] = await pdfText(page);
  const link = first.links.find((l) => l.url);
  expect(link?.url).toBe('https://example.com/a?b=1');
  // (the box over the address: in the piece of text it's in, past where that starts, about
  // an address's width, on its line)
  const piece = first.text.find((t) => t.text.includes('https://'))!;
  expect(link!.rect[0]).toBeGreaterThan(piece.x);
  expect(link!.rect[2] - link!.rect[0]).toBeGreaterThan(100);
  expect(link!.rect[1]).toBeLessThan(piece.y);
  expect(link!.rect[3]).toBeGreaterThan(piece.y);
});

test('a reference goes to the page of what it refers to; a numbered formula’s number is text too', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  // (the welcome note: Parseval's formula is (1), and the proof under it refers to it)
  const pages = await pdfText(page);
  const at = pages.findIndex((p) => p.text.some((t) => t.text === '(1)' && t.x > 400));
  expect(at).toBeGreaterThanOrEqual(0);
  const refs = pages.flatMap((p) => p.links.filter((l) => l.page !== undefined));
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.every((l) => l.page === at)).toBe(true);
  // and the formula's LaTeX, there too
  expect(pages[at].text.map((t) => t.text).join('')).toContain(String.raw`\sum _{n\in \mathbb{Z}}`);
});
