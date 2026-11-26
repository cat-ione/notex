// Diagrams and drawing on the note: the tools with the mouse and the keys, shapes joined by
// arrows, labels, the selection; a pen (pressure, its eraser end, drawing on the note at any
// time) and fingers (drawing, or scrolling once a pen has been used; a palm doing nothing).
import { test, expect, open, fresh, type, ed, text } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

type P = [number, number, number?];

/** A pen (or a finger) along points: hovering first (a pen), down, through them, up. */
async function stroke(page: Page, kind: 'pen' | 'touch', pts: P[], o: { eraser?: boolean; id?: number; hover?: boolean; up?: boolean } = {}) {
  await page.evaluate(
    ([kind, pts, o]) => {
      const id = o.id ?? (kind === 'pen' ? 7 : 11);
      const fire = (type: string, x: number, y: number, p: number, buttons: number) => {
        const el = document.elementFromPoint(x, y) ?? document.body;
        el.dispatchEvent(new PointerEvent(type, {
          pointerType: kind, pointerId: id, isPrimary: true, clientX: x, clientY: y, pressure: p, buttons,
          button: type === 'pointermove' ? -1 : o.eraser ? 5 : 0, bubbles: true, cancelable: true, composed: true,
        }));
      };
      const held = o.eraser ? 32 : 1;
      const [x0, y0] = pts[0];
      if (kind === 'pen' && o.hover !== false) fire('pointermove', x0, y0, 0, 0);
      fire('pointerdown', x0, y0, pts[0][2] ?? 0.5, held);
      for (const [x, y, p] of pts.slice(1)) fire('pointermove', x, y, p ?? 0.5, held);
      const [x1, y1] = pts[pts.length - 1];
      if (o.up !== false) fire('pointerup', x1, y1, 0, 0);
    },
    [kind, pts, o] as const,
  );
}
/** The pen goes away from the screen (fingers are fingers again). */
async function penAway(page: Page) {
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerout', { pointerType: 'pen', pointerId: 7, bubbles: true, relatedTarget: null })));
  await page.waitForTimeout(700);
}
const line = (x0: number, y0: number, x1: number, y1: number, n = 12, p = 0.5): P[] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, p]);

async function drag(page: Page, a: [number, number], b: [number, number], mods: string[] = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 });
  await page.mouse.move(b[0], b[1], { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

/** A new diagram (via the palette), and where its canvas is on the screen. */
async function diagram(page: Page) {
  await type(page, '\\diagram');
  await page.keyboard.press('Enter');
  await expect(page.locator('svg.canvas')).toBeVisible();
  const c = (await page.locator('svg.canvas').last().boundingBox())!;
  return { ...c, at: (x: number, y: number): [number, number] => [c.x + x, c.y + y] };
}
const shapes = (page: Page, b?: number) =>
  ed(page, (e) => {
    const blk = e.doc.blocks.find((x: any) => x.kind === 'diagram');
    return JSON.parse(JSON.stringify(blk?.shapes ?? []));
  }) as Promise<any[]>;
const ink = (page: Page) => ed(page, (e) => JSON.parse(JSON.stringify(e.doc.ink ?? []))) as Promise<any[]>;
const sk = <T>(page: Page, f: (s: any) => T) => page.evaluate(`(${f.toString()})(window.__nx.ed.sketch)`) as Promise<T>;
const mode = (page: Page) => ed(page, (e) => e.mode);

// ── a diagram block ──

test('\\diagram puts a diagram after the line and draws in it; esc goes back to the text', async ({ page }) => {
  await type(page, 'above');
  await page.keyboard.press('Enter');
  await diagram(page);
  expect(await ed(page, (e) => e.doc.blocks.map((b: any) => b.kind))).toEqual(['p', 'diagram', 'p']);
  expect(await mode(page)).toBe('sketch');
  await expect(page.locator('.sbar')).toBeVisible();
  await expect(page.locator('.status .mode')).toHaveText('DIAGRAM');
  await page.keyboard.press('Escape');
  expect(await mode(page)).toBe('text');
  expect(await ed(page, (e) => [e.b, e.o])).toEqual([1, 0]);
  await expect(page.locator('.sbar')).toHaveCount(0);
});

test('dragging with the box tool makes a box, and what is typed next is its label', async ({ page }) => {
  const c = await diagram(page);
  await drag(page, c.at(40, 40), c.at(200, 110));
  await page.keyboard.type('Start $x^2$');
  await page.keyboard.press('Enter');
  const [s] = await shapes(page);
  // (on the diagram's grid: every 8)
  expect(s).toMatchObject({ k: 'rect', x: 40, y: 40, w: 160, h: 72, label: 'Start $x^2$' });
  await expect(page.locator('svg.canvas .label .katex')).toHaveCount(1);
  // the tool went back to select, with the box selected
  expect(await sk(page, (s) => [s.tool, s.sel.length])).toEqual(['select', 1]);
});

test('a tap with a box tool makes a box of the usual size there', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('o');
  await page.mouse.click(...c.at(200, 100));
  await page.keyboard.press('Escape');
  const [s] = await shapes(page);
  expect(s).toMatchObject({ k: 'ellipse', x: 144, y: 72, w: 120, h: 56 });
  expect(s.label).toBeUndefined();
});

test('ctrl+arrow while typing a label: the next box beside it, joined by an arrow', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.type('one');
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.type('two');
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.type('three');
  await page.keyboard.press('Enter');
  const list = await shapes(page);
  const boxes = list.filter((s) => s.k === 'rect');
  expect(boxes.map((b) => b.label)).toEqual(['one', 'two', 'three']);
  expect(boxes[1].x).toBe(boxes[0].x + 120 + 64);
  expect(boxes[2].y).toBe(boxes[1].y + 56 + 64);
  const arrows = list.filter((s) => s.k === 'line');
  expect(arrows.map((a) => [a.a.to, a.b.to, a.head])).toEqual([[boxes[0].id, boxes[1].id, 'end'], [boxes[1].id, boxes[2].id, 'end']]);
});

