// The toolbar and the status bar: the toolbar's buttons do what their keys do (without
// taking the caret off the page), it fades while typing, and both bars can be hidden.
import { test, expect, open, fresh, type, text, ed } from './helpers';
import type { Page } from '@playwright/test';

const button = (page: Page, id: string) => page.locator(`.toolbar .b-${id}`);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

test('the toolbar is there, with the note and every button, each with its keys', async ({ page }) => {
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.locator('.toolbar .note')).toContainText('untitled');
  for (const id of ['new', 'save', 'math', 'draw', 'image', 'find', 'pdf', 'settings', 'help', 'hide']) await expect(button(page, id)).toBeVisible();
  await expect(button(page, 'find')).toHaveAttribute('data-tip-key', 'ctrl+f');
  await expect(button(page, 'draw')).toHaveAttribute('data-tip-key', 'ctrl+d');
  // hovering shows what it does and its keys
  await button(page, 'find').hover();
  await expect(page.locator('.tip')).toContainText('find');
  await expect(page.locator('.tip')).toContainText('ctrl+f');
});

test('math puts a formula where the caret is, and typing goes into it', async ({ page }) => {
  await type(page, 'area ');
  await button(page, 'math').click();
  expect(await ed(page, (e) => e.mode)).toBe('math');
  await type(page, 'r^2');
  await type(page, '$');
  await type(page, ' grows');
  expect(await text(page)).toBe('area $r^{2}$ grows');
});

test('the buttons leave the caret where it was', async ({ page }) => {
  await type(page, 'one two');
  await page.keyboard.press('Home');
  const before = await ed(page, (e) => [e.b, e.o]);
  await button(page, 'find').click();
  await page.keyboard.press('Escape');
  expect(await ed(page, (e) => [e.b, e.o])).toEqual(before);
  await type(page, 'X');
  expect(await text(page)).toBe('Xone two');
});

test('draw opens the draw menu', async ({ page }) => {
  await type(page, 'something');
  await button(page, 'draw').click();
  await expect(page.locator('.palette')).toBeVisible();
  await expect(page.locator('.palette .opt').first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('find, settings and help open their panels', async ({ page }) => {
  await button(page, 'find').click();
  await expect(page.locator('.findbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await button(page, 'settings').click();
  await expect(page.locator('.scrim .panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.scrim .panel')).toHaveCount(0);
  const help = await button(page, 'help').boundingBox();
  await button(page, 'help').click();
  await expect(page.locator('.help')).toBeVisible();
  // a click outside it (on ? again, say) closes it
  await page.mouse.click(help!.x + help!.width / 2, help!.y + help!.height / 2);
  await expect(page.locator('.help')).toHaveCount(0);
});

test('the note button lists the notes; new starts one', async ({ page }) => {
  await type(page, 'first');
  await expect.poll(() => ed(page, (e) => e.dirty)).toBe(false);
  await page.locator('.toolbar .note').click();
  await expect(page.locator('.panel .row .name').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await button(page, 'new').click();
  await expect.poll(() => text(page)).toBe('');
});

test('pdf goes through the print dialog in the browser', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__prints = 0;
    window.print = () => void (window as any).__prints++;
  });
  await button(page, 'pdf').click();
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(1);
});

test('save downloads the note where the browser has no file pickers', async ({ page }) => {
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  await type(page, 'keep');
  const download = page.waitForEvent('download');
  await button(page, 'save').click();
  expect((await download).suggestedFilename()).toBe('untitled.ntx');
});

test('the toolbar fades while typing and comes back when the mouse moves', async ({ page }) => {
  await page.mouse.move(500, 400);
  await type(page, 'typing along');
  await expect(page.locator('.toolbar')).toHaveClass(/quiet/);
  await page.mouse.move(520, 410);
  await expect(page.locator('.toolbar')).not.toHaveClass(/quiet/);
  // shortcuts and arrows don't fade it
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+a');
  await expect(page.locator('.toolbar')).not.toHaveClass(/quiet/);
});

test('set to stay, it stays while typing', async ({ page }) => {
  await page.evaluate(() => (window as any).__nx.ed.updateConfig({ ui: { toolbar: true, fadeToolbar: false, statusBar: true } }));
  await type(page, 'typing along');
  await expect(page.locator('.toolbar')).not.toHaveClass(/quiet/);
});

test('▴ hides the toolbar, \\toolbar brings it back, and it stays as set after a reload', async ({ page }) => {
  await button(page, 'hide').click();
  await expect(page.locator('.toolbar')).toHaveCount(0);
  // the note's name moves to the status bar
  await expect(page.locator('.status .file')).toContainText('untitled');
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await expect(page.locator('.toolbar')).toHaveCount(0);
  await type(page, '\\toolbar');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.locator('.status .file')).toHaveCount(0);
});

test('the status bar can be hidden; messages then show in the corner', async ({ page }) => {
  await type(page, '\\statusbar');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toHaveCount(0);
  await page.evaluate(() => (window as any).__nx.ed.flash('saved somewhere'));
  await expect(page.locator('.toast')).toHaveText('saved somewhere');
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 });
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await expect(page.locator('.status')).toHaveCount(0);
});

test('both bars from the settings', async ({ page }) => {
  await page.keyboard.press('Control+,');
  const row = (label: string) => page.locator('.scrim .row', { has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) });
  await row('toolbar').click();
  await expect(page.locator('.toolbar')).toHaveCount(0);
  await row('status bar').click();
  await expect(page.locator('.status')).toHaveCount(0);
  await row('toolbar').click();
  await row('status bar').click();
  await expect(page.locator('.toolbar')).toBeVisible();
  await expect(page.locator('.status')).toBeVisible();
});

test('with both bars hidden the page fills the window', async ({ page }) => {
  const before = await page.locator('.scroller').evaluate((e) => e.getBoundingClientRect().height);
  await page.evaluate(() => (window as any).__nx.ed.updateConfig({ ui: { toolbar: false, fadeToolbar: true, statusBar: false } }));
  await expect(page.locator('.toolbar')).toHaveCount(0);
  const after = await page.locator('.scroller').evaluate((e) => e.getBoundingClientRect().height);
  expect(after).toBe(800);
  expect(after).toBeGreaterThan(before);
});

test('narrow windows show the glyphs only, and they still work', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  await expect(button(page, 'find').locator('.l')).toBeHidden();
  await button(page, 'find').click();
  await expect(page.locator('.findbar')).toBeVisible();
  // nothing spills out of the bar
  const fits = await page.locator('.toolbar').evaluate((e) => e.scrollWidth <= e.clientWidth);
  expect(fits).toBe(true);
});

test('the toolbar is not printed', async ({ page }) => {
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.toolbar')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});
