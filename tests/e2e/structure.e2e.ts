// Structure for lecture notes: boxes to tick, theorem boxes and quotes, numbered formulas and
// references to them, links, folding and the outline, find and replace, struck and
// highlighted text.
import { test, expect, open, fresh, type, text, kinds, ed, rectOfText, saved } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Run a text command from the palette. */
async function command(page: Page, name: string) {
  await type(page, B + name);
  await page.keyboard.press('Enter');
}

type Seen = { kind: string; check?: boolean; box: string | null; fold: boolean };
const blocks = (page: Page): Promise<Seen[]> => ed(page, (e) => e.doc.blocks.map((b: any) => ({ kind: b.kind, check: b.check, box: b.box?.k ?? null, fold: !!b.fold })));

test.describe('struck and highlighted text', () => {
  test('~~ and == around words strike them out and highlight them', async ({ page }) => {
    await type(page, 'a ~~no~~ and ==yes== b');
    await page.keyboard.press('Home');
    await expect(page.locator('.ch.s')).toHaveCount(2);
    await expect(page.locator('.ch.hl')).toHaveCount(3);
  });
  test('ctrl+shift+x and ctrl+shift+h put the markers round a selection', async ({ page }) => {
    await type(page, 'one two');
    await page.keyboard.press('Shift+Control+ArrowLeft');
    await page.keyboard.press('Control+Shift+x');
    expect(await text(page)).toBe('one ~~two~~');
    await page.keyboard.press('Control+Shift+h');
    expect(await text(page)).toBe('one ~~==two==~~');
  });
});

test.describe('boxes to tick', () => {
  test('- [ ] starts one, Enter goes on with another, unticked', async ({ page }) => {
    await type(page, '- [ ] milk\neggs');
    expect(await text(page)).toBe('milk\neggs');
    expect((await blocks(page)).map((b) => [b.kind, b.check])).toEqual([['li', false], ['li', false]]);
    await expect(page.locator('.tick')).toHaveCount(2);
  });
  test('[x] starts a ticked one; ctrl+enter ticks and unticks; a click on the box too', async ({ page }) => {
    await type(page, '[x] done\n[] open');
    expect((await blocks(page)).map((b) => b.check)).toEqual([true, false]);
    await page.keyboard.press('Control+Enter');
    expect((await blocks(page)).map((b) => b.check)).toEqual([true, true]);
    await page.locator('.tick').first().click();
    expect((await blocks(page)).map((b) => b.check)).toEqual([false, true]);
    // (the caret stayed where it was)
    expect(await ed(page, (e) => e.b)).toBe(1);
    await page.keyboard.press('Control+z');
    expect((await blocks(page)).map((b) => b.check)).toEqual([true, true]);
  });
  test('a ticked item is struck through', async ({ page }) => {
    await type(page, '[x] done');
    await expect(page.locator('.block.done')).toHaveCount(1);
  });
  test('Enter on an empty one ends the list; Backspace at its start takes the box away first', async ({ page }) => {
    await type(page, '[ ] a\n');
    await page.keyboard.press('Enter');
    expect((await blocks(page)).map((b) => [b.kind, b.check])).toEqual([['li', false], ['p', undefined]]);
    await page.keyboard.press('Backspace');
    await type(page, '\n[ ] b');
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    expect((await blocks(page)).at(-1)).toMatchObject({ kind: 'li', check: undefined });
    await page.keyboard.press('Backspace');
    expect((await blocks(page)).at(-1)).toMatchObject({ kind: 'p' });
  });
  test('kept with the note', async ({ page }) => {
    await type(page, '[x] kept\n[ ] too');
    await saved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__nx);
    expect((await blocks(page)).map((b) => b.check)).toEqual([true, false]);
  });
});