test('an arrow from box to box stays attached when a box is moved', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.click(...c.at(400, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('a');
  await drag(page, c.at(100, 60), c.at(400, 70));
  let list = await shapes(page);
  const [A, B] = list.filter((s) => s.k === 'rect');
  const arrow = list.find((s) => s.k === 'line');
  expect([arrow.a.to, arrow.b.to]).toEqual([A.id, B.id]);
  const x2 = async () => Number(await page.locator('svg.canvas line').first().getAttribute('x2'));
  const before = await x2();
  // move the second box down and right
  await drag(page, c.at(400, 60), c.at(480, 156));
  list = await shapes(page);
  expect(list.find((s) => s.id === B.id)).toMatchObject({ x: B.x + 80, y: B.y + 96 });
  expect(await x2()).toBeGreaterThan(before + 40);
});

test('select: a click, shift+click adds, a drag round some selects what lies inside', async ({ page }) => {
  const c = await diagram(page);
  for (const x of [80, 260, 440]) {
    await page.keyboard.press('r');
    await page.mouse.click(...c.at(x, 80));
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('v');
  await page.mouse.click(...c.at(80, 80));
  expect(await sk(page, (s) => s.sel.length)).toBe(1);
  await page.keyboard.down('Shift');
  await page.mouse.click(...c.at(260, 80));
  await page.keyboard.up('Shift');
  expect(await sk(page, (s) => s.sel.length)).toBe(2);
  // empty place: nothing
  await page.mouse.click(...c.at(600, 220));
  expect(await sk(page, (s) => s.sel.length)).toBe(0);
  await drag(page, c.at(170, 20), c.at(560, 140));
  const list = await shapes(page);
  expect(await sk(page, (s) => s.sel)).toEqual([list[1].id, list[2].id]);
});

test('delete takes the selection; a line joined to a deleted box lets go where it was', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Escape');
  // the new box is selected
  await page.keyboard.press('Delete');
  const list = await shapes(page);
  expect(list.map((s) => s.k)).toEqual(['rect', 'line']);
  expect(list[1].b.to).toBeUndefined();
  expect(list[1].a.to).toBe(list[0].id);
});

test('arrows nudge the selection; ctrl+d copies it; c, w, - and f restyle it', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  const [s0] = await shapes(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  let [s] = await shapes(page);
  expect([s.x, s.y]).toEqual([s0.x + 1, s0.y + 10]);
  await page.keyboard.press('c');
  await page.keyboard.press('w');
  await page.keyboard.press('-');
  await page.keyboard.press('f');
  [s] = await shapes(page);
  expect(s).toMatchObject({ color: 'red', width: 3, dash: true, fill: true });
  await expect(page.locator('.sbar button[aria-label="red colour"]')).toHaveClass(/on/);
  await page.keyboard.press('Control+d');
  const list = await shapes(page);
  expect(list).toHaveLength(2);
  expect([list[1].x, list[1].y]).toEqual([s.x + 16, s.y + 16]);
  expect(list[1]).toMatchObject({ color: 'red', fill: true });
  expect(await sk(page, (s) => s.sel)).toEqual([list[1].id]);
});

test('a corner handle resizes; a line end dragged onto another box attaches to it', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60)); // box at 40,32 120×56
  await page.keyboard.press('Escape');
  await drag(page, c.at(160, 88), c.at(200, 128));
  let [box] = await shapes(page);
  expect(box).toMatchObject({ x: 40, y: 32, w: 160, h: 96 });
  // a free line, then its end onto the box
  await page.keyboard.press('l');
  await drag(page, c.at(400, 200), c.at(500, 220));
  const ln = (await shapes(page)).find((s) => s.k === 'line');
  expect(ln.a.to ?? null).toBeNull();
  await drag(page, c.at(400, 200), c.at(120, 80));
  const after = (await shapes(page)).find((s) => s.k === 'line');
  expect(after.a.to).toBe(box.id);
  [box] = await shapes(page);
});

