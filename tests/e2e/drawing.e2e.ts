import { test, expect, open, fresh, type, ed, rectOfText, drag } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
  await type(page, 'the start of it all leads to the end');
  await page.keyboard.press('Enter');
  await type(page, 'and a second line with words');
});

/** The arrow's geometry in page coordinates and its target's, in the same coordinates. */
function arrowAt(page: Page) {
  return ed(page, (e) => {
    const a = e.doc.arrows[0];
    const g = e.arrowGeos[a.id];
    const origin = e.page.getBoundingClientRect();
    return { p0: g.p0, p2: g.p2, from: g.from, to: g.to, origin: { x: origin.left, y: origin.top } };
  });
}

test('alt+drag from one word to another draws an arrow between them', async ({ page }) => {
  const a = await rectOfText(page, 'start');
  const b = await rectOfText(page, 'end');
  await drag(page, { x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, ['Alt']);
  const arrows = await ed(page, (e) => e.doc.arrows.map((x: any) => ({ from: x.from, to: x.to })));
  expect(arrows).toHaveLength(1);
  expect(a.ids).toEqual(expect.arrayContaining(arrows[0].from));
  expect(b.ids).toEqual(expect.arrayContaining(arrows[0].to));
  await expect(page.locator('svg.arrows g.arrow')).toHaveCount(1);
  // its ends are at its words
  const g = await arrowAt(page);
  const near = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
    p.x >= r.x - 8 && p.x <= r.x + r.w + 8 && p.y >= r.y - 8 && p.y <= r.y + r.h + 8;
  expect(near(g.p0, g.from)).toBe(true);
  expect(near(g.p2, g.to)).toBe(true);
  expect(Math.abs(g.to.x + g.origin.x - b.x)).toBeLessThanOrEqual(4);
});

test('alt+shift+drag draws a shape over the text', async ({ page }) => {
  const a = await rectOfText(page, 'second');
  const b = await rectOfText(page, 'line');
  await drag(page, { x: a.x + 2, y: a.cy }, { x: b.x + b.w - 2, y: b.cy }, ['Alt', 'Shift']);
  const marks = await ed(page, (e) => e.doc.marks.map((m: any) => ({ kind: m.kind, n: m.at.length })));
  expect(marks).toHaveLength(1);
  expect(marks[0].n).toBeGreaterThan(0);
  await expect(page.locator('svg.marks g.mark').first()).toBeVisible();
});

test('a note on an arrow, its colour, and deleting it', async ({ page }) => {
  const a = await rectOfText(page, 'start');
  const b = await rectOfText(page, 'end');
  await drag(page, { x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, ['Alt']);
  await page.keyboard.press('l');
  await type(page, 'why');
  await page.keyboard.press('Enter');
  expect(await ed(page, (e) => e.doc.arrows[0].label)).toBe('why');
  await expect(page.locator('.dlabel:visible', { hasText: 'why' }).first()).toBeVisible();
  await page.keyboard.press('c');
  expect(await ed(page, (e) => e.doc.arrows[0].color)).toBeTruthy();
  await page.keyboard.press('Delete');
  expect(await ed(page, (e) => e.doc.arrows.length)).toBe(0);
  await expect(page.locator('.dlabel:visible')).toHaveCount(0);
});

test('drawings stay on their words while the text around them changes', async ({ page }) => {
  const a = await rectOfText(page, 'start');
  const b = await rectOfText(page, 'end');
  await drag(page, { x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, ['Alt']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const before = await arrowAt(page);
  // type in front of everything: both words move right
  await page.keyboard.press('Control+Home');
  await type(page, 'Look: ');
  await expect.poll(async () => (await arrowAt(page)).p0.x).toBeGreaterThan(before.p0.x + 10);
  const after = await arrowAt(page);
  const start = await rectOfText(page, 'start');
  expect(Math.abs(after.from.x + after.origin.x - start.x)).toBeLessThanOrEqual(4);
  // undo puts it back
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await arrowAt(page)).p0.x)).toBe(Math.round(before.p0.x));
});

test('drawing the arrow deletes nothing and is one undo step', async ({ page }) => {
  const a = await rectOfText(page, 'start');
  const b = await rectOfText(page, 'end');
  await drag(page, { x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }, ['Alt']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await ed(page, (e) => e.doc.arrows.length)).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await ed(page, (e) => e.doc.arrows.length)).toBe(0);
});
