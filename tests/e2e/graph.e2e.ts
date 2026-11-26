// Graphs of functions: \graph, or the g tool in a diagram; what to plot typed as its label.
import { test, expect, open, fresh, type, ed, saved } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

const plots = (page: Page) => ed(page, (e) => e.doc.blocks.flatMap((b: any) => (b.shapes ?? []).filter((s: any) => s.k === 'plot').map((s: any) => s.label ?? '')));

test('\\graph puts in a graph, what to plot to type; the curve shows as it is typed', async ({ page }) => {
  await type(page, B + 'graph');
  await page.keyboard.press('Enter');
  await expect(page.locator('.lbl-edit.plot textarea')).toBeFocused();
  await page.keyboard.type('y = x^2');
  await expect(page.locator('svg.canvas .pcurve')).toHaveCount(1);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('y = 2 - x');
  await page.keyboard.press('Enter');
  expect(await plots(page)).toEqual(['y = x^2\ny = 2 - x']);
  await expect(page.locator('svg.canvas .pcurve')).toHaveCount(4); // two curves, and their legend's lines
  await expect(page.locator('svg.canvas .plegend')).toHaveText(['y = x^2', 'y = 2 - x']);
});

test('the g tool draws a graph in a diagram', async ({ page }) => {
  await type(page, B + 'diagram');
  await page.keyboard.press('Enter');
  await page.keyboard.press('g');
  const c = (await page.locator('svg.canvas').boundingBox())!;
  await page.mouse.move(c.x + 60, c.y + 30);
  await page.mouse.down();
  await page.mouse.move(c.x + 300, c.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('sin x');
  await page.keyboard.press('Enter');
  expect(await plots(page)).toEqual(['sin x']);
  await expect(page.locator('svg.canvas .pcurve')).toHaveCount(1);
});

test('what isn’t a function says what’s wrong; an empty graph says what to do', async ({ page }) => {
  await type(page, B + 'graph');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('svg.canvas .phint')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('y = x +');
  await page.keyboard.press('Enter');
  await expect(page.locator('svg.canvas .perr')).toContainText('x +');
});

test('a graph is kept with the note', async ({ page }) => {
  await type(page, B + 'graph');
  await page.keyboard.press('Enter');
  await page.keyboard.type('cos x');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await saved(page);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await plots(page)).toEqual(['cos x']);
  await expect(page.locator('svg.canvas .pcurve')).toHaveCount(1);
});
