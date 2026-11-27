// Commands that fit where the caret is come first: a table's in a table, styles on a
// selection, a list's or a heading's kinds; in a formula, math (even in a table's cell).
// In the palette, the right-click menu and the toolbar.
import { test, expect, open, fresh, type, text, kinds, formulas, ed, rectOfText } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** The palette's entries (names), and how many lines divide them. */
const names = async (page: Page) => (await page.locator('.palette .opt .name').allInnerTexts()).map((n) => n.replace('✎', ''));
const rules = (page: Page) => page.locator('.palette .rule').count();
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
  expect(await rules(page)).toBe(1);
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
  expect(await rules(page)).toBe(0);
});

test('outside a table there are no table commands, and on a plain line no divider', async ({ page }) => {
  await type(page, 'plain');
  await type(page, '\\');
  const shown = await names(page);
  expect(shown).not.toContain('addrow');
  expect(await rules(page)).toBe(0);
  await type(page, 'addrow');
  expect(await names(page)).not.toContain('addrow');
});

test('with text selected, the palette offers its styles first, and they apply to it', async ({ page }) => {
  await type(page, 'say hello');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await type(page, '\\');
  expect(await rules(page)).toBe(1);
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
  expect(await rules(page)).toBe(1);
  expect((await names(page)).slice(0, 2)).toEqual(['ol', 'p']);
  await page.keyboard.press('Enter');
  expect(await kinds(page)).toEqual(['ol']);
});

test('in a heading, the other headings come first', async ({ page }) => {
  await type(page, '# Title');
  await type(page, '\\');
  expect(await rules(page)).toBe(1);
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
  expect(await menu(page)).toEqual(['add a row under this one', 'delete this row', 'add a column after this one', 'delete this column', 'align this column left', 'center this column', 'align this column right', 'delete this table']);
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

// ── every command, scrolled through ──

/** Whether the highlighted entry is within the palette's visible list. */
const selInView = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('.palette .opts')!.getBoundingClientRect();
    const r = document.querySelector('.palette .opt.sel')!.getBoundingClientRect();
    return r.top >= list.top - 1 && r.bottom <= list.bottom + 1;
  });
const listTop = (page: Page) => page.evaluate(() => document.querySelector('.palette .opts')!.scrollTop);

test('the palette lists every command, and the arrows scroll through them', async ({ page }) => {
  await type(page, '\\');
  const all = await ed(page, (e) => e.textCommands().length);
  expect(await names(page)).toHaveLength(all);
  expect(await listTop(page)).toBe(0);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  expect(await selInView(page)).toBe(true);
  expect(await listTop(page)).toBeGreaterThan(0);
  // to the last, and back to the first
  for (let i = 0; i < all; i++) await page.keyboard.press('ArrowDown');
  expect(await page.locator('.palette .opt.sel .name').innerText()).toContain((await names(page)).at(-1)!);
  expect(await selInView(page)).toBe(true);
  for (let i = 0; i <= all / 10; i++) await page.keyboard.press('PageUp');
  expect(await ed(page, (e) => e.palette.sel)).toBe(0);
  expect(await listTop(page)).toBe(0);
});

test('page down moves ten at a time', async ({ page }) => {
  await type(page, '\\');
  await page.keyboard.press('PageDown');
  expect(await ed(page, (e) => e.palette.sel)).toBe(10);
  expect(await selInView(page)).toBe(true);
});

test('the mouse wheel scrolls the palette (not the page), and a click picks what is under it', async ({ page }) => {
  await type(page, '\\');
  const list = (await page.locator('.palette .opts').boundingBox())!;
  await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
  const before = await page.evaluate(() => document.scrollingElement!.scrollTop);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => listTop(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(before);
  // the last entry is help (F1)
  const help = page.locator('.palette .opt', { hasText: 'keyboard shortcuts' });
  await expect(help).toBeInViewport();
  await help.click();
  await expect(page.locator('.palette')).toHaveCount(0);
  expect(await ed(page, (e) => e.showHelp)).toBe(true);
});

test('typing filters the whole list, and the list starts at the top again', async ({ page }) => {
  await type(page, '\\');
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  await type(page, 'h');
  expect(await ed(page, (e) => e.palette.sel)).toBe(0);
  expect(await listTop(page)).toBe(0);
  const shown = await names(page);
  for (const n of ['h1', 'h2', 'h3', 'help']) expect(shown).toContain(n);
});

test('in math, every math command is there to scroll to', async ({ page }) => {
  await type(page, '$\\');
  expect((await names(page)).length).toBeGreaterThan(100);
  await page.keyboard.press('End');
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
  expect(await selInView(page)).toBe(true);
});

test('typing narrows the list as an autocomplete does, the letters typed marked', async ({ page }) => {
  await type(page, '\\in');
  expect(await names(page)).toEqual(['inlinecode']);
  expect(await page.locator('.palette .opt .hit').allInnerTexts()).toEqual(['in']);
  await type(page, 'c');
  expect(await page.locator('.palette .opt .hit').allInnerTexts()).toEqual(['in', 'c']);
});

test('in a short window the palette shrinks to fit, below the caret or above it', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 360 });
  const fits = () =>
    page.evaluate(() => {
      const r = document.querySelector('.palette')!.getBoundingClientRect();
      const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
      return { top: r.top >= bar.bottom, bottom: r.bottom <= window.innerHeight - 24, scrolls: document.querySelector('.palette .opts')!.scrollHeight > r.height };
    });
  await type(page, '\\');
  await page.waitForTimeout(200);
  expect(await fits()).toEqual({ top: true, bottom: true, scrolls: true });
  await page.keyboard.press('Escape');
  // the caret low in the window: above it, still inside
  for (let i = 0; i < 9; i++) await page.keyboard.press('Enter');
  await type(page, '\\');
  await page.waitForTimeout(200);
  expect(await fits()).toEqual({ top: true, bottom: true, scrolls: true });
  // and the arrows still keep the highlighted one in view
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowDown');
  expect(await selInView(page)).toBe(true);
});

