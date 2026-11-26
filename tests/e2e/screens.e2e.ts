// Smaller windows and what sits at the top: nothing out of reach or under something else
// (the drawing bar, menus, the find bar, the help), and menus that don't move under a
// still mouse.
import { test, expect, open, fresh, type, ed } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Is the element wholly in the window? */
const inWindow = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5;
  });

/** Does `a` overlap `b` (both visible)? */
const overlaps = (page: Page, a: string, b: string) =>
  page.evaluate(([a, b]) => {
    const r = document.querySelector(a)!.getBoundingClientRect(), q = document.querySelector(b)!.getBoundingClientRect();
    return r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom;
  }, [a, b]);

test('the find bar sits under the menu bar, and under the drawing bar while drawing', async ({ page }) => {
  await type(page, 'hello world');
  await page.keyboard.press('Control+f');
  await expect(page.locator('.findbar')).toBeVisible();
  expect(await overlaps(page, '.findbar', '.toolbar')).toBe(false);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+D');
  await page.keyboard.press('Control+f');
  expect(await overlaps(page, '.findbar', '.toolbar')).toBe(false);
  expect(await overlaps(page, '.findbar', '.sbar')).toBe(false);
});

test('a narrow window: the drawing bar wraps onto more rows, every button in it within the window', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 600 });
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.sbar')).toBeVisible();
  expect(await inWindow(page, '.sbar')).toBe(true);
  const out = await page.locator('.sbar button').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().right > window.innerWidth).length);
  expect(out).toBe(0);
});

test('a short window: a long menu stays within it (scrolling), over the menu bar', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 360 });
  await type(page, 'text');
  await page.mouse.click(650, 330, { button: 'right' });
  await expect(page.locator('.dmenu')).toBeVisible();
  expect(await inWindow(page, '.dmenu')).toBe(true);
  // (the menu over the bar, not under it)
  const top = await page.evaluate(() => {
    const r = document.querySelector('.dmenu')!.getBoundingClientRect();
    return document.elementFromPoint(r.left + 20, r.top + 6)?.closest('.dmenu') !== null;
  });
  expect(top).toBe(true);
});

test('a drawing’s bar near the window’s edge is moved in', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 600 });
  await type(page, 'a word at the end of the line here');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await type(page, B + 'box');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dbar')).toBeVisible();
  expect(await inWindow(page, '.dbar')).toBe(true);
});

test('a phone: the menu bar swipes; the help is one column', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 640 });
  const scrolls = await page.locator('.toolbar').evaluate((t) => t.scrollWidth > t.clientWidth && getComputedStyle(t).overflowX === 'auto');
  expect(scrolls).toBe(true);
  await page.keyboard.press('F1');
  const cols = await page.locator('.help .grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(1);
});

test('a heading’s long #s hang out no further than the window’s edge', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 600 });
  await type(page, '###### deep');
  await page.keyboard.press('Home');
  const left = await page.locator('.page > .block').first().locator('.ch').first().evaluate((c) => c.getBoundingClientRect().left);
  expect(left).toBeGreaterThanOrEqual(0);
});

test('the palette’s choice doesn’t move to what’s under a mouse that hasn’t moved', async ({ page }) => {
  await type(page, 'x ');
  // the mouse, still, where the palette's list will open
  const caret = (await page.locator('.caret').first().boundingBox())!;
  await page.mouse.move(caret.x + 60, caret.y + 90);
  await type(page, B);
  await expect(page.locator('.palette .opt').first()).toBeVisible();
  await page.waitForTimeout(100);
  expect(await ed(page, (e) => e.palette.sel)).toBe(0);
  // typing filters it, the list changing under the mouse: still the first
  await type(page, 'ma');
  await page.waitForTimeout(100);
  expect(await ed(page, (e) => e.palette.sel)).toBe(0);
  // the mouse moved over an item: that one
  const second = (await page.locator('.palette .opt').nth(1).boundingBox())!;
  await page.mouse.move(second.x + 30, second.y + second.height / 2, { steps: 3 });
  expect(await ed(page, (e) => e.palette.sel)).toBe(1);
});

test('the status bar’s hint after a click says alt+shift+drag draws a shape', async ({ page }) => {
  await type(page, 'text');
  await page.mouse.click(300, 110);
  await expect(page.locator('.status')).toContainText('alt+shift+drag a shape');
});
