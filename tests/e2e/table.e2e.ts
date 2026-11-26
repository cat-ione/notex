// Tables, as in a word processor: cells with walls you can't type on, select or delete;
// Tab goes from cell to cell, Enter adds a row; selecting across cells selects whole cells.
// Outside the editor they're markdown (files, the clipboard, LaTeX).
import { test, expect, open, fresh, type, ed } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** The note: a table row as `H a | b` (header) or `  a | b`, other lines as their text. */
const view = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as any).__nx.ed.doc.blocks.map((b: any) => {
      const t = (items: any[]) => items.map((i: any) => (i.t === 'c' ? i.ch : '§')).join('');
      if (b.kind !== 'tr') return t(b.items);
      const walls = b.items.flatMap((i: any, o: number) => (i.cell ? [o] : []));
      const cells = walls.slice(0, -1).map((w: number, k: number) => t(b.items.slice(w + 1, walls[k + 1])));
      return `${b.head ? 'H' : ' '} ${cells.join(' | ')}`;
    }),
  );
const caret = (page: Page) => ed(page, (e) => [e.b, e.o]);
/** The selected text, or '' (the caret alone). */
const selected = (page: Page) =>
  ed(page, (e) => {
    const s = e.selection;
    if (!s) return '';
    return e.doc.blocks[s.s.b].items.slice(s.s.o, s.e.o).map((i: any) => i.ch).join('');
  });
const paste = (page: Page, t: string) =>
  page.evaluate((t) => (window as any).__nx.ed.paste({ clipboardData: { getData: (k: string) => (k === 'text/plain' ? t : ''), types: ['text/plain'], files: [] }, preventDefault() {} }), t);

/** Above, a table (a | b over 1 | 2 and 3 | 4), below; the caret in "a". */
async function table(page: Page) {
  await type(page, 'Above');
  await page.keyboard.press('Enter');
  await type(page, '| a | b |');
  await page.keyboard.press('Enter');
  await type(page, '| --- | --- |');
  await page.keyboard.press('Enter'); // the header and separator, typed out: a table
  await type(page, '1');
  await page.keyboard.press('Tab');
  await type(page, '2');
  await page.keyboard.press('Enter');
  await type(page, '3');
  await page.keyboard.press('Tab');
  await type(page, '4');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // out of the table
  await type(page, 'Below');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  expect(await view(page)).toEqual(['Above', 'H a | b', '  1 | 2', '  3 | 4', 'Below']);
}

// ── making one ──

test('\\table starts a table with its first header selected, and typing replaces it', async ({ page }) => {
  await type(page, '\\table');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(2);
  expect(await selected(page)).toBe('column');
  await type(page, 'x');
  expect(await view(page)).toEqual(['H x | column', '   | ']);
});

test('a markdown table typed out becomes a table at the separator', async ({ page }) => {
  await type(page, '| name | value |');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(0);
  await type(page, '| :-- | --: |');
  await page.keyboard.press('Enter');
  expect(await view(page)).toEqual(['H name | value', '   | ']);
  // the caret is in the new row's first cell, and the alignment is kept
  expect(await caret(page)).toEqual([1, 1]);
  expect(await ed(page, (e) => e.doc.blocks[0].aligns)).toEqual(['left', 'right']);
});

test('|x| at the start of a line is just text', async ({ page }) => {
  await type(page, '|x| is the size of x');
  await page.keyboard.press('Enter');
  await type(page, '|y| too');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(0);
});

test('a markdown table pasted onto a line goes between its halves', async ({ page }) => {
  await type(page, 'before after');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await paste(page, '| a | b |\n| - | - |\n| 1 | 2 |');
  expect(await view(page)).toEqual(['before ', 'H a | b', '  1 | 2', 'after']);
});

// ── typing in cells ──

