// Shared pieces for the browser tests. The app is opened with `?lab`, which exposes the
// editor as window.__nx (src/lib/dev.ts) so a test can look at what typing produced.
import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails on an uncaught error in the page. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Open the app (fresh storage: a new test context) and wait for it to be ready. */
export async function open(page: Page, query = '') {
  await page.goto(`/?lab${query}`);
  await page.waitForFunction(() => (window as any).__nx);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

/** A new empty note, caret in it. */
export async function fresh(page: Page) {
  await page.keyboard.press('Control+n');
  await expect.poll(() => text(page)).toBe('');
}

/** Type like a person: one key at a time. */
export async function type(page: Page, s: string) {
  await page.keyboard.type(s);
}

/** The note as plain text: one line per block, a formula as its LaTeX in $…$. */
export function text(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nx = (window as any).__nx;
    const tex: string[] = nx.formulas();
    let k = 0;
    return nx.ed.doc.blocks
      .map((b: any) => b.items.map((i: any) => (i.t === 'c' ? i.ch : `$${tex[k++]}$`)).join(''))
      .join('\n');
  });
}

/** Each block's kind (and depth, for nested list items). */
export function kinds(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__nx.ed.doc.blocks.map((b: any) => b.kind + (b.indent ? `:${b.indent}` : '')));
}

/** Each formula's LaTeX, in order. */
export function formulas(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__nx.formulas());
}

/** The editor's state, read with a function of it. */
export function ed<T>(page: Page, f: (ed: any) => T): Promise<T> {
  return page.evaluate(`(${f.toString()})(window.__nx.ed)`) as Promise<T>;
}

/** Wait until the note is saved (autosave runs a moment after the last edit). */
export async function saved(page: Page) {
  await expect.poll(() => ed(page, (e) => e.dirty), { timeout: 5000 }).toBe(false);
}

/** The screen rectangle of a run of text in the note (its `n`th occurrence). */
export function rectOfText(page: Page, s: string, n = 0) {
  return page.evaluate(
    ([s, n]) => {
      const ed = (window as any).__nx.ed;
      let seen = 0;
      for (const b of ed.doc.blocks) {
        const line = b.items.map((i: any) => (i.t === 'c' ? i.ch : '￼')).join('');
        let at = -1;
        while ((at = line.indexOf(s, at + 1)) >= 0) {
          if (seen++ !== n) continue;
          const rs = b.items.slice(at, at + (s as string).length).map((i: any) => document.querySelector(`[data-nx="${i.id}"]`)!.getBoundingClientRect());
          const x = Math.min(...rs.map((r: DOMRect) => r.left)), y = Math.min(...rs.map((r: DOMRect) => r.top));
          const x2 = Math.max(...rs.map((r: DOMRect) => r.right)), y2 = Math.max(...rs.map((r: DOMRect) => r.bottom));
          return { x, y, w: x2 - x, h: y2 - y, cx: (x + x2) / 2, cy: (y + y2) / 2, ids: b.items.slice(at, at + (s as string).length).map((i: any) => i.id) };
        }
      }
      throw new Error(`no "${s}" in the note`);
    },
    [s, n] as const,
  );
}

/** Drag with the mouse from one point to another, holding modifier keys. */
export async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }, mods: string[] = []) {
  await page.mouse.move(a.x, a.y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  for (const m of [...mods].reverse()) await page.keyboard.up(m);
}