test('undo and redo while drawing keep drawing', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await shapes(page)).toHaveLength(1);
  await page.keyboard.press('Control+z');
  expect(await shapes(page)).toHaveLength(0);
  expect(await mode(page)).toBe('sketch');
  await page.keyboard.press('Control+y');
  expect(await shapes(page)).toHaveLength(1);
});

test('the eraser takes the strokes it goes over', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('p');
  await drag(page, c.at(50, 50), c.at(300, 60));
  await drag(page, c.at(50, 150), c.at(300, 160));
  expect((await shapes(page)).map((s) => s.k)).toEqual(['ink', 'ink']);
  await page.keyboard.press('e');
  await drag(page, c.at(150, 20), c.at(160, 90));
  const left = await shapes(page);
  expect(left).toHaveLength(1);
  expect(left[0].pts[1]).toBeGreaterThan(140);
});

test('a pen draws with its pressure; its eraser end erases', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('p');
  await stroke(page, 'pen', Array.from({ length: 30 }, (_, i): P => [c.x + 60 + i * 8, c.y + 120 + Math.sin(i / 3) * 20, 0.1 + (i / 30) * 0.9]));
  const [s] = await shapes(page);
  expect(s).toMatchObject({ k: 'ink', pen: true });
  const ps = s.pts.filter((_: number, i: number) => i % 3 === 2);
  expect(Math.min(...ps)).toBeLessThan(0.3);
  expect(Math.max(...ps)).toBeGreaterThan(0.8);
  // drawn as a filled outline, its width following the pressure
  await expect(page.locator('svg.canvas path.fillink')).toHaveCount(1);
  await stroke(page, 'pen', line(c.x + 150, c.y + 60, c.x + 160, c.y + 180), { eraser: true });
  expect(await shapes(page)).toHaveLength(0);
});

test('a pen with the select tool selects (a drag round some too); a box drawn by pen keeps the tool, no label to type', async ({ page }) => {
  const c = await diagram(page);
  // the box tool, by pen: a box, no label editor, still the box tool
  await stroke(page, 'pen', line(c.x + 40, c.y + 40, c.x + 160, c.y + 96));
  expect(await sk(page, (s) => [s.tool, s.editing])).toEqual(['rect', null]);
  await stroke(page, 'pen', line(c.x + 240, c.y + 40, c.x + 360, c.y + 96));
  expect((await shapes(page)).map((s) => s.k)).toEqual(['rect', 'rect']);
  await page.keyboard.press('v');
  await stroke(page, 'pen', [[c.x + 100, c.y + 60]]);
  expect(await sk(page, (s) => s.sel.length)).toBe(1);
  await stroke(page, 'pen', line(c.x + 20, c.y + 20, c.x + 400, c.y + 130));
  expect(await sk(page, (s) => s.sel.length)).toBe(2);
  expect(await shapes(page)).toHaveLength(2);
});

