// Taking back a substitution: Backspace (or Ctrl+Z) right after one puts back just what was
// typed (`xx` stays xx, `a/` a slash, `- ` the dash and space); anything else typed, or the
// caret moved, and Backspace is Backspace again. And the palette's \slash, \dollar, \backslash.
import { test, expect, open, fresh, type, text, kinds, formulas, ed } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);
const mode = (page: Page) => ed(page, (e) => e.mode);
/** Each formula's LaTeX, without spaces. */
const tex = async (page: Page) => (await formulas(page)).map((f) => f.replace(/\s+/g, ''));

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Every group of substitutions on (most are off at first: xx, pi, int…). */
const allSubstitutions = (page: Page) =>
  ed(page, (e) => e.updateConfig({ typing: { ...e.config.typing, substitutions: Object.fromEntries(Object.keys(e.config.typing.substitutions).map((k) => [k, true])) } }));

test('in math, backspace after xx, pi or int puts the letters back, and more letters stay letters', async ({ page }) => {
  await allSubstitutions(page);
  await type(page, '$xx');
  expect(await tex(page)).toEqual([String.raw`\times`]);
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toEqual(['xx']);
  await type(page, 'x');
  expect(await tex(page)).toEqual(['xxx']);
  await type(page, ' + pi');
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toEqual(['xxx+pi']);
  await type(page, ' + int');
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toEqual(['xxx+pi+int']);
  expect(await mode(page)).toBe('math');
});

test('in math, backspace after a/ makes it a slash: a/b on the line', async ({ page }) => {
  await type(page, '$a/');
  expect(await tex(page)).toEqual([String.raw`\frac{a}{}`]);
  await page.keyboard.press('Backspace');
  await type(page, 'b');
  expect(await tex(page)).toEqual(['a/b']);
});

test('ctrl+z takes the substitution back first, then the typing', async ({ page }) => {
  await allSubstitutions(page);
  await type(page, 'Let $xx');
  await page.keyboard.press('Control+z');
  expect(await tex(page)).toEqual(['xx']);
  await page.keyboard.press('Control+z');
  expect(await text(page)).not.toContain('xx');
});

test('only right after: once the caret moves or more is typed, backspace deletes as before', async ({ page }) => {
  await allSubstitutions(page);
  await type(page, '$xx');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Backspace');
  // (a replaced symbol steps back to its name less a letter, as it always has)
  expect(await tex(page)).toEqual(['x']);
  await type(page, ' + a/b');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  // (b, then the empty denominator: the fraction undone, as ever)
  expect(await tex(page)).toEqual(['x+a']);
});

test('brackets and scripts are taken away by backspace as ever (not made plain)', async ({ page }) => {
  await type(page, '$x^');
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toEqual(['x']);
  await type(page, '(');
  await page.keyboard.press('Backspace');
  expect(await tex(page)).toEqual(['x']);
});

test('in text, backspace after a snippet, a list or a quote puts back what was typed', async ({ page }) => {
  await type(page, 'a ->');
  expect(await text(page)).toBe('a →');
  await page.keyboard.press('Backspace');
  await type(page, ' b');
  expect(await text(page)).toBe('a -> b');
  await page.keyboard.press('Enter');
  await type(page, '- ');
  expect((await kinds(page))[1]).toBe('li');
  await page.keyboard.press('Backspace');
  expect((await kinds(page))[1]).toBe('p');
  await type(page, 'not a list');
  expect((await text(page)).split('\n')[1]).toBe('- not a list');
  await page.keyboard.press('Enter');
  await type(page, '> ');
  await page.keyboard.press('Backspace');
  expect(await ed(page, (e) => [e.blk.box ?? null, e.blk.items.map((i: any) => i.ch).join('')])).toEqual([null, '> ']);
});

test('in a sentence, backspace after x^ turned it into math leaves x^ as text', async ({ page }) => {
  await type(page, 'the x^');
  expect(await mode(page)).toBe('math');
  await page.keyboard.press('Backspace');
  expect(await mode(page)).toBe('text');
  await type(page, '2 key');
  expect(await text(page)).toBe('the x^2 key');
});

test('backspace after $ or $$ types them, for a price', async ({ page }) => {
  await type(page, 'costs $');
  expect(await mode(page)).toBe('math');
  await page.keyboard.press('Backspace');
  await type(page, '5');
  expect(await text(page)).toBe('costs $5');
  await page.keyboard.press('Enter');
  await type(page, '$$');
  await page.keyboard.press('Backspace');
  expect((await text(page)).split('\n')[1]).toBe('$$');
});

test('the palette types them on purpose: \\slash in math, \\dollar and \\backslash in text', async ({ page }) => {
  await type(page, 'a $x');
  await type(page, B + 'slash');
  await page.keyboard.press('Enter');
  await type(page, 'y');
  expect(await tex(page)).toEqual(['x/y']);
  await page.keyboard.press('Escape');
  await type(page, ' ' + B + 'dollar');
  await page.keyboard.press('Enter');
  await type(page, B + 'backslash');
  await page.keyboard.press('Enter');
  expect(await text(page)).toBe('a $x/y$ $' + B);
});
