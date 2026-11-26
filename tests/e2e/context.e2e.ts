// Commands that fit where the caret is come first: a table's in a table, styles on a
// selection, a list's or a heading's kinds; in a formula, math (even in a table's cell).
// In the palette, the right-click menu and the toolbar.
import { test, expect, open, fresh, type, text, kinds, formulas, ed, rectOfText } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** The palette's entries (names), and its group labels. */
const names = (page: Page) => page.locator('.palette .opt .name').allInnerTexts();
const groups = (page: Page) => page.locator('.palette .group').allInnerTexts();
const menu = (page: Page) => page.locator('.dmenu .opt .name').allInnerTexts();
const rows = (page: Page) => page.locator('.block.tr').count();

/** A table (a | b over 1 | 2), the caret in "1". */
async function table(page: Page) {
  await type(page, '| a | b |');
  await page.keyboard.press('Enter');
  await type(page, '| --- | --- |');
  await page.keyboard.press('Enter');
  await type(page, '1');
  await page.keyboard.press('Tab');
  await type(page, '2');
  await page.keyboard.press('Shift+Tab');
  expect(await rows(page)).toBe(2);
}

async function rightClick(page: Page, at: { cx: number; cy: number }) {
  await page.mouse.click(at.cx, at.cy, { button: 'right' });
  await expect(page.locator('.dmenu')).toBeVisible();
}

// ── the palette ──

test('in a table, the palette starts with the table’s commands', async ({ page }) => {
  await table(page);
  await type(page, '\\');
  expect((await names(page)).slice(0, 7)).toEqual(['addrow', 'deleterow', 'addcolumn', 'deletecolumn', 'alignleft', 'aligncenter', 'alignright']);
  expect(await groups(page)).toEqual(['this table', 'everything else']);
  await page.keyboard.press('Enter');
  expect(await rows(page)).toBe(3);
});

test('in a table, what is typed still finds every command, the table’s first', async ({ page }) => {
  await table(page);
  await type(page, '\\al');
  expect((await names(page)).slice(0, 3)).toEqual(['alignleft', 'alignright', 'aligncenter']);
  await page.keyboard.press('Escape');
  await type(page, '\\h2');
  expect((await names(page))[0]).toBe('h2');
  expect(await groups(page)).toEqual([]);
});

test('outside a table there are no table commands, and on a plain line no groups', async ({ page }) => {
  await type(page, 'plain');
  await type(page, '\\');
  const shown = await names(page);
  expect(shown).not.toContain('addrow');
  expect(await groups(page)).toEqual([]);
  await type(page, 'addrow');
  expect(await names(page)).not.toContain('addrow');
});

test('with text selected, the palette offers its styles first, and they apply to it', async ({ page }) => {
  await type(page, 'say hello');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await type(page, '\\');
  expect(await groups(page)).toEqual(['the selection', 'everything else']);
  expect((await names(page)).slice(0, 3)).toEqual(['bold', 'italic', 'inlinecode']);
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('say **hello**');
  // still selected (ctrl+k too offers what fits it), and again it's undone
  expect(await ed(page, (e) => { const s = e.selection; return s && e.doc.blocks[0].items.slice(s.s.o, s.e.o).map((i: any) => i.ch).join(''); })).toBe('hello');
  await page.keyboard.press('Control+k');
  expect((await names(page))[0]).toBe('bold');
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('say hello');
});