test('anything can be typed in a cell: |, -, ---, and they stay text', async ({ page }) => {
  await table(page);
  await page.keyboard.press('End');
  await type(page, ' | --- - |x|');
  expect((await view(page))[1]).toBe('H a | --- - |x| | b');
  await expect(page.locator('.block.tr')).toHaveCount(3);
  await expect(page.locator('.block.tr').first().locator(':scope > .td')).toHaveCount(2);
  // and a whole row of dashes is a row like any other
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await type(page, '---');
  await page.keyboard.press('Tab');
  await type(page, '---');
  expect((await view(page)).slice(1, 4)).toEqual(['H a | --- - |x| | b', '  --- | ---', '  3 | 4']);
});

test('tab goes to the next cell, selecting it; shift+tab back; past the last cell a new row', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Tab');
  expect(await selected(page)).toBe('b');
  await page.keyboard.press('Tab');
  expect(await selected(page)).toBe('1');
  await page.keyboard.press('Shift+Tab');
  expect(await selected(page)).toBe('b');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End'); // in "4"
  await page.keyboard.press('Tab');
  await type(page, '5');
  expect((await view(page)).slice(1, 5)).toEqual(['H a | b', '  1 | 2', '  3 | 4', '  5 | ']);
});

test('enter adds a row under this one; on an empty last row it leaves the table', async ({ page }) => {
  await table(page);
  await page.keyboard.press('ArrowDown'); // in "1"
  await page.keyboard.press('Enter');
  await type(page, 'x');
  expect((await view(page)).slice(1, 5)).toEqual(['H a | b', '  1 | 2', '  x | ', '  3 | 4']);
});

test('the walls stay: backspace at a cell start and delete at its end do nothing', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+Backspace');
  expect(await view(page)).toEqual(['Above', 'H  | b', '  1 | 2', '  3 | 4', 'Below']);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+Delete');
  expect(await view(page)).toEqual(['Above', 'H  | b', '  1 | 2', '  3 | 4', 'Below']);
});

test('backspace on an empty last row takes the row away', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(4);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.block.tr')).toHaveCount(3);
});

// ── the caret only in cells ──

test("right and left go from a cell's end to the next cell's start, and on to the next row", async ({ page }) => {
  await table(page);
  const seen: number[][] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowRight');
    seen.push(await caret(page));
  }
  // row 1 is ‖a‖b‖: a at 1, its end 2; b's start 3, its end 4; then row 2's first cell
  expect(seen).toEqual([[1, 2], [1, 3], [1, 4], [2, 1]]);
  await page.keyboard.press('ArrowLeft');
  expect(await caret(page)).toEqual([1, 4]);
});

test("home and end go to the cell's start and end", async ({ page }) => {
  await table(page);
  await page.keyboard.press('Tab');
  await type(page, 'longer');
  await page.keyboard.press('Home');
  expect(await caret(page)).toEqual([1, 3]);
  await page.keyboard.press('End');
  expect(await caret(page)).toEqual([1, 9]);
});

test('a click in a cell lands in that cell, even an empty one and beside its text', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter'); // an empty row
  const cells = page.locator('.block.tr').nth(3).locator(':scope > .td');
  for (let c = 0; c < 2; c++) {
    const box = (await cells.nth(c).boundingBox())!;
    for (const fx of [0.05, 0.5, 0.95]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
      expect(await ed(page, (e) => e.cellAt(e.b, e.o)), `cell ${c} at ${fx}`).toBe(c);
      expect(await ed(page, (e) => e.b)).toBe(4);
    }
  }
  // far right of a cell with text: its end
  const b = (await page.locator('.block.tr').nth(1).locator(':scope > .td').nth(0).boundingBox())!;
  await page.mouse.click(b.x + b.width - 3, b.y + b.height / 2);
  expect(await caret(page)).toEqual([2, 2]);
});