test('the diagram grows to hold what is drawn below it; its bottom edge drags', async ({ page }) => {
  const c = await diagram(page);
  const h0 = await ed(page, (e) => e.blk.h);
  expect(h0).toBe(280);
  await page.keyboard.press('p');
  await drag(page, c.at(100, 200), c.at(120, 275));
  const h1 = await ed(page, (e) => e.blk.h);
  expect(h1).toBeGreaterThan(280);
  const g = (await page.locator('.dgrip').boundingBox())!;
  await drag(page, [g.x + g.width / 2, g.y + 3], [g.x + g.width / 2, g.y + 103]);
  expect(await ed(page, (e) => e.blk.h)).toBeGreaterThan(h1 + 90);
  // not above what's drawn
  await drag(page, [g.x + g.width / 2, g.y + 103], [g.x + g.width / 2, c.y - 200]);
  expect(await ed(page, (e) => e.blk.h)).toBeGreaterThanOrEqual(275);
});

test('a click on the text leaves the diagram; a click on the diagram goes into it, to select', async ({ page }) => {
  await type(page, 'some text');
  await page.keyboard.press('Enter');
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  const t = (await page.locator('.block').first().boundingBox())!;
  await page.mouse.click(t.x + 20, t.y + t.height / 2);
  expect(await mode(page)).toBe('text');
  expect(await ed(page, (e) => e.b)).toBe(0);
  await page.mouse.click(...c.at(100, 60));
  expect(await mode(page)).toBe('sketch');
  expect(await sk(page, (s) => [s.tool, s.sel.length])).toEqual(['select', 1]);
});

test('the text tool: a click, then type; an empty text goes', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('t');
  await page.mouse.click(...c.at(300, 150));
  await page.keyboard.type('note');
  await page.keyboard.press('Enter');
  let list = await shapes(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ k: 'text', label: 'note' });
  expect(list[0].w).toBeGreaterThan(20);
  await page.keyboard.press('t');
  await page.mouse.click(...c.at(100, 220));
  await page.keyboard.press('Escape');
  list = await shapes(page);
  expect(list).toHaveLength(1);
});

test('a double-click on a box types its label; the keyboard alone makes and labels boxes', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('Enter'); // nothing selected: a new box, its label to type
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.type('beta');
  await page.keyboard.press('Enter');
  // tab goes round the shapes: beta, its arrow, then round to alpha
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const list = await shapes(page);
  expect(list.filter((s) => s.k === 'rect').map((s) => s.label)).toEqual(['alpha', 'beta']);
  expect(await sk(page, (s) => s.sel)).toEqual([list[0].id]);
  const b = list[0];
  await page.mouse.dblclick(c.x + b.x + b.w / 2, c.y + b.y + b.h / 2);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('gamma');
  await page.keyboard.press('Enter');
  expect((await shapes(page))[0].label).toBe('gamma');
});

test('shapes copy and paste as shapes, joined lines with them', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  const copied = await page.evaluate(() => {
    let got = '';
    (window as any).__nx.ed.copy({ clipboardData: { setData: (_: string, t: string) => (got = t) }, preventDefault() {} }, false);
    return got;
  });
  expect(JSON.parse(copied).shapes).toHaveLength(3);
  await page.evaluate((t) => (window as any).__nx.ed.paste({ clipboardData: { getData: () => t, files: [] }, preventDefault() {} }), copied);
  const list = await shapes(page);
  expect(list).toHaveLength(6);
  const line2 = list[5];
  expect([line2.a.to, line2.b.to]).toEqual([list[3].id, list[4].id]);
});

test('a diagram is kept with the note (after a reload)', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.type('kept');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect.poll(() => ed(page, (e) => e.dirty), { timeout: 5000 }).toBe(false);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  const list = await shapes(page);
  expect(list).toHaveLength(1);
  expect(list[0].label).toBe('kept');
  await expect(page.locator('svg.canvas .label')).toHaveText('kept');
});

