// Tables under random editing: seeded random sequences of keys, clicks, drags, pastes and
// undo in and around a table. After every step the table must still be whole: its header
// and separator there, every row it has tidy (but the one being edited), the caret in a
// cell's text. A failure prints the seed, the steps and the note before and after.
import { test, expect, open, fresh, type } from './helpers';
import type { Page } from '@playwright/test';

/** A small seeded random number generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type State = { text: string[]; rows: [number, string, number][]; b: number; o: number; mode: string; spans: [number, number][] | null; anchor: { b: number; o: number } | null };

const state = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const nx = (window as any).__nx;
    const e = nx.ed;
    return {
      text: e.doc.blocks.map((b: any) => b.items.map((i: any) => (i.t === 'c' ? i.ch : '§')).join('')),
      rows: nx.tables(),
      b: e.b,
      o: e.o,
      mode: e.mode,
      spans: e.mode === 'text' ? e.cellSpans(e.b) : null,
      anchor: e.anchor,
    };
  });

/** What's wrong with the table now ([] when nothing). */
function problems(s: State, tableGone: boolean): string[] {
  const out: string[] = [];
  if (tableGone) return out;
  // every table has its separator (a table can be added: by pasting one)
  for (const [b, role, t] of s.rows) if (role === 'head' && !s.rows.some((r) => r[1] === 'sep' && r[2] === t)) out.push(`table at ${b} has no separator`);
  for (const [b, role] of s.rows) {
    const t = s.text[b];
    if (role === 'sep' && !/^(\| :?-+:? )+\|$/.test(t) && b !== s.b) out.push(`separator untidy: ${JSON.stringify(t)}`);
    if (b === s.b) continue;
    // | cell | cell |: one space either side of each cell's text (none in an empty cell's)
    if (!/^(\| (?:[^ |](?:[^|]*[^ |])?)? )+\|$/.test(t)) out.push(`row ${b} untidy: ${JSON.stringify(t)}`);
  }
  // every row has its header's columns
  const cols = (t: string) => (t.match(/\|/g) ?? []).length - 1;
  for (const [b, , t] of s.rows) {
    if (b === s.b || t === s.b) continue;
    // (a row can have more: the cells of a table made from lines of text are all kept)
    const n = cols(s.text[t]), role = s.rows.find((r) => r[0] === b)![1];
    if (role === 'sep' ? cols(s.text[b]) !== n : cols(s.text[b]) < n) out.push(`row ${b} has ${cols(s.text[b])} columns, its header ${n}: ${JSON.stringify(s.text[b])}`);
  }
  if (s.mode === 'text' && s.spans && !s.spans.some(([a, z]) => s.o >= a && s.o <= z)) out.push(`caret off the cells: row ${s.b} at ${s.o} in ${JSON.stringify(s.text[s.b])}`);
  return out;
}

const KEYS = [
  'Control+Enter', 'Shift+Enter',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown',
  'Shift+Home', 'Shift+End', 'Control+ArrowLeft', 'Control+ArrowRight', 'Control+Shift+ArrowRight', 'Backspace', 'Delete', 'Control+Backspace',
  'Control+Delete', 'Enter', 'Tab', 'Shift+Tab', 'Control+z', 'Control+y', 'Alt+ArrowUp', 'Alt+ArrowDown',
];
const TYPED = ['a', 'b', 'x', ' ', ' ', '|', '-', '1', 'Q'];