// ── remembering what's used ──

/** Run a palette command by name. */
async function run(page: Page, name: string) {
  await type(page, '\\' + name);
  await page.keyboard.press('Enter');
}

test('the palette remembers what you pick: it comes first, and first among matches', async ({ page }) => {
  await type(page, 'plain');
  await type(page, '\\');
  expect((await names(page))[0]).toBe('arrow');
  await page.keyboard.press('Escape');
  await run(page, 'theme');
  await run(page, 'theme');
  await type(page, '\\');
  expect((await names(page))[0]).toBe('theme');
  await type(page, 't');
  // (table and theme both begin with t: the one used first)
  expect((await names(page))[0]).toBe('theme');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // still remembered after a reload
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await type(page, '\\');
  expect((await names(page))[0]).toBe('theme');
});

test('in a table, the table’s commands stay first, the most used of them on top', async ({ page }) => {
  await run(page, 'theme');
  await table(page);
  await run(page, 'alignright');
  await type(page, '\\');
  const shown = await names(page);
  expect(shown.slice(0, 2)).toEqual(['alignright', 'addrow']);
  expect(shown[8]).toBe('theme');
  expect(await rules(page)).toBe(1);
});

test('math remembers its own', async ({ page }) => {
  await type(page, '$');
  await run(page, 'alpha');
  await type(page, '\\');
  expect((await names(page))[0]).toBe('alpha');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await type(page, ' text ');
  await type(page, '\\');
  expect(await names(page)).not.toContain('alpha');
});

test('remembering can be switched off, and forget clears it', async ({ page }) => {
  await run(page, 'theme');
  await page.evaluate(() => { const e = (window as any).__nx.ed; e.updateConfig({ rememberCommands: false }); });
  await type(page, '\\');
  expect((await names(page))[0]).toBe('arrow');
  await page.keyboard.press('Escape');
  // off: nothing new is remembered either
  await run(page, 'statusbar');
  await run(page, 'statusbar');
  await page.evaluate(() => { const e = (window as any).__nx.ed; e.updateConfig({ rememberCommands: true }); });
  await type(page, '\\');
  expect((await names(page)).slice(0, 2)).toEqual(['theme', 'arrow']);
  await page.keyboard.press('Escape');
  await run(page, 'forget');
  await type(page, '\\');
  expect((await names(page))[0]).toBe('arrow');
});

// ── fuzzy ──

test('a typo still finds the command, and Enter runs it', async ({ page }) => {
  await type(page, '\\tabel');
  expect((await names(page))[0]).toBe('table');
  await page.keyboard.press('Enter');
  expect(await rows(page)).toBe(2);
});

test('a word of what a command does finds it', async ({ page }) => {
  await type(page, '\\heading');
  expect((await names(page)).slice(0, 3)).toEqual(['h1', 'h2', 'h3']);
});

test('in math, a typo finds the command too', async ({ page }) => {
  await type(page, '$');
  await type(page, '\\farc');
  expect((await names(page))[0]).toBe('frac');
  await page.keyboard.press('Enter');
  expect((await formulas(page))[0]).toContain('\\frac');
});

test('an item arrowed down to is the one inserted, even when what is typed is a name too', async ({ page }) => {
  await type(page, '$');
  await type(page, '\\int');
  const list = await names(page);
  expect(list[0]).toBe('int');
  for (let i = 0; i < list.indexOf('intop'); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await type(page, 'f');
  expect((await formulas(page))[0].replace(/\s/g, '')).toBe('\\intf');
});

test('without arrowing, an exact name still wins as typed', async ({ page }) => {
  await type(page, '$');
  await type(page, '\\int');
  await page.keyboard.press('Enter');
  await type(page, '0 1 f');
  expect((await formulas(page))[0].replace(/\s/g, '')).toBe('\\int_{0}^{1}f');
});

test('a group’s word finds the whole group: draw, every drawing command; style, the styles', async ({ page }) => {
  await type(page, '\\draw');
  const draws = await names(page);
  for (const n of ['drawings', 'arrow', 'box', 'circle', 'underline', 'highlight', 'brace', 'strike']) expect(draws).toContain(n);
  await page.keyboard.press('Escape');
  await type(page, '\\style');
  const styles = await names(page);
  for (const n of ['bold', 'italic', 'inlinecode', 'strikethrough', 'texthighlight']) expect(styles).toContain(n);
});

test('near the page’s right edge the palette moves left, keeping its width (not squeezed)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await type(page, 'x'.repeat(70));
  await type(page, '\\');
  const box = (await page.locator('.palette').boundingBox())!;
  const pg = (await page.locator('.page').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(pg.x + pg.width);
  // each option on one line: names and what they do side by side
  const heights = await page.locator('.palette .opt').evaluateAll((els) => els.slice(0, 12).map((e) => e.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThan(26);
});
