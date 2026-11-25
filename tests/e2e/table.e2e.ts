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

test('the separator is a line under the header; the arrows pass it, a click on it edits it', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  const sep = page.locator('.block.tr.tsep');
  const hidden = await sep.evaluate((e) => e.getBoundingClientRect().height);
  expect(hidden).toBeLessThan(8);
  await expect(page.locator('.block.tr.thead')).toHaveCSS('font-weight', '600');
  // down from the header: the first row, not the separator
  await page.keyboard.press('ArrowDown');
  expect(await ed(page, (e) => e.b)).toBe(2);
  await page.keyboard.press('ArrowUp');
  expect(await ed(page, (e) => e.b)).toBe(0);
  // a click on the line under the header: the separator, as text
  const box = (await sep.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
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

// ── the caret stays in the cells' text ──

/** A table: | ab | cd | over its separator, and a row | ef | gh |; the caret in "ab". */
async function smallTable(page: Page) {
  await type(page, '| ab | cd |');
  await page.keyboard.press('Enter');
  await type(page, '| - | - |');
  await page.keyboard.press('Enter');
  await type(page, '| ef | gh |');
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.block.tr')).toHaveCount(3);
}
const caret = (page: Page) => ed(page, (e) => [e.b, e.o]);
/** Where the caret may be in a tidy row: from after "| " to before " |", in each cell. */
const inCell = (row: string, o: number) => {
  const pipes = [...row].flatMap((c, i) => (c === '|' ? [i] : []));
  return pipes.slice(0, -1).some((p, k) => o >= p + 2 && o <= pipes[k + 1] - 1);
};

test('right and left step over the pipes and the spaces by them', async ({ page }) => {
  await smallTable(page);
  expect(await caret(page)).toEqual([0, 2]);
  const seen: number[][] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    seen.push(await caret(page));
  }
  // "| ab | cd |": a 2, b 3, end 4; c 7, d 8, end 9; then the next row (past the separator's line)
  expect(seen.slice(0, 5)).toEqual([[0, 3], [0, 4], [0, 7], [0, 8], [0, 9]]);
  const back: number[][] = [];
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowLeft');
    back.push(await caret(page));
  }
  // (end: the cell's end, 4; then b, a, and the table's start, where it stays)
  expect(back).toEqual([[0, 3], [0, 2], [0, 2], [0, 2]]);
  // the sixth step right went on past the separator, into the next row's first cell
  expect(seen[5]).toEqual([2, 2]);
  // from the second cell's start, left goes to the first cell's end
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect(await caret(page)).toEqual([0, 7]);
  await page.keyboard.press('ArrowLeft');
  expect(await caret(page)).toEqual([0, 4]);
});

test('home and end go to the cell\'s start and end', async ({ page }) => {
  await smallTable(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // in "cd"
  await page.keyboard.press('Home');
  expect(await caret(page)).toEqual([0, 7]);
  await page.keyboard.press('End');
  expect(await caret(page)).toEqual([0, 9]);
});

test('a click on a pipe or the space by it lands in a cell', async ({ page }) => {
  await smallTable(page);
  const row = (await text(page)).split('\n')[0];
  const pipes = page.locator('.block.tr').first().locator('.ch.pipe');
  for (let i = 0; i < 3; i++) {
    const box = (await pipes.nth(i).boundingBox())!;
    for (const dx of [0.2, 0.8]) {
      await page.mouse.click(box.x + box.width * dx, box.y + box.height / 2);
      const [b, o] = await caret(page);
      expect(b).toBe(0);
      expect(inCell(row, o), `pipe ${i} at ${dx}: ${o}`).toBe(true);
    }
  }
  // and the space just after a pipe
  const space = (await page.locator('.block.tr').first().locator('.ch').nth(1).boundingBox())!;
  await page.mouse.click(space.x + space.width / 2, space.y + space.height / 2);
  expect(inCell(row, (await caret(page))[1])).toBe(true);
});

test('backspace at a cell\'s start and delete at its end leave the table alone', async ({ page }) => {
  await smallTable(page);
  const before = await text(page);
  await page.keyboard.press('Backspace');
  expect(await text(page)).toBe(before);
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  expect(await text(page)).toBe(before);
  // inside the text they work as usual
  await page.keyboard.press('Backspace');
  expect((await text(page)).split('\n')[0]).toBe('| a | cd |');
});

test('a space can go between words in a cell, not before them', async ({ page }) => {
  await page.locator('.toolbar .b-table').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await type(page, ' two words');
  expect((await text(page)).split('\n')[2]).toBe('| two words |  |');
});

test('deleting a selection across cells empties them and keeps the columns', async ({ page }) => {
  await smallTable(page);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Backspace');
  const lines = (await text(page)).split('\n');
  expect(lines.every((l) => l.startsWith('|') && l.endsWith('|'))).toBe(true);
  expect(lines.map((l) => (l.match(/\|/g) ?? []).length)).toEqual([3, 3, 3]);
  await expect(page.locator('.block.tr')).toHaveCount(3);
});

test('typing over a selection across cells', async ({ page }) => {
  await smallTable(page);
  await page.keyboard.press('Shift+End');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await type(page, 'X');
  const first = (await text(page)).split('\n')[0];
  expect((first.match(/\|/g) ?? []).length).toBe(3);
  expect(first).toContain('X');
});

test('backspace on an empty last row takes the row away', async ({ page }) => {
  await smallTable(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.tr')).toHaveCount(4);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.block.tr')).toHaveCount(3);
  expect((await text(page)).split('\n')).toHaveLength(3);
});

test('a row typed out by hand comes out tidy', async ({ page }) => {
  await type(page, '|a|b|');
  await page.keyboard.press('Enter');
  await type(page, '|-|-|');
  await page.keyboard.press('Enter');
  await type(page, '|1   |  2|');
  await page.keyboard.press('Control+Home'); // (rows are tidied once the caret leaves them)
  expect((await text(page)).split('\n')).toEqual(['| a | b |', '| - | - |', '| 1 | 2 |']);
});

test('a row left without its closing pipe gets one', async ({ page }) => {
  await smallTable(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // a row as typed out by hand, without its closing |
  await page.evaluate(() => {
    const e = (window as any).__nx.ed;
    e.doc.blocks[e.b].items = [...'| x | y'].map((ch, i) => ({ t: 'c', ch, id: 'r' + i }));
    e.o = 7;
    e.touch();
  });
  await page.keyboard.press('ArrowUp');
  expect((await text(page)).split('\n')[3]).toBe('| x | y |');
});

test('undo takes back an edit in a cell, table intact', async ({ page }) => {
  await smallTable(page);
  await page.keyboard.press('End');
  await type(page, 'zz');
  expect((await text(page)).split('\n')[0]).toBe('| abzz | cd |');
  await page.keyboard.press('Control+z');
  expect((await text(page)).split('\n')[0]).toBe('| ab | cd |');
  await expect(page.locator('.block.tr')).toHaveCount(3);
});