async function step(page: Page, r: () => number): Promise<string> {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const roll = r();
  if (roll < 0.45) {
    const k = pick(KEYS);
    await page.keyboard.press(k);
    return k;
  }
  if (roll < 0.75) {
    const c = pick(TYPED);
    await page.keyboard.press(c === ' ' ? 'Space' : c);
    return `type ${JSON.stringify(c)}`;
  }
  // somewhere in the note: a character, a pipe, the end of a line
  const pt = await page.evaluate((u) => {
    const chars = [...document.querySelectorAll('.page .block .ch, .page .block .eol')];
    const el = chars[Math.floor(u[0] * chars.length)];
    const rr = el.getBoundingClientRect();
    return { x: rr.left + rr.width * u[1], y: rr.top + rr.height / 2 };
  }, [r(), r()]);
  if (roll < 0.82) {
    await page.mouse.click(pt.x, pt.y);
    return `click ${Math.round(pt.x)},${Math.round(pt.y)}`;
  }
  if (roll < 0.88) {
    const kind = pick(['shift', 'double', 'triple']);
    if (kind === 'shift') {
      await page.keyboard.down('Shift');
      await page.mouse.click(pt.x, pt.y);
      await page.keyboard.up('Shift');
    } else await page.mouse.click(pt.x, pt.y, { clickCount: kind === 'double' ? 2 : 3 });
    return `${kind}-click ${Math.round(pt.x)},${Math.round(pt.y)}`;
  }
  if (roll < 0.96) {
    const to = await page.evaluate((u) => {
      const chars = [...document.querySelectorAll('.page .block .ch, .page .block .eol')];
      const rr = chars[Math.floor(u * chars.length)].getBoundingClientRect();
      return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 };
    }, r());
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    return `drag ${Math.round(pt.x)},${Math.round(pt.y)} → ${Math.round(to.x)},${Math.round(to.y)}`;
  }
  const text = pick(['pasted', 'two\nlines', 'a|b', '| p | q |\n| - | - |\n| 1 | 2 |']);
  await page.evaluate((t) => (window as any).__nx.ed.paste({ clipboardData: { getData: (k: string) => (k === 'text/plain' ? t : ''), types: ['text/plain'], files: [] }, preventDefault() {} }), text);
  return `paste ${JSON.stringify(text)}`;
}

// (more for a longer hunt: FUZZ_SEEDS=200 FUZZ_STEPS=300 pnpm test:e2e table-fuzz)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.FUZZ_SEEDS ?? 24), STEPS = Number(env.FUZZ_STEPS ?? 150), FROM = Number(env.FUZZ_FROM ?? 1);

for (const seed of Array.from({ length: SEEDS }, (_, i) => i + FROM)) {
  test(`a table survives random editing (seed ${seed})`, async ({ page, errors }) => {
    test.setTimeout(60_000 + STEPS * 1000);
    const stacks: string[] = [];
    page.on('pageerror', (e) => stacks.push((e.stack ?? '').split('\n').slice(0, 8).join('\n')));
    await open(page);
    await fresh(page);
    await type(page, 'Above the table.');
    await page.keyboard.press('Enter');
    await type(page, '| name | value |');
    await page.keyboard.press('Enter');
    await type(page, '| --- | --- |');
    await page.keyboard.press('Enter');
    await type(page, '| alpha | 1 |');
    await page.keyboard.press('Enter');
    await type(page, '| beta | 2 |');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await type(page, 'Below the table.');
    await page.keyboard.press('Control+Home');
    const r = rng(seed);
    const log: string[] = [];
    let prev = await state(page);
    expect(problems(prev, false)).toEqual([]);
    for (let i = 0; i < STEPS; i++) {
      const what = await step(page, r);
      log.push(what);
      if (env.FUZZ_TRACE === String(seed)) {
        const t = await state(page);
        console.log(`${i} ${what}  →  ${t.b}:${t.o}${t.anchor ? ` (${t.anchor.b}:${t.anchor.o})` : ''}\n` + t.text.map((x, k) => `    ${k} ${x}`).join('\n'));
      }
      const s = await state(page);
      // (the whole table selected and deleted, or undone out of existence, is fine)
      const gone = !s.rows.length;
      const bad = [...problems(s, gone), ...errors.map((m) => `error: ${m}`), ...stacks];
      if (bad.length) {
        throw new Error(
          [`seed ${seed}, step ${i}: ${what}`, ...bad, '', `(caret before: ${prev.b}:${prev.o}${prev.anchor ? `, anchor ${prev.anchor.b}:${prev.anchor.o}` : ''}, ${prev.mode})`, 'before:', ...prev.text.map((t, k) => `  ${k}${k === prev.b ? '*' : ' '} ${t}`), 'after:', ...s.text.map((t, k) => `  ${k}${k === s.b ? '*' : ' '} ${t}`), '', 'steps:', ...log.slice(-15).map((l) => '  ' + l)].join('\n'),
        );
      }
      if (gone) break;
      prev = s;
    }
  });
}