test('a selection across lines: a kind from the palette applies to every line', async ({ page }) => {
  await type(page, 'one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  await page.keyboard.press('Shift+ArrowUp');
  await type(page, '\\h2');
  await page.keyboard.press('Enter');
  expect(await kinds(page)).toEqual(['h2', 'h2']);
});

test('in a list, the other kinds of list come first', async ({ page }) => {
  await type(page, '- item');
  await type(page, '\\');
  expect(await groups(page)).toEqual(['this list', 'everything else']);
  expect((await names(page)).slice(0, 2)).toEqual(['ol', 'p']);
  await page.keyboard.press('Enter');
  expect(await kinds(page)).toEqual(['ol']);
});

test('in a heading, the other headings come first', async ({ page }) => {
  await type(page, '# Title');
  await type(page, '\\');
  expect(await groups(page)).toEqual(['this heading', 'everything else']);
  expect((await names(page)).slice(0, 3)).toEqual(['h2', 'h3', 'p']);
});

test('in math, even in a table’s cell, the palette is math’s, the commonest first', async ({ page }) => {
  await table(page);
  await type(page, '$');
  await type(page, '\\');
  const shown = await names(page);
  expect(shown.slice(0, 4)).toEqual(['frac', 'sqrt', 'sum', 'int']);
  expect(shown).not.toContain('addrow');
  await page.keyboard.press('Escape');
});

test('with part of a formula selected, the math palette starts with what wraps it', async ({ page }) => {
  await type(page, '$x+1');
  await page.keyboard.press('Shift+ArrowLeft');
  await type(page, '\\');
  expect((await names(page)).slice(0, 3)).toEqual(['frac', 'sqrt', 'hat']);
});

// ── the right-click menu ──

test('right-click in a table: its commands come right after the clipboard', async ({ page }) => {
  await table(page);
  await rightClick(page, await rectOfText(page, '2'));
  const shown = await menu(page);
  expect(shown.slice(4, 6)).toEqual(['add a row under this one', 'delete this row']);
  expect(shown.indexOf('add a row under this one')).toBeLessThan(shown.indexOf('insert math'));
});

test('right-click on a formula in a table: math, not the table', async ({ page }) => {
  await table(page);
  await type(page, '$y');
  await page.keyboard.press('Escape');
  const f = (await page.locator('.block.tr').nth(1).locator('.katex').first().boundingBox())!;
  await rightClick(page, { cx: f.x + f.width / 2, cy: f.y + f.height / 2 });
  const shown = await menu(page);
  expect(shown).toContain('fraction');
  expect(shown).toContain('every math command');
  expect(shown).not.toContain('add a row under this one');
  expect(shown).not.toContain('insert math');
  await page.locator('.dmenu .opt', { hasText: 'square root' }).click();
  expect((await formulas(page))[0]).toContain('\\sqrt');
});

test('right-click on selected math: wrap it', async ({ page }) => {
  await type(page, '$x+1');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  const f = (await page.locator('.katex').first().boundingBox())!;
  await rightClick(page, { cx: f.x + f.width / 2, cy: f.y + f.height / 2 });
  await page.locator('.dmenu .opt', { hasText: 'a fraction over it' }).click();
  expect((await formulas(page))[0]).toBe('\\frac{x+1}{}');
});

test('right-click on selected text: bold, italic and code', async ({ page }) => {
  await type(page, 'say hello');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await rightClick(page, await rectOfText(page, 'hello'));
  const shown = await menu(page);
  expect(shown.slice(4, 7)).toEqual(['bold', 'italic', 'code']);
  await page.locator('.dmenu .opt', { hasText: /^italic/ }).click();
  expect(await text(page)).toBe('say *hello*');
});

test('right-click on plain text: no styles, no table, no math entries', async ({ page }) => {
  await type(page, 'say hello');
  await rightClick(page, await rectOfText(page, 'say'));
  const shown = await menu(page);
  for (const n of ['bold', 'add a row under this one', 'fraction']) expect(shown).not.toContain(n);
});

// ── the toolbar ──

test('in a table, the toolbar’s table button opens the table’s menu; again, it closes', async ({ page }) => {
  const button = page.locator('.toolbar .b-table');
  await expect(button).not.toHaveClass(/here/);
  await table(page);
  await expect(button).toHaveClass(/here/);
  await button.click();
  expect(await menu(page)).toEqual(['add a row under this one', 'delete this row', 'add a column after this one', 'delete this column', 'align this column left', 'center this column', 'align this column right']);
  await button.click();
  await expect(page.locator('.dmenu')).toHaveCount(0);
  await button.click();
  await page.locator('.dmenu .opt', { hasText: 'add a column after this one' }).click();
  expect(await ed(page, (e) => e.doc.blocks[0].items.filter((i: any) => i.cell).length)).toBe(4);
});

test('outside a table, the toolbar’s table button makes one', async ({ page }) => {
  await type(page, 'x');
  await page.locator('.toolbar .b-table').click();
  await expect(page.locator('.dmenu')).toHaveCount(0);
  expect(await rows(page)).toBe(2);
});

test('in a formula in a table, the table button is not the table’s', async ({ page }) => {
  await table(page);
  await type(page, '$');
  await expect(page.locator('.toolbar .b-table')).not.toHaveClass(/here/);
});
