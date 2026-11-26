// A touch screen's keyboard: a tap on the text with a finger or pen brings it up (a hidden
// field takes the focus), and what it types (often not as keys: as changes to the field's
// text, words rewritten by its suggestions) reaches the page.
import { test, expect, open, fresh, type, text, ed } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

/** A tap with a finger at (x, y) (as far as the page's own handlers go: no mouse events after it). */
async function tap(page: Page, x: number, y: number) {
  await page.evaluate(([x, y]) => {
    for (const type of ['pointerdown', 'pointerup'])
      (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 60, isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, [x, y]);
  await page.waitForTimeout(50);
}

/** The keyboard's field set to `value` (its filler kept in front), as a touch keyboard changes it. */
async function keyboardTypes(page: Page, value: string, o: { composing?: 'start' | 'end' } = {}) {
  await page.evaluate(
    ([value, c]) => {
      const t = document.querySelector('.kbd-sink') as HTMLTextAreaElement;
      if (c === 'start') t.dispatchEvent(new CompositionEvent('compositionstart'));
      t.value = '​​' + value;
      t.dispatchEvent(new InputEvent('input', { bubbles: true }));
      if (c === 'end') t.dispatchEvent(new CompositionEvent('compositionend'));
    },
    [value, o.composing ?? ''] as const,
  );
}

const sinkFocused = (page: Page) => page.evaluate(() => document.activeElement === document.querySelector('.kbd-sink'));

test('a finger’s tap on the text puts the keyboard’s field in focus (a mouse click doesn’t)', async ({ page }) => {
  await type(page, 'hello');
  await page.mouse.click(300, 120);
  expect(await sinkFocused(page)).toBe(false);
  await tap(page, 300, 120);
  expect(await sinkFocused(page)).toBe(true);
});

test('what the keyboard types reaches the page, letters and Backspace', async ({ page }) => {
  await tap(page, 300, 120);
  await keyboardTypes(page, 'hi');
  expect(await text(page)).toBe('hi');
  // its Backspace: the field shorter than it was (on its filler, when it was empty)
  await keyboardTypes(page, 'h');
  expect(await text(page)).toBe('h');
  await keyboardTypes(page, '');
  // (and a Backspace with nothing typed since: on the filler)
  await page.evaluate(() => {
    const t = document.querySelector('.kbd-sink') as HTMLTextAreaElement;
    t.value = '​';
    t.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  expect(await text(page)).toBe('');
});

test('a word typed as it’s composed, then corrected by the keyboard', async ({ page }) => {
  await tap(page, 300, 120);
  await keyboardTypes(page, 't', { composing: 'start' });
  await keyboardTypes(page, 'te');
  await keyboardTypes(page, 'teh');
  expect(await text(page)).toBe('teh');
  // the suggestion taken: the word rewritten, a space after it
  await keyboardTypes(page, 'the ', { composing: 'end' });
  expect(await text(page)).toBe('the ');
  await keyboardTypes(page, 'cat');
  expect(await text(page)).toBe('the cat');
});

test('the keyboard types math too: $ starts a formula as ever', async ({ page }) => {
  await tap(page, 300, 120);
  await keyboardTypes(page, 'see ');
  await keyboardTypes(page, '$');
  await keyboardTypes(page, '$x');
  await keyboardTypes(page, '$x^2');
  expect(await ed(page, (e) => e.mode)).toBe('math');
  expect((await page.evaluate(() => (window as any).__nx.formulas()))[0]).toBe('x^{2}');
});

test('keys a keyboard sends as keys (Enter, a keyboard plugged in) go to the page once', async ({ page }) => {
  await tap(page, 300, 120);
  await page.keyboard.type('ab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('c');
  expect(await text(page)).toBe('ab\nc');
  expect(await page.evaluate(() => (document.querySelector('.kbd-sink') as HTMLTextAreaElement).value)).toBe('​​');
});

test('drawing sends the keyboard away', async ({ page }) => {
  await tap(page, 300, 120);
  expect(await sinkFocused(page)).toBe(true);
  await page.keyboard.press('Control+Shift+D');
  await expect.poll(() => sinkFocused(page)).toBe(false);
});
