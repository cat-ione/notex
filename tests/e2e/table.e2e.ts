// Tables: markdown's | rows (a separator under the first), shown as a grid; Tab goes from
// cell to cell, Enter adds a row, and they export to LaTeX.
import { test, expect, open, fresh, type, text, ed } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Each table row's cells' left edges (screen x). */
const columns = (page: Page) =>
  page.locator('.block.tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll(':scope > .td')].map((c) => Math.round(c.getBoundingClientRect().left))));

/** The selected text, or '' (the caret alone). */
const selected = (page: Page) =>
  ed(page, (e) => {
    const s = e.selection;
    if (!s) return '';
    return e.doc.blocks[s.s.b].items.slice(s.s.o, s.e.o).map((i: any) => i.ch).join('');
  });

test('\\table starts a table with its first header selected, and typing replaces it', async ({ page }) => {
  await type(page, '\\table');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(3);
  expect(await selected(page)).toBe('column');
  await type(page, 'x');
  expect((await text(page)).split('\n')[0]).toBe('| x | column |');
});

test('tab goes to the next cell, selecting it; shift+tab back; past the last row, a new row', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await type(page, 'n');
  await page.keyboard.press('Tab');
  expect(await selected(page)).toBe('column');
  await type(page, 'sq');
  await page.keyboard.press('Tab'); // to the body row (past the separator)
  await type(page, '1');
  await page.keyboard.press('Tab');
  await type(page, '1');
  await page.keyboard.press('Tab'); // past the end: a new row
  await type(page, '2');
  await page.keyboard.press('Tab');
  await type(page, '4');
  await page.keyboard.press('Shift+Tab');
  expect(await selected(page)).toBe('2');
  expect(await text(page)).toBe('| n | sq |\n| --- | --- |\n| 1 | 1 |\n| 2 | 4 |');
});

test('the columns line up, whatever is in the cells', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await type(page, 'a');
  await page.keyboard.press('Tab');
  await type(page, 'b');
  await page.keyboard.press('Tab');
  await type(page, 'a much longer first cell');
  await page.keyboard.press('Tab');
  await type(page, 'short');
  const cols = await columns(page);
  const second = cols.map((r) => r[1]);
  expect(new Set(second).size).toBe(1);
  // and the second column starts after the longest first cell
  const long = await page.locator('.block.tr .td', { hasText: 'a much longer first cell' }).evaluate((e) => e.getBoundingClientRect().right);
  expect(second[0]).toBeGreaterThanOrEqual(Math.floor(long));
});

test('enter adds a row under this one; on an empty last row it leaves the table', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await type(page, 'one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  expect(await text(page)).toBe('| column | column |\n| --- | --- |\n| one |  |\n| two |  |');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, 'after');
  expect(await text(page)).toBe('| column | column |\n| --- | --- |\n| one |  |\n| two |  |\nafter');
  await expect(page.locator('.block.tr')).toHaveCount(4);
});

test('enter on the header adds a row under the separator', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await type(page, 'first');
  expect((await text(page)).split('\n').slice(0, 3)).toEqual(['| column | column |', '| --- | --- |', '| first |  |']);
});

test('the separator is a line under the header, and text when the caret is on it', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  const sep = page.locator('.block.tr.tsep');
  const hidden = await sep.evaluate((e) => e.getBoundingClientRect().height);
  expect(hidden).toBeLessThan(4);
  await expect(page.locator('.block.tr.thead')).toHaveCSS('font-weight', '600');
  await page.keyboard.press('ArrowDown');
  await expect(sep).toHaveClass(/current/);
  expect(await sep.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(10);
});

test('typed by hand, it becomes a table once the separator is there', async ({ page }) => {
  await type(page, '| a | b |');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(0);
  await type(page, '| - | - |');
  await expect(page.locator('.block.tr')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await type(page, '| 1 | 2 |');
  await expect(page.locator('.block.tr')).toHaveCount(3);
});

test('|x| at the start of a line is just text', async ({ page }) => {
  await type(page, '|x| is the size of x');
  await page.keyboard.press('Enter');
  await type(page, '|y| too');
  await expect(page.locator('.block.tr')).toHaveCount(0);
  await expect(page.locator('.ch.pipe')).toHaveCount(0);
});

test('the separator sets the columns alignment', async ({ page }) => {
  await type(page, '| left | middle | right |');
  await page.keyboard.press('Enter');
  await type(page, '| :-- | :-: | --: |');
  await page.keyboard.press('Enter');
  await type(page, '| 1 | 2 | 3 |');
  const align = await page
    .locator('.block.tr')
    .last()
    .evaluate((r) => [...r.querySelectorAll(':scope > .td')].slice(0, 3).map((c) => getComputedStyle(c).textAlign));
  expect(align).toEqual(['left', 'center', 'right']);
});

test('a formula in a cell', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await type(page, '$x^2$');
  await expect(page.locator('.block.tr .td .math .katex')).toHaveCount(1);
  expect((await text(page)).split('\n')[2]).toBe('| $x^{2}$ |  |');
});

test('a markdown table pasted in is a table', async ({ page }) => {
  await page.evaluate((t) => (window as any).__nx.ed.paste({ clipboardData: { getData: (k: string) => (k === 'text/plain' ? t : ''), types: ['text/plain'], files: [] }, preventDefault() {} }), '| a | b |\n| --- | --- |\n| 1 | 2 |');
  await expect(page.locator('.block.tr')).toHaveCount(3);
});

test('an arrow can go from one cell to another', async ({ page }) => {
  await type(page, '| from | to |');
  await page.keyboard.press('Enter');
  await type(page, '| - | - |');
  const a = await page.locator('.block.tr .ch', { hasText: 'f' }).first().boundingBox();
  const b = await page.locator('.block.tr .ch', { hasText: 'o' }).last().boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await ed(page, (e) => e.doc.arrows.length)).toBe(1);
  await expect(page.locator('svg.arrows g.arrow')).toHaveCount(1);
});

test('LaTeX export makes it a tabular', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await type(page, 'k');
  const tex: string = await page.evaluate(() => (window as any).__nx.tex());
  expect(tex).toContain(String.raw`\begin{tabular}{l l}`);
  expect(tex).toContain(String.raw`k & column \\ \hline`);
  expect(tex).toContain(String.raw`\end{tabular}`);
});

test('the welcome note has a table, with formulas in it', async ({ page }) => {
  await page.evaluate(() => (window as any).__nx.ed.openWelcome());
  await expect(page.locator('.block.tr')).toHaveCount(5);
  expect(await page.locator('.block.tr .math .katex').count()).toBe(3);
  const second = (await columns(page)).map((r) => r[1]);
  expect(new Set(second).size).toBe(1);
});

test('tab outside a table still nests list items', async ({ page }) => {
  await type(page, '- item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  expect(await ed(page, (e) => e.doc.blocks[1].indent)).toBe(1);
});