test('there is no line between the header and the rows to click into', async ({ page }) => {
  await table(page);
  const head = (await page.locator('.block.tr.thead').boundingBox())!;
  const row = (await page.locator('.block.tr').nth(1).boundingBox())!;
  expect(Math.abs(row.y - (head.y + head.height))).toBeLessThan(2);
  await page.mouse.click(head.x + 20, head.y + head.height);
  expect([1, 2]).toContain(await ed(page, (e) => e.b));
  expect(await ed(page, (e) => e.cellAt(e.b, e.o))).toBeGreaterThanOrEqual(0);
});

// ── selecting cells ──

test('a selection from one cell into another selects whole cells, and delete empties them', async ({ page }) => {
  await table(page);
  await page.keyboard.press('ArrowDown'); // in "1"
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.td.csel')).toHaveCount(4);
  await page.keyboard.press('Delete');
  expect(await view(page)).toEqual(['Above', 'H a | b', '   | ', '   | ', 'Below']);
});

test('only the cells between the ends are selected (rows by columns)', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Tab'); // "b"
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  const cs = await ed(page, (e) => e.cellSelection);
  expect(cs.cols).toEqual([1, 1]);
  await page.keyboard.press('Backspace');
  expect(await view(page)).toEqual(['Above', 'H a | ', '  1 | ', '  3 | ', 'Below']);
});

test('typing over selected cells empties them and types in the first', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Shift+ArrowDown');
  await type(page, 'Z');
  expect(await view(page)).toEqual(['Above', 'H Z | b', '   | 2', '  3 | 4', 'Below']);
});

test('a drag from one cell to another selects cells, not the walls between', async ({ page }) => {
  await table(page);
  const a = (await page.locator('.block.tr').nth(1).locator(':scope > .td').nth(0).boundingBox())!;
  const z = (await page.locator('.block.tr').nth(2).locator(':scope > .td').nth(1).boundingBox())!;
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.td.csel')).toHaveCount(4);
  expect(await page.locator('.selrect').count()).toBe(0);
});

test('a selection within one cell is ordinary text', async ({ page }) => {
  await table(page);
  await page.keyboard.press('ArrowDown');
  await type(page, 'bcd');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('.td.csel')).toHaveCount(0);
  expect(await selected(page)).toBe('cd');
});

test('copied cells paste as a markdown table', async ({ page }) => {
  await table(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const copied = await page.evaluate(() => {
    let out = '';
    const ev = { clipboardData: { setData: (_: string, t: string) => (out = t) }, preventDefault() {} };
    (window as any).__nx.ed.copy(ev, false);
    return out;
  });
  expect(copied).toBe('| 1 | 2 |\n| --- | --- |\n| 3 | 4 |');
});

// ── around a table ──

test('a selection from the text above into the table: the text goes, its cells empty, nothing joins', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  expect(await view(page)).toEqual(['A', 'H  | ', '  1 | 2', '  3 | 4', 'Below']);
});

test('a selection over the whole table and around it takes the table too', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Control+End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Delete');
  expect(await view(page)).toEqual(['AboveBelow']);
});

test('backspace after a table and delete before one join nothing', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  expect(await view(page)).toEqual(['Above', 'H a | b', '  1 | 2', '  3 | 4', 'Below']);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  expect(await view(page)).toEqual(['Above', 'H a | b', '  1 | 2', '  3 | 4', 'Below']);
});

