import { test, expect, open, fresh, type, text, kinds, ed } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

test('plain text, undo and redo', async ({ page }) => {
  await type(page, 'Lecture 3: groups');
  expect(await text(page)).toBe('Lecture 3: groups');
  await page.keyboard.press('Enter');
  await type(page, 'second line');
  expect(await text(page)).toBe('Lecture 3: groups\nsecond line');
  await page.keyboard.press('Control+z');
  expect(await text(page)).not.toContain('second line');
  await page.keyboard.press('Control+y');
  expect(await text(page)).toBe('Lecture 3: groups\nsecond line');
});

test('headings, bullets, numbered lists and nesting', async ({ page }) => {
  await type(page, '# Title');
  await page.keyboard.press('Enter');
  await type(page, '## Section');
  await page.keyboard.press('Enter');
  await type(page, '- first');
  await page.keyboard.press('Enter');
  await type(page, 'second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await type(page, 'nested');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await type(page, 'back out');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // an empty item ends the list
  expect((await kinds(page)).at(-1)).toBe('p');
  await type(page, '1. one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  expect(await kinds(page)).toEqual(['h1', 'h2', 'li', 'li', 'li:1', 'li', 'ol', 'ol']);
  // numbers are counted on
  const nums = await page.locator('.block.ol').evaluateAll((els) => els.map((e) => e.getAttribute('data-n')));
  expect(nums).toEqual(['1', '2']);
});

test('markdown: bold, italic and code, markers hidden away from the caret', async ({ page }) => {
  await type(page, 'a **bold** and *slanted* and `code` word');
  await page.keyboard.press('Home');
  const styles = await ed(page, (e) => {
    const items = e.doc.blocks[0].items;
    const run = (s: string) => {
      const line = items.map((i: any) => i.ch).join('');
      const at = line.indexOf(s);
      return items.slice(at, at + s.length);
    };
    return { b: run('bold').every((i: any) => i.b), i: run('slanted').every((i: any) => i.i), c: run('code').every((i: any) => i.c) };
  });
  expect(styles).toEqual({ b: true, i: true, c: true });
  // the caret is at the start: no markers on screen
  await expect(page.locator('.ch.mk:visible')).toHaveCount(0);
  // next to "bold": its markers show
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ch.mk:visible')).toHaveCount(4);
  await expect(page.locator('.ch.b').first()).toHaveCSS('font-weight', '700');
});

test('the markers at the caret still show when room is made under them for a drawing', async ({ page }) => {
  await type(page, 'a **bold** word');
  await page.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ch.mk:visible')).toHaveCount(4);
  // room after the first marker, as a note under it would make (the marker is drawn afresh)
  await ed(page, (e) => {
    const star = e.doc.blocks[0].items.find((i: any) => i.ch === '*');
    e.setRoom({ ...e.room, [star.id]: { below: 0 } });
  });
  await expect(page.locator('.nx-sp.below')).toHaveCount(1);
  await expect(page.locator('.ch.mk:visible')).toHaveCount(4);
});

test('brackets and quotes come in pairs, and backspace takes both', async ({ page }) => {
  await type(page, 'f(x');
  expect(await text(page)).toBe('f(x)');
  await type(page, ')');
  expect(await text(page)).toBe('f(x)');
  await type(page, ' (');
  expect(await text(page)).toBe('f(x) ()');
  await page.keyboard.press('Backspace');
  expect(await text(page)).toBe('f(x) ');
  await type(page, '"hi');
  expect(await text(page)).toBe('f(x) "hi"');
});

test('ctrl+b with a selection makes it bold', async ({ page }) => {
  await type(page, 'make this bold');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+b');
  const bold = await ed(page, (e) => e.doc.blocks[0].items.filter((i: any) => i.b && !i.m).map((i: any) => i.ch).join(''));
  expect(bold).toBe('bold');
});

test('find highlights every match and moves between them', async ({ page }) => {
  await type(page, 'one fish two fish');
  await page.keyboard.press('Enter');
  await type(page, 'red fish');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('fish');
  await expect(page.locator('.findhit')).toHaveCount(3);
  await expect(page.locator('.findbar .count')).toHaveText('1/3');
  await page.keyboard.press('Enter');
  await expect(page.locator('.findbar .count')).toHaveText('2/3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.findbar')).toHaveCount(0);
});

test('alt+up moves a paragraph up', async ({ page }) => {
  await type(page, 'first');
  await page.keyboard.press('Enter');
  await type(page, 'second');
  await page.keyboard.press('Alt+ArrowUp');
  expect(await text(page)).toBe('second\nfirst');
});

test('a click and then backspace takes one character, and leaves nothing selected', async ({ page }) => {
  await type(page, 'hello world');
  const box = (await page.locator('.ch').nth(5).boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
  await page.keyboard.press('Backspace');
  expect(await text(page)).toBe('hell world');
  expect(await ed(page, (e) => e.selection)).toBeNull();
  await page.keyboard.press('Delete');
  expect(await text(page)).toBe('hellworld');
});