// ── on the note ──

test('ctrl+shift+d draws on the note; a drawing is pinned to the line under it', async ({ page }) => {
  await type(page, 'first line of text');
  await page.keyboard.press('Enter');
  await type(page, 'second line');
  await page.keyboard.press('Control+Shift+d');
  expect(await mode(page)).toBe('sketch');
  await expect(page.locator('.status .mode')).toHaveText('SKETCH');
  await expect(page.locator('.toolbar .b-pen')).toHaveClass(/here/);
  const second = (await page.locator('.block').nth(1).boundingBox())!;
  await drag(page, [second.x + 10, second.y + second.height / 2], [second.x + 200, second.y + second.height / 2 + 4]);
  const [s] = await ink(page);
  // pinned to the first character of the second line
  expect(s.at).toBe(await ed(page, (e) => e.doc.blocks[1].items[0].id));
  await page.keyboard.press('Escape');
  expect(await mode(page)).toBe('text');
  await expect(page.locator('.note-ink path')).toHaveCount(1);
});

test('a drawing on the note goes where its line goes', async ({ page }) => {
  await type(page, 'one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  const two = (await page.locator('.block').nth(1).boundingBox())!;
  await stroke(page, 'pen', line(two.x, two.y + 8, two.x + 150, two.y + 12));
  await page.keyboard.press('Escape');
  const top = async () => (await page.locator('.note-ink path').first().boundingBox())!.y;
  const lineTop = async () => (await page.locator('.block').nth(1).boundingBox())!.y;
  const gap = (await top()) - (await lineTop());
  // a paragraph above (enter at the start of the note): it moves down with "two"
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(async () => Math.round((await top()) - (await page.locator('.block').nth(3).boundingBox())!.y)).toBe(Math.round(gap));
  // its line deleted: the drawing stays (on the line before)
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await ink(page)).toHaveLength(1);
  const ids = await ed(page, (e) => e.doc.blocks.map((b: any) => b.id));
  expect(ids).toContain((await ink(page))[0].at);
});

test('a pen on the note draws without asking; typing goes back to the text', async ({ page }) => {
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 30, t.x + 120, t.y + 40));
  expect(await mode(page)).toBe('sketch');
  expect(await ink(page)).toHaveLength(1);
  expect((await ink(page))[0]).toMatchObject({ k: 'ink', pen: true });
  await page.keyboard.type('!');
  expect(await mode(page)).toBe('text');
  expect(await text(page)).toBe('notes!');
});

test('undo takes back a stroke on the note; it is kept with the note', async ({ page }) => {
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 30, t.x + 120, t.y + 40));
  await stroke(page, 'pen', line(t.x, t.y + 60, t.x + 120, t.y + 70));
  expect(await ink(page)).toHaveLength(2);
  await page.keyboard.press('Control+z');
  expect(await ink(page)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect.poll(() => ed(page, (e) => e.dirty), { timeout: 5000 }).toBe(false);
  await page.reload();
  await page.waitForFunction(() => (window as any).__nx);
  expect(await ink(page)).toHaveLength(1);
  await expect(page.locator('.note-ink path')).toHaveCount(1);
});

test('with the pen setting off, a pen on the note is a pointer as any other', async ({ page }) => {
  await page.evaluate(() => { const e = (window as any).__nx.ed; e.updateConfig({ sketch: { ...e.config.sketch, penDraws: false } }); });
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 10, t.x + 120, t.y + 12));
  expect(await mode(page)).toBe('text');
  expect(await ink(page)).toHaveLength(0);
});

// ── fingers ──

test('no pen used yet: a finger draws', async ({ page }) => {
  await type(page, 'notes');
  await page.keyboard.press('Control+Shift+d');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'touch', line(t.x, t.y + 30, t.x + 120, t.y + 40));
  expect(await ink(page)).toHaveLength(1);
  expect((await ink(page))[0].pen).toBeUndefined();
});

