// Performance harness: everyday editing on large notes, against the dev server.
//
//   pnpm dev                          # in another terminal
//   node tools/perf/perf.mjs [--profile]
//
// For each document it measures how long actions take (keydown to the next
// painted frame after the editor settles: median / p95 / max) and how many
// layouts each action triggers. --profile prints the hottest functions.
// Uses playwright-core; set CHROME to a Chromium/Chrome executable if needed.

import { chromium } from 'playwright-core';
import { scenarios } from '../label-lab/scenarios.mjs';

// --profile: profile typing; --profile=<text>: profile the actions whose name contains <text>
const PROFILE = (process.argv.find((a) => a.startsWith('--profile')) ?? '').replace(/^--profile=?/, '') || (process.argv.includes('--profile') ? 'type' : null);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
const page = await browser.newPage();
await page.setViewportSize({ width: 1100, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(process.env.URL ?? 'http://127.0.0.1:1420/');
await page.waitForFunction(() => window.__nx);
const cdp = await page.context().newCDPSession(page);

// instrument once: layout counter and per-key latency
await page.evaluate(() => {
  const ed = window.__nx.ed;
  const S = (window.__perf = { layouts: 0, lat: [] });
  const layout = ed.layout.bind(ed);
  ed.layout = () => (S.layouts++, layout());
  window.addEventListener('keydown', () => {
    const t = performance.now();
    requestAnimationFrame(() => setTimeout(() => S.lat.push(performance.now() - t)));
  }, true);
});
const reset = () => page.evaluate(() => ((window.__perf.layouts = 0), (window.__perf.lat = [])));
const stats = () => page.evaluate(() => window.__perf);
const settle = (ms = 300) => page.waitForTimeout(ms);
const key = (k) => page.keyboard.press(k);

const rows = [];
async function measure(doc, name, n, act) {
  if (PROFILE && name.includes(PROFILE)) {
    return profiled(`${doc} / ${name}`, () => measureRaw(doc, name, n, act));
  }
  return measureRaw(doc, name, n, act);
}

async function measureRaw(doc, name, n, act) {
  await reset();
  for (let i = 0; i < n; i++) {
    await act(i);
    await page.waitForTimeout(40);
  }
  await settle(250);
  const s = await stats();
  const lat = s.lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] ?? 0;
  rows.push({ doc, name, median: q(0.5), p95: q(0.95), max: lat[lat.length - 1] ?? 0, perAction: s.layouts / n });
}

async function profiled(label, fn) {
  if (!PROFILE) return fn();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame;
    if (['(idle)', '(program)', '(garbage collector)'].includes(f.functionName)) return;
    const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  console.log(`\n  hottest in ${label}:`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v.toFixed(0).padStart(6)}ms  ${k}`);
}

async function suite(doc, load) {
  // opening
  const t0 = Date.now();
  await load();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
  const openMs = Date.now() - t0;
  await settle(800);
  const info = await page.evaluate(() => {
    const d = window.__nx.ed.doc;
    let chars = 0, maths = 0;
    for (const b of d.blocks) for (const it of b.items) it.t === 'c' ? chars++ : maths++;
    return { blocks: d.blocks.length, chars, maths, marks: d.marks.length };
  });
  console.log(`\n${doc}: ${info.blocks} blocks, ${info.chars} chars, ${info.maths} formulas, ${info.marks} shapes · opened in ${openMs}ms`);

  // caret into the middle of the document
  await page.evaluate(() => {
    const ed = window.__nx.ed;
    ed.b = Math.floor(ed.doc.blocks.findIndex((b, i) => i > ed.doc.blocks.length / 2 && b.items.length > 40 && b.items.every((x) => x.t === 'c')));
    ed.o = 20;
    ed.anchor = null;
  });
  await settle();
  await measure(doc, 'type a character', 25, () => page.keyboard.type('abcdefghij klmnop qrstuvw'[Math.floor(Math.random() * 25)]));
  await measure(doc, 'arrow left/right', 20, (i) => key(i % 2 ? 'ArrowLeft' : 'ArrowRight'));
  await measure(doc, 'arrow up/down', 12, (i) => key(i % 2 ? 'ArrowUp' : 'ArrowDown'));
  await measure(doc, 'shift-select', 12, () => key('Shift+ArrowRight'));
  await key('ArrowRight');
  await measure(doc, 'backspace', 10, () => key('Backspace'));
  await measure(doc, 'enter (split paragraph)', 5, () => key('Enter'));
  await measure(doc, 'undo', 5, () => key('Control+z'));
  // math: open a formula and type in it
  await page.keyboard.type(' $');
  await settle();
  await measure(doc, 'type in a formula', 20, (i) => page.keyboard.type('x^2+1/y'[i % 7]));
  await key('Escape');
  // autosave
  const persistMs = await page.evaluate(() => { const t = performance.now(); window.__nx.ed.persist(); return performance.now() - t; });
  rows.push({ doc, name: 'autosave (sync part)', median: persistMs, p95: persistMs, max: persistMs, perAction: 0 });
}

await suite('long prose', () => page.evaluate(() => window.__nx.loadBig({ paras: 200, chars: 400 })));
await suite('many drawings', () => page.evaluate((scs) => window.__nx.load([...scs, ...scs, ...scs]), scenarios));

console.log('\n' + 'document'.padEnd(15) + 'action'.padEnd(26) + 'median'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + '  layouts/action');
for (const r of rows)
  console.log(r.doc.padEnd(15) + r.name.padEnd(26) + `${r.median.toFixed(1)}`.padStart(8) + `${r.p95.toFixed(1)}`.padStart(8) + `${r.max.toFixed(1)}`.padStart(8) + `  ${r.perAction.toFixed(1)}`);
console.log(errs.join('\n') || '\nno errors');
await browser.close();
