// Performance harness: everyday editing on large notes, against the dev server.
//
//   pnpm dev                          # in another terminal
//   node tools/perf/perf.mjs [--profile] [--file=note.ntx]
//
// For each document it measures how long actions take (keydown to the next
// painted frame after the editor settles: median / p95 / max), how many
// layouts each action triggers and how long they take. --file measures a note
// of yours instead of the built-in ones. --profile prints the hottest functions
// (INCLUSIVE=1: with callees; CALLERS=<regex>: who calls them). CULL=Infinity
// lays out every drawing, not just those near the screen.
// Uses playwright-core; set CHROME to a Chromium/Chrome executable if needed.

import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { scenarios } from '../label-lab/scenarios.mjs';

// --profile: profile typing; --profile=<text>: profile the actions whose name contains <text>
const FILE = process.argv.find((a) => a.startsWith('--file='))?.slice(7);
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
await page.evaluate((cull) => {
  const ed = window.__nx.ed;
  if (cull) ed.cullScreens = Number(cull);
  const S = (window.__perf = { layouts: 0, layoutMs: 0, lat: [] });
  const layout = ed.layout.bind(ed);
  ed.layout = () => {
    S.layouts++;
    const t = performance.now();
    const r = layout();
    S.layoutMs += performance.now() - t;
    return r;
  };
  window.addEventListener('keydown', () => {
    const t = performance.now();
    requestAnimationFrame(() => setTimeout(() => S.lat.push(performance.now() - t)));
  }, true);
}, process.env.CULL);
const reset = () => page.evaluate(() => ((window.__perf.layouts = 0), (window.__perf.layoutMs = 0), (window.__perf.lat = [])));
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
  rows.push({ doc, name, median: q(0.5), p95: q(0.95), max: lat[lat.length - 1] ?? 0, perAction: s.layouts / n, layoutMs: s.layoutMs / n });
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
  if (process.env.INCLUSIVE) {
    // inclusive time of app functions
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incl = new Map();
    profile.samples.forEach((id, i) => {
      const seen = new Set();
      for (let p = id; p; p = parent.get(p)) {
        const f = byId.get(p).callFrame;
        if (!/src\/lib/.test(f.url)) continue;
        const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
      }
    });
    console.log('  inclusive:');
    for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(0).padStart(6)}ms  ${k}`);
  }
  if (process.env.CALLERS) {
    // which app functions the time is spent under (inclusive), for functions matching CALLERS
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const under = new Map();
    profile.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      if (!new RegExp(process.env.CALLERS).test(f.functionName)) return;
      const chain = [];
      for (let p = parent.get(id); p && chain.length < 4; p = parent.get(p)) {
        const pf = byId.get(p).callFrame;
        if (/src\/lib/.test(pf.url)) chain.push(`${pf.functionName || '(anon)'}:${pf.lineNumber + 1}`);
      }
      const k = chain.join(' < ');
      under.set(k, (under.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
    });
    console.log(`  callers of /${process.env.CALLERS}/:`);
    for (const [k, v] of [...under].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${v.toFixed(0).padStart(6)}ms  ${k}`);
  }
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
  // typing in a paragraph that has drawings on it
  const drawn = await page.evaluate(() => {
    const ed = window.__nx.ed;
    const ids = new Set(ed.doc.marks.flatMap((m) => m.at));
    const b = ed.doc.blocks.findIndex((blk, i) => i > 3 && blk.items.some((it) => ids.has(it.id)) && blk.items.filter((x) => x.t === 'c').length > 20);
    if (b < 0) return false;
    ed.b = b;
    ed.o = ed.doc.blocks[b].items.findIndex((x) => x.t === 'c') + 2;
    ed.anchor = null;
    return true;
  });
  if (drawn) {
    // (the first keystroke lays out the drawings around it for the first time)
    await settle();
    await page.keyboard.type('a');
    await settle(300);
    await page.keyboard.type('a');
    await settle(600);
    await measure(doc, 'type near drawings', 25, () => page.keyboard.type('abcdefghij klmnop qrstuvw'[Math.floor(Math.random() * 25)]));
  }
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
  // scrolling through the note (drawings are laid out as they come near the screen)
  await page.evaluate(() => (window.__nx.ed.page.parentElement.scrollTop = 0));
  await settle(600);
  await reset();
  const scrollLat = [];
  for (let i = 0; i < 30; i++) {
    scrollLat.push(await page.evaluate(() => new Promise((r) => {
      const t = performance.now();
      window.__nx.ed.page.parentElement.scrollTop += 300;
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t))));
    })));
    await page.waitForTimeout(30);
  }
  {
    const s = await stats(), lat = scrollLat.sort((a, b) => a - b);
    rows.push({ doc, name: 'scroll 300px', median: lat[15], p95: lat[28], max: lat[29], perAction: s.layouts / 30, layoutMs: s.layoutMs / 30 });
  }
  // autosave
  const persistMs = await page.evaluate(() => { const t = performance.now(); window.__nx.ed.persist(); return performance.now() - t; });
  rows.push({ doc, name: 'autosave (sync part)', median: persistMs, p95: persistMs, max: persistMs, perAction: 0 });
}

if (FILE) await suite(FILE.split(/[\/]/).pop(), () => page.evaluate((t) => window.__nx.loadText(t), readFileSync(FILE, 'utf8')));
else {
await suite('long prose', () => page.evaluate(() => window.__nx.loadBig({ paras: 200, chars: 400 })));
await suite('many drawings', () => page.evaluate((scs) => window.__nx.load([...scs, ...scs, ...scs]), scenarios));
}

console.log('\n' + 'document'.padEnd(15) + 'action'.padEnd(26) + 'median'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + '  layouts/action  layout ms');
for (const r of rows)
  console.log(r.doc.padEnd(15) + r.name.padEnd(26) + `${r.median.toFixed(1)}`.padStart(8) + `${r.p95.toFixed(1)}`.padStart(8) + `${r.max.toFixed(1)}`.padStart(8) + `  ${r.perAction.toFixed(1)}`.padEnd(17) + `${(r.layoutMs ?? 0).toFixed(1)}`.padStart(9));
console.log(errs.join('\n') || '\nno errors');
await browser.close();