test('once a pen has been used, a finger scrolls instead (and a tap still places the caret)', async ({ page }) => {
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter');
  await type(page, 'end');
  await page.keyboard.press('Control+Home');
  await type(page, 'start');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 40, t.x + 50, t.y + 45));
  await page.keyboard.press('Escape');
  await penAway(page);
  expect(await sk(page, (s) => s.touchDraws)).toBe(false);
  const scroll = () => page.locator('.scroller').evaluate((e) => e.scrollTop);
  await page.locator('.scroller').evaluate((e) => (e.scrollTop = 0));
  await stroke(page, 'touch', line(t.x + 200, t.y + 400, t.x + 200, t.y + 100));
  expect(await scroll()).toBeGreaterThan(200);
  expect(await ink(page)).toHaveLength(1);
  // a tap: the caret there
  // (once the flick has stopped coasting)
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(1500);
  await page.locator('.scroller').evaluate((e) => (e.scrollTop = 0));
  const first = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'touch', [[first.x + 30, first.y + first.height / 2]]);
  expect(await ed(page, (e) => [e.mode, e.b])).toEqual(['text', 0]);
  // and in drawing mode, a finger scrolls too
  await page.keyboard.press('Control+Shift+d');
  await stroke(page, 'touch', line(t.x + 200, t.y + 400, t.x + 200, t.y + 100));
  expect(await scroll()).toBeGreaterThan(200);
  expect(await ink(page)).toHaveLength(1);
});

test('a palm while the pen is near does nothing', async ({ page }) => {
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 30, t.x + 60, t.y + 35));
  // the pen hovers: a palm comes down and moves
  await stroke(page, 'touch', line(t.x + 100, t.y + 200, t.x + 300, t.y + 260));
  expect(await ink(page)).toHaveLength(1);
});

test('the finger setting: draw always', async ({ page }) => {
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'pen', line(t.x, t.y + 30, t.x + 60, t.y + 35));
  await penAway(page);
  await page.evaluate(() => { const e = (window as any).__nx.ed; e.updateConfig({ sketch: { ...e.config.sketch, touch: 'draw' } }); });
  await stroke(page, 'touch', line(t.x + 100, t.y + 80, t.x + 300, t.y + 90));
  expect(await ink(page)).toHaveLength(2);
});

test('a second finger turns a finger stroke into a scroll', async ({ page }) => {
  await type(page, 'notes');
  await page.keyboard.press('Control+Shift+d');
  const t = (await page.locator('.block').first().boundingBox())!;
  await stroke(page, 'touch', line(t.x, t.y + 30, t.x + 60, t.y + 35), { id: 11, up: false });
  await stroke(page, 'touch', line(t.x + 100, t.y + 80, t.x + 100, t.y + 60), { id: 12 });
  await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 11, clientX: x, clientY: y, bubbles: true })), [t.x + 60, t.y + 35]);
  expect(await ink(page)).toHaveLength(0);
});

// ── the bars ──

