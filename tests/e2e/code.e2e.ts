// Code blocks are coloured by their language, live as you type.
import { test, expect, open, fresh, type, ed } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Start a code block in `lang` and type its lines. */
async function codeBlock(page: Page, lang: string, lines: string[]) {
  await type(page, '```' + lang);
  await page.keyboard.press('Enter');
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Enter');
    await type(page, lines[i]);
  }
}

/** The kind of token of each character of a run of text in the note (its first occurrence). */
function kindsOf(page: Page, s: string): Promise<(string | null)[]> {
  return page.evaluate((s) => {
      const e = (window as any).__nx.ed;
      for (const b of e.doc.blocks) {
        const line = b.items.map((i: any) => (i.t === 'c' ? i.ch : '￼')).join('');
        const at = line.indexOf(s);
        if (at < 0) continue;
        return b.items.slice(at, at + s.length).map((i: any) => document.querySelector(`[data-nx="${i.id}"]`)?.getAttribute('data-tk') ?? null);
      }
      throw new Error(`no "${s}"`);
    }, s);
}
const all = (kinds: (string | null)[], k: string | null) => kinds.every((x) => x === k);

test('python is coloured as it is typed', async ({ page }) => {
  await codeBlock(page, 'py', ['def area(r):', '    return 3.14 * r ** 2  # circle']);
  expect(all(await kindsOf(page, 'def'), 'kw')).toBe(true);
  expect(all(await kindsOf(page, 'return'), 'kw')).toBe(true);
  expect(all(await kindsOf(page, 'area'), 'fn')).toBe(true);
  expect(all(await kindsOf(page, '3.14'), 'num')).toBe(true);
  expect(all(await kindsOf(page, '# circle'), 'com')).toBe(true);
  // and the colours differ from plain text
  const kw = await page.locator('.ch[data-tk="kw"]').first().evaluate((e) => getComputedStyle(e).color);
  const plain = await page.locator('.block.code .ch:not([data-tk])').first().evaluate((e) => getComputedStyle(e).color);
  expect(kw).not.toBe(plain);
});

test('a word becomes a keyword when it is finished', async ({ page }) => {
  await codeBlock(page, 'py', ['retur']);
  expect(all(await kindsOf(page, 'retur'), 'kw')).toBe(false);
  await type(page, 'n');
  expect(all(await kindsOf(page, 'return'), 'kw')).toBe(true);
});

test('a string over several lines is coloured on every line', async ({ page }) => {
  await codeBlock(page, 'python', ['s = """first', 'second"""', 'x = 1']);
  expect(all(await kindsOf(page, 'first'), 'str')).toBe(true);
  expect(all(await kindsOf(page, 'second'), 'str')).toBe(true);
  expect(all(await kindsOf(page, '1'), 'num')).toBe(true);
});

test('other languages: c++, julia, matlab', async ({ page }) => {
  await codeBlock(page, 'cpp', ['template <typename T> T sq(T x) { return x * x; }']);
  expect(all(await kindsOf(page, 'template'), 'kw')).toBe(true);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await codeBlock(page, 'julia', ['function f(x) x^2 end']);
  expect(all(await kindsOf(page, 'function'), 'kw')).toBe(true);
});

test('changing the language on the fence colours it again', async ({ page }) => {
  await codeBlock(page, 'text', ['def f(): pass']);
  expect(all(await kindsOf(page, 'def'), null)).toBe(true);
  // edit the fence: ```text → ```py
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('End');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await type(page, 'py');
  expect(all(await kindsOf(page, 'def'), 'kw')).toBe(true);
});

test('no colours without a language, or for one it does not know', async ({ page }) => {
  await codeBlock(page, '', ['def f(): return 1']);
  expect(all(await kindsOf(page, 'def'), null)).toBe(true);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await codeBlock(page, 'brainfuck', ['def g(): return 2']);
  expect(all(await kindsOf(page, 'g()'), null)).toBe(true);
});

test('ordinary text is never coloured', async ({ page }) => {
  await type(page, 'def return import while');
  expect(await page.locator('.ch[data-tk]').count()).toBe(0);
});

test('code colours can be turned off in the settings', async ({ page }) => {
  await codeBlock(page, 'py', ['def f(): pass']);
  expect(await page.locator('.ch[data-tk]').count()).toBeGreaterThan(0);
  await page.keyboard.press('Control+,');
  await page.locator('.scrim .row', { has: page.locator('.label', { hasText: /^code colours$/ }) }).click();
  await page.keyboard.press('Escape');
  expect(await page.locator('.ch[data-tk]').count()).toBe(0);
  expect(await ed(page, (e) => e.config.highlightCode)).toBe(false);
});

test('a theme can set the colours', async ({ page }) => {
  await page.evaluate(() =>
    (window as any).__nx.ed.updateConfig({ theme: 'mine', themes: { mine: { base: 'midnight', colors: { 'code-kw': 'rgb(255, 0, 255)' } } } }),
  );
  await codeBlock(page, 'py', ['def f(): pass']);
  const kw = await page.locator('.ch[data-tk="kw"]').first().evaluate((e) => getComputedStyle(e).color);
  expect(kw).toBe('rgb(255, 0, 255)');
});

test("the welcome note's code block is coloured", async ({ page }) => {
  await page.evaluate(() => (window as any).__nx.ed.openWelcome());
  await expect.poll(() => page.locator('.block.code .ch[data-tk="kw"]').count()).toBeGreaterThan(0);
});

test('the colours are printed too', async ({ page }) => {
  await codeBlock(page, 'py', ['def f(): pass']);
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  await page.emulateMedia({ media: 'print' });
  const kw = await page.locator('.ch[data-tk="kw"]').first().evaluate((e) => getComputedStyle(e).color);
  const plain = await page.locator('.block.code .ch:not([data-tk])').first().evaluate((e) => getComputedStyle(e).color);
  expect(kw).not.toBe(plain);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});