test.describe('boxes: theorems, proofs, quotes', () => {
  test('\\theorem makes the line a numbered box; Enter goes on in it; Enter on an empty line leaves it', async ({ page }) => {
    await command(page, 'theorem');
    await type(page, 'Let x.\nThen y.\n');
    await page.keyboard.press('Enter');
    await type(page, 'after');
    expect((await blocks(page)).map((b) => b.box)).toEqual(['theorem', 'theorem', null]);
    await expect(page.locator('.boxhead')).toHaveText(['Theorem 1.']);
  });
  test('theorems, lemmas and definitions count together; proofs and quotes are not numbered', async ({ page }) => {
    await command(page, 'theorem');
    await type(page, 'one\n\n');
    await command(page, 'definition');
    await type(page, 'two\n\n');
    await command(page, 'proof');
    await type(page, 'three\n\n');
    await command(page, 'lemma');
    await type(page, 'four');
    await expect(page.locator('.boxhead')).toHaveText(['Theorem 1.', 'Definition 2.', 'Proof.', 'Lemma 3.']);
    await expect(page.locator('.qed')).toHaveCount(1);
  });
  test('the same command again takes the line out of its box; another kind changes the whole box', async ({ page }) => {
    await command(page, 'theorem');
    await type(page, 'a\nb');
    await command(page, 'lemma');
    expect((await blocks(page)).map((b) => b.box)).toEqual(['lemma', 'lemma']);
    await command(page, 'lemma');
    expect((await blocks(page)).map((b) => b.box)).toEqual(['lemma', null]);
  });
  test('> at a line’s start makes a quote, joining one just above; Backspace at its start leaves it', async ({ page }) => {
    await type(page, '> said\n');
    await page.keyboard.press('Enter');
    await type(page, '> more');
    expect(await text(page)).toBe('said\nmore');
    const ids = await ed(page, (e) => e.doc.blocks.map((b: any) => b.box?.id ?? null));
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    // its first line out of it: the rest stays a quote
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    expect((await blocks(page)).map((b) => b.box)).toEqual([null, 'quote']);
  });
  test('kept with the note', async ({ page }) => {
    await command(page, 'example');
    await type(page, 'kept');
    await saved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__nx);
    await expect(page.locator('.boxhead')).toHaveText(['Example 1.']);
  });
});

test.describe('numbered formulas and references', () => {
  /** A display formula of `keys`, then back to a new line of text. */
  async function display(page: Page, keys: string) {
    await type(page, '$$');
    await type(page, keys);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
  }

  test('\\ref lists what can be referred to; picking a formula numbers it and puts (1) here', async ({ page }) => {
    await display(page, 'E=mc^2');
    await type(page, '\nby ');
    await command(page, 'ref');
    await expect(page.locator('.palette .opt .name').first()).toHaveText('formula');
    await page.keyboard.press('Enter');
    await expect(page.locator('.eqn')).toHaveText('(1)');
    await expect(page.locator('.math.ref')).toHaveText('(1)');
    // the caret is after it, in the text
    await type(page, ' done');
    expect((await text(page)).split('\n').at(-1)).toMatch(/^by \$.*\$ done$/);
  });
  test('a reference follows its formula’s number as formulas come and go', async ({ page }) => {
    await display(page, 'a');
    await type(page, '\n');
    await command(page, 'ref');
    await page.keyboard.press('Enter');
    await expect(page.locator('.math.ref')).toHaveText('(1)');
    // a numbered formula before it
    await page.keyboard.press('Control+Home');
    await display(page, 'b');
    // (on the new formula's line)
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await command(page, 'number');
    await expect(page.locator('.eqn')).toHaveText(['(1)', '(2)']);
    await expect(page.locator('.math.ref')).toHaveText('(2)');
  });
  test('a reference to a theorem says Theorem 1; ctrl+click goes there; arrows step over it', async ({ page }) => {
    await command(page, 'theorem');
    await type(page, 'big\n\n');
    await type(page, 'see ');
    await command(page, 'ref');
    await type(page, 'theorem');
    await page.keyboard.press('Enter');
    await expect(page.locator('.math.ref')).toHaveText('Theorem 1');
    await type(page, '.');
    // ← steps over it as one thing (no formula to edit)
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await ed(page, (e) => [e.mode, e.o])).toEqual(['text', 4]);
    const r = await page.locator('.math.ref').boundingBox();
    await page.keyboard.down('Control');
    await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height / 2);
    await page.keyboard.up('Control');
    expect(await ed(page, (e) => [e.b, e.mode])).toEqual([0, 'text']);
  });
  test('Backspace takes a reference away whole', async ({ page }) => {
    await display(page, 'a');
    await type(page, '\n');
    await command(page, 'ref');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    expect(await ed(page, (e) => [e.mode, e.blk.items.length])).toEqual(['text', 0]);
  });
});

test.describe('links', () => {
  test('a web address is a link; ctrl+click opens it', async ({ page }) => {
    await page.evaluate(() => ((window as any).opened = [], (window.open = ((u: string) => ((window as any).opened.push(u), null)) as any)));
    await type(page, 'see https://example.com/x. ok');
    await expect(page.locator('.ch.ln')).toHaveCount('https://example.com/x'.length);
    const r = await rectOfText(page, 'example');
    await page.keyboard.down('Control');
    await page.mouse.click(r.cx, r.cy);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => (window as any).opened)).toEqual(['https://example.com/x']);
  });
  test('[[a note]] opens that note (a new one when there is none yet)', async ({ page }) => {
    await type(page, 'go to [[Fourier]] now');
    await page.keyboard.press('Home');
    await expect(page.locator('.ch.ln')).toHaveCount(7);
    const r = await rectOfText(page, 'Fourier');
    await page.keyboard.down('Control');
    await page.mouse.click(r.cx, r.cy);
    await page.keyboard.up('Control');
    await expect.poll(() => ed(page, (e) => e.file.name)).toBe('Fourier');
    expect(await text(page)).toBe('# Fourier\n');
  });
});