test('the toolbar: diagram makes one, the pen draws on the note and stops', async ({ page }) => {
  await type(page, 'x');
  await page.locator('.toolbar .b-diagram').click();
  expect(await ed(page, (e) => e.doc.blocks.some((b: any) => b.kind === 'diagram'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('.toolbar .b-pen').click();
  expect(await sk(page, (s) => s.on?.kind)).toBe('free');
  await page.locator('.toolbar .b-pen').click();
  expect(await mode(page)).toBe('text');
});

test('the drawing bar picks tools and styles, and is done', async ({ page }) => {
  await diagram(page);
  await page.locator('.sbar button[aria-label="ellipse"]').click();
  expect(await sk(page, (s) => s.tool)).toBe('ellipse');
  await page.locator('.sbar button[aria-label="blue colour"]').click();
  await page.locator('.sbar button[aria-label="dashed"]').click();
  expect(await sk(page, (s) => [s.color, s.dash])).toEqual(['blue', true]);
  await page.locator('.sbar .done').click();
  expect(await mode(page)).toBe('text');
});

test('printing: what is drawn on the note stays with its line', async ({ page }) => {
  await type(page, 'one');
  await page.keyboard.press('Enter');
  await type(page, 'two');
  const two = (await page.locator('.block').nth(1).boundingBox())!;
  await stroke(page, 'pen', line(two.x, two.y + 8, two.x + 150, two.y + 12));
  await page.keyboard.press('Escape');
  const gap = async () => (await page.locator('.note-ink path').first().boundingBox())!.y - (await page.locator('.block').nth(1).boundingBox())!.y;
  const before = await gap();
  await page.evaluate(() => (window as any).__nx.ed.beginPrint());
  await expect.poll(async () => Math.round(await gap())).toBe(Math.round(before));
  await page.evaluate(() => (window as any).__nx.ed.endPrint());
});

test('in a diagram, shapes keep to its grid; alt held, they go where they are put', async ({ page }) => {
  const c = await diagram(page);
  await drag(page, c.at(43, 37), c.at(203, 109));
  await page.keyboard.press('Escape');
  let [s] = await shapes(page);
  expect(s).toMatchObject({ x: 40, y: 40, w: 160, h: 72 });
  // moved by 13, 5: by 16, 8
  await drag(page, c.at(100, 70), c.at(113, 75));
  [s] = await shapes(page);
  expect([s.x, s.y]).toEqual([56, 48]);
  await drag(page, c.at(120, 70), c.at(123, 77), ['Alt']);
  [s] = await shapes(page);
  expect([s.x, s.y]).toEqual([59, 55]);
});

test('right-click while drawing: what can be done to the shape there, or what can be drawn', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.click(...c.at(100, 60), { button: 'right' });
  const names = () => page.locator('.dmenu .opt .name').allInnerTexts();
  expect((await names()).slice(0, 4)).toEqual(['type its label', 'duplicate', 'bring to front', 'send to back']);
  await page.locator('.dmenu .opt', { hasText: 'duplicate' }).click();
  expect(await shapes(page)).toHaveLength(2);
  // on nothing: the tools
  await page.mouse.click(...c.at(500, 220), { button: 'right' });
  expect((await names()).slice(0, 2)).toEqual(['draw a box', 'draw an ellipse']);
  await page.locator('.dmenu .opt', { hasText: 'draw a diamond' }).click();
  expect(await sk(page, (s) => s.tool)).toBe('diamond');
  // a click elsewhere closes it without drawing
  await page.mouse.click(...c.at(500, 220), { button: 'right' });
  await page.mouse.click(...c.at(400, 200));
  await expect(page.locator('.dmenu')).toHaveCount(0);
  expect(await shapes(page)).toHaveLength(2);
});

test('a right-click on a diagram from the text goes into it, with its menu', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await mode(page)).toBe('text');
  await page.mouse.click(...c.at(100, 60), { button: 'right' });
  expect(await mode(page)).toBe('sketch');
  await expect(page.locator('.dmenu .opt', { hasText: 'bring to front' })).toBeVisible();
});

test('a label on an arrow: enter on it, or a double-click; it sits on the line', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab'); // the arrow
  const sel = await sk(page, (s) => s.selected[0].k);
  expect(sel).toBe('line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('yes');
  await page.keyboard.press('Enter');
  const line = (await shapes(page)).find((s) => s.k === 'line');
  expect(line.label).toBe('yes');
  await expect(page.locator('svg.canvas .label.on-line')).toHaveText('yes');
});

test('] and [ bring the selection to the front and send it to the back', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.click(...c.at(300, 60));
  await page.keyboard.press('Escape');
  const [a, b] = await shapes(page);
  await page.keyboard.press('[');
  expect((await shapes(page)).map((s) => s.id)).toEqual([b.id, a.id]);
  await page.keyboard.press(']');
  expect((await shapes(page)).map((s) => s.id)).toEqual([a.id, b.id]);
});

// ── the pen's extras ──

/** A pen along points, held still at the end for a moment before it lifts. */
async function held(page: Page, pts: P[], ms = 800) {
  await stroke(page, 'pen', pts, { up: false });
  await page.waitForTimeout(ms);
  const [x, y] = pts[pts.length - 1];
  await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', pointerId: 7, clientX: x, clientY: y, bubbles: true })), [x, y]);
}
const circle = (cx: number, cy: number, rx: number, ry: number, n = 40): P[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI) + Math.sin(i * 5) * 1.5, cy + ry * Math.sin((i / n) * 2 * Math.PI), 0.5]);

