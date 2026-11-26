// Zoom: ctrl+= / ctrl+- / ctrl+0, ctrl+wheel (a trackpad's pinch), two fingers on a touch
// screen. The page's text, images, diagrams and what's drawn on it grow together.
import { test, expect, open, fresh, type, ed, rectOfText } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

const fontSize = (page: Page) => page.locator('.page').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));

/** Fingers (touch pointers) down at `from`, moved to `to`, then up: two of them, a pinch. */
async function fingers(page: Page, from: [number, number][], to: [number, number][]) {
  await page.evaluate(
    ([from, to]) => {
      const fire = (type: string, id: number, x: number, y: number) => {
        const el = document.elementFromPoint(x, y) ?? document.body;
        el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 20 + id, isPrimary: id === 0, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true }));
      };
      from.forEach(([x, y], i) => fire('pointerdown', i, x, y));
      for (let s = 1; s <= 8; s++)
        from.forEach(([x, y], i) => fire('pointermove', i, x + ((to[i][0] - x) * s) / 8, y + ((to[i][1] - y) * s) / 8));
      to.forEach(([x, y], i) => fire('pointerup', i, x, y));
    },
    [from, to] as const,
  );
}

test('ctrl+= and ctrl+- zoom the page, ctrl+0 back to as it was; the zoom is kept', async ({ page }) => {
  await type(page, 'some text');
  const f0 = await fontSize(page);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  expect(await fontSize(page)).toBeCloseTo(f0 * 1.21, 0);
  await page.keyboard.press('Control+-');
  expect(await fontSize(page)).toBeCloseTo(f0 * 1.1, 0);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await fontSize(page)).toBeCloseTo(f0 * 1.1, 0);
  await page.keyboard.press('Control+0');
  expect(await fontSize(page)).toBeCloseTo(f0, 1);
});

test('ctrl+wheel zooms (as a trackpad pinch does), not the browser', async ({ page }) => {
  await type(page, 'some text');
  const f0 = await fontSize(page);
  await page.mouse.move(400, 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => fontSize(page)).toBeGreaterThan(f0 * 1.2);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
});

test('what is drawn on the note grows with the text, staying on it', async ({ page }) => {
  await type(page, 'one two three four five');
  const w = await rectOfText(page, 'three');
  // a pen stroke under "three"
  await page.evaluate(([x0, x1, y]) => {
    const fire = (type: string, x: number) =>
      document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent(type, { pointerType: 'pen', pointerId: 7, isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    fire('pointermove', x0);
    fire('pointerdown', x0);
    for (let i = 1; i <= 10; i++) fire('pointermove', x0 + ((x1 - x0) * i) / 10);
    fire('pointerup', x1);
  }, [w.x, w.x + w.w, w.y + w.h + 2] as const);
  await page.keyboard.press('Escape');
  const inkBox = () => page.locator('.note-ink path').first().boundingBox();
  const before = (await inkBox())!;
  expect(Math.abs(before.x - w.x)).toBeLessThan(6);
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(300);
  const w2 = await rectOfText(page, 'three');
  const after = (await inkBox())!;
  expect(after.width / before.width).toBeCloseTo(w2.w / w.w, 1);
  expect(Math.abs(after.x - w2.x)).toBeLessThan(8);
  expect(Math.abs(after.y - (w2.y + w2.h))).toBeLessThan(10);
});

test('an image and a diagram grow with the zoom', async ({ page }) => {
  const B = String.fromCharCode(92);
  await type(page, B + 'diagram');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const d0 = (await page.locator('svg.canvas').boundingBox())!;
  await page.setViewportSize({ width: 1600, height: 900 });
  const d1 = (await page.locator('svg.canvas').boundingBox())!;
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(200);
  const d2 = (await page.locator('svg.canvas').boundingBox())!;
  expect(d1.width).toBeCloseTo(d0.width, 0);
  expect(d2.width).toBeCloseTo(d1.width * 1.1, 0);
});

test('two fingers pinch the page bigger and smaller, once a pen has been used', async ({ page }) => {
  await type(page, 'some text to zoom');
  // (a pen seen: fingers are the page's, not the browser's)
  await page.evaluate(() => localStorage.setItem('notex.penSeen', '1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  const f0 = await fontSize(page);
  await fingers(page, [[400, 300], [500, 300]], [[350, 300], [550, 300]]);
  await expect.poll(() => fontSize(page)).toBeCloseTo(f0 * 2, 0);
  // (nothing left over from the preview)
  expect(await page.locator('.page').evaluate((e) => (e as HTMLElement).style.transform)).toBe('');
  await fingers(page, [[300, 300], [600, 300]], [[400, 300], [500, 300]]);
  await expect.poll(() => fontSize(page)).toBeCloseTo((f0 * 2) / 3, 0);
  expect(await ed(page, (e) => e.mode)).toBe('text');
});

test('printing is at no zoom', async ({ page }) => {
  await type(page, 'printed');
  const f0 = await fontSize(page);
  await page.keyboard.press('Control+=');
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  await expect.poll(() => fontSize(page)).toBeCloseTo(f0, 0);
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
  await expect.poll(() => fontSize(page)).toBeCloseTo(f0 * 1.1, 0);
});
