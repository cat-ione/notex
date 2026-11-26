// A tablet's way: the ring menu round the pen or finger (the pen's side button tapped, a
// finger held, a long press), the ⋯ beside a selection, fingers tapped together for undo and
// redo.
import { test, expect, open, fresh, type, ed, text } from './helpers';
import type { Page } from '@playwright/test';

const B = String.fromCharCode(92);

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** Pointer events for one pointer along points (pen: its side button held, if `barrel`). */
async function pointer(page: Page, kind: 'pen' | 'touch', pts: [number, number][], o: { id?: number; barrel?: boolean; hold?: number } = {}) {
  const id = o.id ?? (kind === 'pen' ? 7 : 31);
  const fire = (type: string, x: number, y: number) =>
    page.evaluate(([type, x, y, kind, id, barrel]) => {
      const held = type === 'pointerup' ? 0 : barrel ? 3 : 1;
      const button = type === 'pointermove' ? -1 : barrel ? 2 : 0;
      (document.elementFromPoint(x as number, y as number) ?? document.body).dispatchEvent(new PointerEvent(type as string, { pointerType: kind as string, pointerId: id as number, isPrimary: true, clientX: x as number, clientY: y as number, pressure: 0.5, buttons: held, button, bubbles: true, cancelable: true, composed: true }));
    }, [type, x, y, kind, id, !!o.barrel] as const);
  await fire('pointerdown', pts[0][0], pts[0][1]);
  if (o.hold) await page.waitForTimeout(o.hold);
  for (const [x, y] of pts.slice(1)) await fire('pointermove', x, y);
  const [x1, y1] = pts[pts.length - 1];
  await fire('pointerup', x1, y1);
}

/** Where an item of the ring is (by what it's called). */
async function ringItem(page: Page, label: string) {
  const b = (await page.locator(`.radial .item[aria-label="${label}"]`).boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as [number, number];
}

const shapes = (page: Page) => ed(page, (e) => JSON.parse(JSON.stringify(e.doc.blocks.find((b: any) => b.kind === 'diagram')?.shapes ?? [])));

async function diagram(page: Page) {
  await type(page, B + 'diagram');
  await page.keyboard.press('Enter');
  return (await page.locator('svg.canvas').last().boundingBox())!;
}

test('the pen’s side button tapped: the tools round the pen; tapping one takes it', async ({ page }) => {
  const c = await diagram(page);
  await pointer(page, 'pen', [[c.x + 300, c.y + 140]], { barrel: true });
  await expect(page.locator('.radial .middle')).toBeVisible();
  await expect(page.locator('.radial .item')).toHaveCount(12);
  const at = await ringItem(page, 'arrow');
  await pointer(page, 'touch', [at]);
  await expect(page.locator('.radial')).toHaveCount(0);
  expect(await ed(page, (e) => e.sketch.tool)).toBe('arrow');
});

test('the side button tapped on a shape: it’s picked, and the ring says what can be done to it', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.move(c.x + 60, c.y + 40);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y + 110, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await shapes(page)).toHaveLength(1);
  await pointer(page, 'pen', [[c.x + 130, c.y + 75]], { barrel: true });
  await expect(page.locator('.radial .item[aria-label="delete"]')).toBeVisible();
  await pointer(page, 'touch', [await ringItem(page, 'delete')]);
  expect(await shapes(page)).toHaveLength(0);
});

test('a finger held still (a pen once used): the ring; sliding to an item and lifting takes it', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('notex.penSeen', '1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  await type(page, 'some text');
  // held, then slid up to where "pen" will be (at the top of the ring) and lifted
  await page.evaluate(() => {
    const fire = (type: string, x: number, y: number) =>
      (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 40, isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    fire('pointerdown', 500, 400);
    (window as any).fire = fire;
  });
  await page.waitForTimeout(650);
  await expect(page.locator('.radial .middle')).toBeVisible();
  const [x, y] = await ringItem(page, 'pen');
  await page.evaluate(([x, y]) => {
    (window as any).fire('pointermove', x, y);
    (window as any).fire('pointerup', x, y);
  }, [x, y]);
  await expect(page.locator('.radial')).toHaveCount(0);
  expect(await ed(page, (e) => [e.mode, e.sketch.tool, e.sketch.on?.kind])).toEqual(['sketch', 'pen', 'free']);
});

test('a long press (the browser’s right-click from a finger) opens the ring, not the menu', async ({ page }) => {
  await type(page, 'some text');
  await page.evaluate(() =>
    document.querySelector('.page')!.dispatchEvent(new PointerEvent('contextmenu', { pointerType: 'touch', clientX: 400, clientY: 300, bubbles: true, cancelable: true })),
  );
  await expect(page.locator('.radial .middle')).toBeVisible();
  await expect(page.locator('.menu')).toHaveCount(0);
  // the middle, or away from the ring: closed
  await pointer(page, 'touch', [[60, 600]]);
  await expect(page.locator('.radial')).toHaveCount(0);
});

test('colour opens a ring of colours', async ({ page }) => {
  const c = await diagram(page);
  await pointer(page, 'pen', [[c.x + 300, c.y + 140]], { barrel: true });
  await pointer(page, 'touch', [await ringItem(page, 'colour')]);
  await expect(page.locator('.radial .item .dot')).toHaveCount(5);
  await pointer(page, 'touch', [await ringItem(page, 'red')]);
  expect(await ed(page, (e) => e.sketch.color)).toBe('red');
});

test('two fingers tapped together undo, three redo', async ({ page }) => {
  await type(page, 'one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  const tap = (n: number) =>
    page.evaluate((n) => {
      const fire = (type: string, i: number) =>
        document.querySelector('.page')!.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 50 + i, isPrimary: i === 0, clientX: 300 + i * 60, clientY: 300, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      for (let i = 0; i < n; i++) fire('pointerdown', i);
      for (let i = 0; i < n; i++) fire('pointerup', i);
    }, n);
  const before = await text(page);
  await tap(2);
  expect(await text(page)).not.toBe(before);
  await tap(3);
  expect(await text(page)).toBe(before);
});

test('a selection made with a pen has a ⋯ beside it, which opens what can be done to it', async ({ page }) => {
  const c = await diagram(page);
  await pointer(page, 'pen', [[c.x + 60, c.y + 40], [c.x + 120, c.y + 80], [c.x + 200, c.y + 110]]);
  await page.keyboard.press('v');
  await pointer(page, 'pen', [[c.x + 130, c.y + 75]]);
  await expect(page.locator('.selmore')).toBeVisible();
  const b = (await page.locator('.selmore').boundingBox())!;
  await pointer(page, 'touch', [[b.x + b.width / 2, b.y + b.height / 2]]);
  await expect(page.locator('.radial .item[aria-label="duplicate"]')).toBeVisible();
});
