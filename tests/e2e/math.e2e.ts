import { test, expect, open, fresh, type, text, formulas, ed } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Type a formula after $ and leave it with $. */
async function formula(page: import('@playwright/test').Page, keys: string) {
  await type(page, '$');
  await type(page, keys);
  await type(page, '$');
}

test('scripts take one thing, as in LaTeX', async ({ page }) => {
  await formula(page, 'x^2+1');
  expect(await formulas(page)).toEqual(['x^{2}+1']);
});

test('a slash makes a fraction of what came before', async ({ page }) => {
  await formula(page, 'a/b');
  expect(await formulas(page)).toEqual(['\\frac{a}{b}']);
});

test('brackets group a script and a numerator', async ({ page }) => {
  await formula(page, 'e^(-x^2/2)');
  expect(await formulas(page)).toEqual(['e^{-\\frac{x^{2}}{2}}']);
});

test('sums and integrals with limits', async ({ page }) => {
  await formula(page, '\\int_0^1 f(x) dx');
  await type(page, ' and ');
  await formula(page, '\\sum_(n=1)^\\infty  1/n^2');
  const [int, sum] = (await formulas(page)).map((f) => f.replace(/\s/g, ''));
  expect(int).toMatch(/^\\int_\{0\}\^\{1\}/);
  expect(sum).toMatch(/^\\sum_\{n=1\}\^\{\\infty\}/);
  expect(sum).toContain('\\frac{1}{n^{2}}');
});

test('\\int comes with empty limits to fill (space: lower, upper, on); \\intop is bare', async ({ page }) => {
  await formula(page, '\\int 0 1 f(x) dx');
  await type(page, ' and ');
  await formula(page, '\\sum n=1 \\infty  a_n');
  await type(page, ' and ');
  await formula(page, '\\intop f');
  const [int, sum, bare] = (await formulas(page)).map((f) => f.replace(/\s/g, ''));
  expect(int).toMatch(/^\\int_\{0\}\^\{1\}f/);
  expect(sum).toMatch(/^\\sum_\{n=1\}\^\{\\infty\}a_\{n\}/);
  expect(bare).toBe('\\intf');
});

test('greek letters by name', async ({ page }) => {
  await formula(page, '\\alpha +\\beta ');
  expect((await formulas(page))[0].replace(/\s/g, '')).toBe('\\alpha+\\beta');
});

test('text keeps going after a formula', async ({ page }) => {
  await type(page, 'so ');
  await formula(page, 'x^2');
  await type(page, ' grows');
  expect(await text(page)).toBe('so $x^{2}$ grows');
});

test('$$ makes a display formula', async ({ page }) => {
  await type(page, '$$');
  await type(page, 'E=mc^2');
  await page.keyboard.press('Escape');
  const display = await ed(page, (e) => e.doc.blocks.flatMap((b: any) => b.items.filter((i: any) => i.t === 'm').map((m: any) => m.display)));
  expect(display).toEqual([true]);
  expect(await formulas(page)).toEqual(['E=mc^{2}']);
});

test('x^2 typed in a sentence becomes math by itself', async ({ page }) => {
  await type(page, 'the term a_n vanishes');
  expect(await text(page)).toBe('the term $a_{n}$ vanishes');
});

test('the formula renders without errors, with its caret while editing', async ({ page }) => {
  await type(page, '$');
  await type(page, '\\sqrt x');
  await expect(page.locator('.math .katex')).toHaveCount(1);
  await expect(page.locator('.math .nx-caret')).toHaveCount(1);
  await expect(page.locator('.nx-err')).toHaveCount(0);
  await type(page, '$');
  await expect(page.locator('.math .nx-caret')).toHaveCount(0);
});

test('LaTeX export has the formulas', async ({ page }) => {
  await type(page, 'Energy: ');
  await formula(page, 'E=mc^2');
  const tex = await page.evaluate(() => (window as any).__nx.tex());
  expect(tex).toContain('$E=mc^{2}$');
});
