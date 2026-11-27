// Matrices (and cases, aligned): made at a size, typed cell by cell, clicked into (empty
// cells too), rows and columns added and taken away by the palette, the right-click menu
// and Backspace.
import { test, expect, open, fresh, type, formulas, ed } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** A formula with a matrix in it, from the palette (`name`), the caret in its first cell. */
async function matrix(page: Page, name = 'pmatrix') {
  await type(page, 'M = $');
  await type(page, B + name);
  await page.keyboard.press('Enter');
}
const env = (rows: string[][]) => (String.raw`\begin{pmatrix}` + rows.map((r) => r.join(' & ')).join(String.raw` \\ `) + String.raw`\end{pmatrix}`).replace(/\s+/g, ' ');
const tex = async (page: Page) => (await formulas(page))[0].replace(/\s+/g, ' ');
/** Which cell the caret is in: [row, column]. */
const cell = (page: Page) =>
  ed(page, (e) => {
    const step = e.mc.path[e.mc.path.length - 1];
    const node = e.mathItem.root[e.mc.path[0].i];
    return step ? [Math.floor(step.s / node.cols), step.s % node.cols] : null;
  });

/** Where each empty box and each letter of the formula is on the page. */
const boxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.math [data-nx], .math [data-nxslot]')]
      .filter((el) => !el.querySelector('[data-nx], [data-nxslot]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { t: el.textContent!.replace(/[​⁠]/g, ''), x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }),
  );

test('a new matrix: a click on any of its empty cells puts the caret in that cell', async ({ page }) => {
  await matrix(page);
  for (const [i, want] of [[3, [1, 1]], [1, [0, 1]], [2, [1, 0]], [0, [0, 0]]] as const) {
    const empties = (await boxes(page)).filter((b) => b.t === '□');
    expect(empties).toHaveLength(4);
    // (in reading order: the boxes are listed column by column by KaTeX, so sort them)
    empties.sort((a, b) => a.y - b.y || a.x - b.x);
    await page.mouse.click(empties[i].x, empties[i].y);
    expect(await cell(page), `box ${i}`).toEqual(want);
  }
});

test('a click on a letter in the second row lands in its cell (not the row above’s)', async ({ page }) => {
  await matrix(page);
  await type(page, 'a&b');
  await page.keyboard.press('Enter');
  await type(page, 'c&d');
  await page.keyboard.press('Escape');
  await type(page, ' then');
  await page.locator('.math').first().click(); // into the formula: its editing layout
  for (const [t, want] of [['c', [1, 0]], ['b', [0, 1]], ['d', [1, 1]], ['a', [0, 0]]] as const) {
    const b = (await boxes(page)).find((b) => b.t === t)!;
    await page.mouse.click(b.x, b.y);
    expect(await cell(page), t).toEqual(want);
  }
});

test('made at a size: \\pmatrix3x4 and the like (2 to 4 rows and columns)', async ({ page }) => {
  await matrix(page, 'pmatrix3x4');
  expect(await tex(page)).toBe(env([['', '', '', ''], ['', '', '', ''], ['', '', '', '']]));
  // (the sizes only when typed: not crowding the palette's list)
  await page.keyboard.press('Escape');
  await type(page, '$' + B);
  const names = await page.locator('.palette .opt .name').allInnerTexts();
  expect(names.some((n) => /\dx\d/.test(n))).toBe(false);
});

test('in a matrix, the palette adds and deletes rows and columns where the caret is', async ({ page }) => {
  await matrix(page);
  await type(page, 'a&b');
  await page.keyboard.press('Enter');
  await type(page, 'c&d');
  // the matrix's commands come first
  await type(page, B);
  expect((await page.locator('.palette .opt .name').allInnerTexts()).slice(0, 4)).toEqual(['addrow', 'deleterow', 'addcolumn', 'deletecolumn']);
  await type(page, 'addrow');
  await page.keyboard.press('Enter');
  await type(page, 'e');
  expect(await tex(page)).toBe(env([['a', 'b'], ['c', 'd'], ['', 'e']]));
  await type(page, B + 'addcolumn');
  await page.keyboard.press('Enter');
  expect(await tex(page)).toBe(env([['a', 'b', ''], ['c', 'd', ''], ['', 'e', '']]));
  await type(page, B + 'deletecolumn');
  await page.keyboard.press('Enter');
  await type(page, B + 'deleterow');
  await page.keyboard.press('Enter');
  expect(await tex(page)).toBe(env([['a', 'b'], ['c', 'd']]));
  // one undo each
  await page.keyboard.press('Control+z');
  expect(await tex(page)).toBe(env([['a', 'b'], ['c', 'd'], ['', 'e']]));
});

test('right-click in a matrix: its rows and columns', async ({ page }) => {
  await matrix(page);
  await type(page, 'a&b');
  const b = (await boxes(page)).find((x) => x.t === 'b')!;
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await page.locator('.dmenu .opt', { hasText: 'add a column after this one' }).click();
  expect(await tex(page)).toBe(env([['a', 'b', ''], ['', '', '']]));
  // and not in a formula with no matrix
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await type(page, ' and $x+1$');
  const x = (await boxes(page)).find((q) => q.t === 'x')!;
  await page.mouse.click(x.x, x.y, { button: 'right' });
  await expect(page.locator('.dmenu')).toBeVisible();
  await expect(page.locator('.dmenu .opt', { hasText: 'add a row' })).toHaveCount(0);
});

test('backspace takes an empty row or column, never unwrapping the matrix', async ({ page }) => {
  await matrix(page);
  await type(page, 'a&b');
  await page.keyboard.press('Enter'); // a new empty row
  await page.keyboard.press('Enter'); // another
  expect(await tex(page)).toBe(env([['a', 'b'], ['', ''], ['', '']]));
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toBe(env([['a', 'b']]));
  // the caret at the end of the row before: typing goes on there
  await type(page, 'c');
  expect(await tex(page)).toBe(env([['a', 'bc']]));
  await type(page, '&'); // a new empty column
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toBe(env([['a', 'bc']]));
});
