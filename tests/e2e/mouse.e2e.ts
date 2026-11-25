// Mouse and keys: menus opened by a click open where it was, everything in them can be
// clicked, and hints say what fits the last thing used (keys to press, or what to click).
import { test, expect, open, fresh, type, ed } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

test("the toolbar's draw opens its menu under the button", async ({ page }) => {
  await type(page, 'something to draw on');
  const b = (await page.locator('.toolbar .b-draw').boundingBox())!;
  await page.locator('.toolbar .b-draw').click();
  const p = (await page.locator('.palette').boundingBox())!;
  expect(Math.abs(p.x - b.x)).toBeLessThan(4);
  expect(p.y).toBeGreaterThanOrEqual(b.y + b.height - 2);
  expect(p.y).toBeLessThan(b.y + b.height + 14);
  // opened by a click, it says what it is instead of waiting for typing
  await expect(page.locator('.palette .prompt')).toContainText('draw');
  await expect(page.locator('.palette .blink')).toHaveCount(0);
});

test('ctrl+d still opens the draw menu at the caret', async ({ page }) => {
  await type(page, 'something');
  await page.keyboard.press('Control+d');
  const caret = (await page.locator('.caret').boundingBox())!;
  const p = (await page.locator('.palette').boundingBox())!;
  expect(Math.abs(p.x - caret.x)).toBeLessThan(6);
  expect(p.y).toBeGreaterThan(caret.y);
  await expect(page.locator('.palette .blink')).toHaveCount(1);
});

test('a menu item can be clicked', async ({ page }) => {
  await type(page, 'something');
  await page.locator('.toolbar .b-draw').click();
  const first = page.locator('.palette .opt').first();
  await first.hover();
  await expect(first).toHaveClass(/sel/);
  await first.click();
  await expect(page.locator('.palette')).toHaveCount(0);
  expect(await ed(page, (e) => e.mode)).not.toBe('palette');
});

test('a click on the page closes the menu', async ({ page }) => {
  await type(page, 'something');
  await page.locator('.toolbar .b-draw').click();
  await expect(page.locator('.palette')).toBeVisible();
  await page.mouse.click(700, 600);
  await expect(page.locator('.palette')).toHaveCount(0);
});

test('the command palette can be clicked too', async ({ page }) => {
  await type(page, '\\sett');
  const row = page.locator('.palette .opt', { hasText: 'settings' }).first();
  await row.click();
  await expect(page.locator('.scrim .panel')).toBeVisible();
});

test('the status bar shows keys after keys, and what to click after a click', async ({ page }) => {
  await type(page, 'words');
  await expect(page.locator('.status .keys')).toContainText('F1 help');
  await page.locator('.block').first().click();
  await expect(page.locator('.status .keys')).toContainText('right-click');
  await type(page, 'x');
  await expect(page.locator('.status .keys')).toContainText('F1 help');
});

test('holding alt (to draw) is not typing: the hints stay as they were', async ({ page }) => {
  await page.locator('.block').first().click();
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  expect(await ed(page, (e) => e.input)).toBe('mouse');
});

test('settings: the keys footer and ⏎ only after keys', async ({ page }) => {
  await page.keyboard.press('Control+,');
  await expect(page.locator('.scrim .foot')).toBeVisible();
  await expect(page.locator('.scrim .hint').first()).toContainText('⏎');
  await page.locator('.scrim .title').click();
  await expect(page.locator('.scrim .foot')).toBeHidden();
  await expect(page.locator('.scrim .hint').first()).toContainText('›');
  await expect(page.locator('.scrim .hint').first()).not.toContainText('⏎');
});

test('help: how to close it fits, and the welcome note is a click away', async ({ page }) => {
  await page.keyboard.press('F1');
  await expect(page.locator('.help .foot')).toContainText('F1 or esc');
  await page.locator('.help .title').click();
  await expect(page.locator('.help .foot')).toContainText('click outside');
  await page.locator('.help .welcome').click();
  await expect(page.locator('.help')).toHaveCount(0);
  await expect(page.locator('.block.h1')).toContainText('notex');
  expect(await ed(page, (e) => e.file.name)).toBe('welcome');
});

test('\\welcome brings the welcome note back too', async ({ page }) => {
  await type(page, 'mine');
  await type(page, '\\welcome');
  await page.keyboard.press('Enter');
  await expect(page.locator('.block.h1')).toContainText('notex');
});