test('alt+arrows: rows within the body, the header moves the table, lines go past it', async ({ page }) => {
  await table(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp'); // in "3"
  await page.keyboard.press('Alt+ArrowUp');
  expect((await view(page)).slice(1, 4)).toEqual(['H a | b', '  3 | 4', '  1 | 2']);
  await page.keyboard.press('Alt+ArrowUp');
  expect((await view(page)).slice(1, 4)).toEqual(['H a | b', '  3 | 4', '  1 | 2']);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Alt+ArrowDown');
  expect(await view(page)).toEqual(['H a | b', '  3 | 4', '  1 | 2', 'Above', 'Below']);
});

test('pasting lines into a cell makes one line; a pasted table adds rows', async ({ page }) => {
  await table(page);
  await page.keyboard.press('ArrowDown');
  await paste(page, 'one\ntwo | three');
  expect((await view(page))[2]).toBe('  one two | three1 | 2');
  await page.keyboard.press('Control+z');
  await paste(page, '| x | y |\n| - | - |\n| 5 | 6 |');
  expect((await view(page)).slice(1, 6)).toEqual(['H a | b', '  1 | 2', '  x | y', '  5 | 6', '  3 | 4']);
});

// ── commands ──

test('rows and columns added and removed, columns aligned', async ({ page }) => {
  await table(page);
  const run = async (name: string) => {
    await type(page, '\\' + name);
    await page.keyboard.press('Enter');
  };
  await run('addcolumn');
  expect(await view(page)).toEqual(['Above', 'H a |  | b', '  1 |  | 2', '  3 |  | 4', 'Below']);
  await run('deletecolumn');
  expect(await view(page)).toEqual(['Above', 'H a | b', '  1 | 2', '  3 | 4', 'Below']);
  await page.keyboard.press('ArrowDown');
  await run('deleterow');
  expect(await view(page)).toEqual(['Above', 'H a | b', '  3 | 4', 'Below']);
  await run('aligncenter');
  expect(await ed(page, (e) => e.doc.blocks[1].aligns)).toEqual(['center', null]);
  await expect(page.locator('.block.tr').nth(1).locator(':scope > .td').first()).toHaveCSS('text-align', 'center');
});

// ── outside the editor ──

test('kept and opened again, a table is the same table (with a typed |)', async ({ page }) => {
  await table(page);
  await page.keyboard.press('End');
  await type(page, ' | x');
  await expect.poll(() => ed(page, (e) => e.dirty)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await view(page)).toEqual(['Above', 'H a | x | b', '  1 | 2', '  3 | 4', 'Below']);
});

test('LaTeX export makes it a tabular', async ({ page }) => {
  await table(page);
  const tex: string = await page.evaluate(() => (window as any).__nx.tex());
  expect(tex).toContain(String.raw`\begin{tabular}{l l}`);
  expect(tex).toContain(String.raw`a & b \\ \hline`);
  expect(tex).toContain(String.raw`3 & 4 \\`);
});

test('the welcome note has a table, with formulas in it, columns lined up', async ({ page }) => {
  await page.evaluate(() => (window as any).__nx.ed.openWelcome());
  await expect(page.locator('.block.tr')).toHaveCount(4);
  expect(await page.locator('.block.tr .math .katex').count()).toBe(3);
  const second = await page.locator('.block.tr').evaluateAll((rows) => rows.map((r) => Math.round(r.querySelectorAll(':scope > .td')[1].getBoundingClientRect().left)));
  expect(new Set(second).size).toBe(1);
});

test('an arrow can go from one cell to another', async ({ page }) => {
  await table(page);
  const a = (await page.locator('.block.tr .ch', { hasText: '1' }).first().boundingBox())!;
  const b = (await page.locator('.block.tr .ch', { hasText: '4' }).first().boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await ed(page, (e) => e.doc.arrows.length)).toBe(1);
});

test('right-click in a table: its rows, columns and alignment', async ({ page }) => {
  await table(page);
  const cell = (await page.locator('.block.tr').nth(1).locator(':scope > .td').nth(1).boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2, { button: 'right' });
  await expect(page.locator('.dmenu')).toBeVisible();
  await page.locator('.dmenu .opt', { hasText: 'add a column after this one' }).click();
  expect(await view(page)).toEqual(['Above', 'H a | b | ', '  1 | 2 | ', '  3 | 4 | ', 'Below']);
});

test('tab outside a table still nests list items', async ({ page }) => {
  await type(page, '- item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  expect(await ed(page, (e) => e.doc.blocks[1].indent)).toBe(1);
});
