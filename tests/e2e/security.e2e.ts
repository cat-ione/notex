// A note from someone else can't bring links, styles or scripts into the page: formulas
// trust only the commands the editor writes itself.
import { test, expect, open } from './helpers';

test('a crafted note renders its formulas inert', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => (dialogs++, d.dismiss()));
  await open(page);
  await page.evaluate(() => {
    const ed = (window as any).__nx.ed;
    const sym = (v: string) => ({ k: 'sym', id: 's' + Math.random(), v });
    const m = (v: string) => ({ t: 'm', id: 'm' + Math.random(), display: false, root: [sym(v)] });
    ed.load(
      {
        blocks: [{ id: 'b1', kind: 'p', items: [m('\\href{javascript:alert(1)}{click}'), m('\\htmlStyle{color:red;background:url(https://example.com/x)}{y}'), m('\\htmlClass{evil}{z}'), m('\\url{javascript:alert(2)}')] }],
        arrows: [],
        marks: [],
      },
      { path: null, name: 'crafted' },
    );
  });
  await page.waitForTimeout(300);
  await expect(page.locator('.math a')).toHaveCount(0);
  await expect(page.locator('.math [style*="red"]')).toHaveCount(0);
  await expect(page.locator('.evil')).toHaveCount(0);
  await page.locator('.math').first().click({ force: true });
  expect(dialogs).toBe(0);
});

test("the editor's own commands still work: ids on nodes and its classes", async ({ page }) => {
  await open(page);
  // the welcome note's formulas map glyphs back to nodes, and the caret shows while editing
  expect(await page.locator('.math [data-nx]').count()).toBeGreaterThan(10);
  await page.keyboard.press('Control+n');
  await page.keyboard.type('$x');
  await expect(page.locator('.math .nx-caret')).toHaveCount(1);
});