test.describe('folding and the outline', () => {
  async function sections(page: Page) {
    await type(page, '# One\na\nb\n## Sub\nc\n# Two\nd');
  }
  test('ctrl+. folds the section under a heading (its subsections too); again, unfolds it', async ({ page }) => {
    await sections(page);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Control+.');
    expect((await blocks(page)).map((b) => b.fold)).toEqual([true, false, false, false, false, false, false]);
    await expect(page.locator('.block.folded')).toHaveCount(4);
    await expect(page.locator('.foldinfo')).toHaveText('⋯ 4 lines');
    // ↓ from the heading goes past what's folded
    await page.keyboard.press('ArrowDown');
    expect(await ed(page, (e) => e.b)).toBe(5);
    await page.keyboard.press('ArrowUp');
    expect(await ed(page, (e) => e.b)).toBe(0);
    await page.keyboard.press('Control+.');
    await expect(page.locator('.block.folded')).toHaveCount(0);
  });
  test('Enter at the end of a folded heading unfolds it, the new line first in its section', async ({ page }) => {
    await sections(page);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Control+.');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'new');
    expect((await text(page)).split('\n')).toEqual(['# One', 'new', 'a', 'b', '## Sub', 'c', '# Two', 'd']);
    await expect(page.locator('.block.folded')).toHaveCount(0);
  });
  test('the fold mark folds with the mouse; a folded section stays folded in the file', async ({ page }) => {
    await sections(page);
    await page.locator('.foldbtn').first().dispatchEvent('mousedown', { button: 0 });
    await expect(page.locator('.block.folded')).toHaveCount(4);
    await saved(page);
    await page.reload();
    await page.waitForFunction(() => (window as any).__nx);
    await expect(page.locator('.block.folded')).toHaveCount(4);
  });
  test('find unfolds what it finds', async ({ page }) => {
    await sections(page);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Control+.');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('c');
    await expect(page.locator('.block.folded')).toHaveCount(0);
  });
  test('ctrl+shift+o shows the outline: headings and theorems; a click goes there', async ({ page }) => {
    await sections(page);
    await page.keyboard.press('Enter');
    await command(page, 'theorem');
    await type(page, 'big');
    await page.keyboard.press('Control+Shift+O');
    await expect(page.locator('.outline .item .text')).toHaveText(['One', 'Sub', 'Two', 'Theorem 1 · big']);
    await page.locator('.outline .item', { hasText: 'Sub' }).dispatchEvent('mousedown');
    expect(await ed(page, (e) => [e.b, e.o])).toEqual([3, 0]);
    await expect(page.locator('.outline .item.here')).toHaveText(/Sub/);
    await page.keyboard.press('Control+Shift+O');
    await expect(page.locator('.outline')).toHaveCount(0);
  });
});

test.describe('find and replace', () => {
  test('ctrl+h: Enter replaces the match and goes to the next; ctrl+alt+enter replaces them all', async ({ page }) => {
    await type(page, 'cat and cat\ncat');
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Control+h');
    await page.keyboard.type('cat');
    await page.locator('.findbar .with input').fill('dog');
    await page.locator('.findbar .with input').press('Enter');
    expect(await text(page)).toBe('dog and cat\ncat');
    await page.locator('.findbar .with input').press('Control+Alt+Enter');
    expect(await text(page)).toBe('dog and dog\ndog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    expect(await text(page)).toBe('dog and cat\ncat');
  });
});

test('the notes list finds notes by what they say, shows the line, and opening one finds it there', async ({ page }) => {
  await type(page, 'first note\nthe Parseval identity holds');
  await saved(page);
  await page.keyboard.press('Control+n');
  await type(page, 'second note');
  await saved(page);
  await page.keyboard.press('Control+o');
  await page.keyboard.type('parseval');
  await expect(page.locator('.panel .row .snippet')).toHaveText('the Parseval identity holds');
  await expect(page.locator('.panel .row .snippet .hit')).toHaveText('Parseval');
  await page.keyboard.press('Enter');
  await expect.poll(() => text(page)).toBe('first note\nthe Parseval identity holds');
  await expect(page.locator('.findbar input').first()).toHaveValue('parseval');
  expect(await ed(page, (e) => [e.b, e.anchor?.o, e.o])).toEqual([1, 4, 12]);
});

test('every kind of block survives an undo and redo', async ({ page }) => {
  await command(page, 'theorem');
  await type(page, 'a\n\n[ ] b');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  expect(await kinds(page)).toEqual(['p', 'li']);
});