test('a rough circle held still at its end becomes an ellipse; lifted at once, it stays a stroke', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('p');
  await held(page, circle(c.x + 200, c.y + 120, 70, 40));
  let list = await shapes(page);
  expect(list.map((s) => s.k)).toEqual(['ellipse']);
  expect(list[0].w).toBeGreaterThan(120);
  await stroke(page, 'pen', circle(c.x + 450, c.y + 120, 60, 40));
  list = await shapes(page);
  expect(list.map((s) => s.k)).toEqual(['ellipse', 'ink']);
});

test('a rough line held still becomes a line; between two boxes it joins them', async ({ page }) => {
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await page.mouse.click(...c.at(420, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await held(page, line(c.x + 110, c.y + 62, c.x + 410, c.y + 58, 20));
  const list = await shapes(page);
  const ln = list.find((s) => s.k === 'line');
  expect([ln.a.to, ln.b.to]).toEqual([list[0].id, list[1].id]);
});

test('on the note too: a box drawn by pen and held', async ({ page }) => {
  await type(page, 'notes');
  const t = (await page.locator('.block').first().boundingBox())!;
  const x = t.x + 40, y = t.y + 60;
  const sq: P[] = [...line(x, y, x + 120, y, 10), ...line(x + 120, y, x + 120, y + 70, 6).slice(1), ...line(x + 120, y + 70, x, y + 70, 10).slice(1), ...line(x, y + 70, x, y + 2, 6).slice(1)];
  await held(page, sq);
  expect((await ink(page)).map((s) => s.k)).toEqual(['rect']);
});

test('the highlighter: wide, see-through strokes', async ({ page }) => {
  await type(page, 'highlight these words');
  await page.keyboard.press('Control+Shift+d');
  await page.keyboard.press('h');
  const t = (await page.locator('.block').first().boundingBox())!;
  await drag(page, [t.x + 5, t.y + t.height / 2], [t.x + 150, t.y + t.height / 2]);
  const [s] = await ink(page);
  expect(s).toMatchObject({ k: 'ink', hl: true });
  await expect(page.locator('.note-ink path.hl')).toHaveCount(1);
  expect(Number(await page.locator('.note-ink path.hl').getAttribute('stroke-width'))).toBeGreaterThan(10);
});

test('on the note, a line joined to a deleted box lets go too', async ({ page }) => {
  await type(page, 'notes');
  await page.keyboard.press('Control+Shift+d');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  const list = await ink(page);
  expect(list.map((s) => s.k)).toEqual(['rect', 'line']);
  expect(list[1].b.to).toBeUndefined();
});

test('backspace in the empty caption of a diagram takes it away; undo brings it back', async ({ page }) => {
  await type(page, 'above');
  await page.keyboard.press('Enter');
  const c = await diagram(page);
  await page.mouse.click(...c.at(100, 60));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await ed(page, (e) => [e.mode, e.blk.kind])).toEqual(['text', 'diagram']);
  await page.keyboard.press('Backspace');
  expect(await ed(page, (e) => e.doc.blocks.map((b: any) => b.kind))).toEqual(['p', 'p']);
  await page.keyboard.press('Control+z');
  expect(await ed(page, (e) => e.doc.blocks.map((b: any) => b.kind))).toEqual(['p', 'diagram', 'p']);
  expect(await shapes(page)).toHaveLength(1);
});

test('a box grows to hold its label; with no room to the right, the next box goes below', async ({ page }) => {
  const c = await diagram(page);
  await page.keyboard.press('Enter'); // a first box, at the left
  await page.keyboard.type('a rather long label for a box');
  await page.keyboard.press('Enter');
  let [s] = await shapes(page);
  expect(s.x).toBeLessThan(60);
  expect(s.w).toBeGreaterThan(160);
  // right, right, right…: until there's no room, then down
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Control+ArrowRight');
    await page.keyboard.press('Escape');
  }
  const boxes = (await shapes(page)).filter((x) => x.k === 'rect');
  const w = await ed(page, (e) => e.blk.w);
  for (const b of boxes) expect(b.x + b.w).toBeLessThanOrEqual(w);
  expect(Math.max(...boxes.map((b) => b.y))).toBeGreaterThan(s.y);
});
