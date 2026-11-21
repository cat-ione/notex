// Note-layout lab: run every scenario in scenarios.mjs against the dev server,
// screenshot it, measure the layout (see src/lib/dev.ts), and build contact sheets.
//
//   pnpm dev                                   # in another terminal
//   node tools/label-lab/lab.mjs <tag>         # writes tools/label-lab/out/<tag>/
//
// Uses playwright-core; set CHROME to a Chromium/Chrome executable if it can't find one.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { scenarios } from './scenarios.mjs';

const tag = process.argv[2] ?? 'run';
const dir = new URL(`./out/${tag}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: Number(process.env.SCALE ?? 1) });
await page.setViewportSize({ width: 1000, height: 900 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(process.env.URL ?? 'http://127.0.0.1:1420/');
await page.waitForFunction(() => window.__nx);
await page.evaluate(() => document.fonts.ready);

const all = [];
for (let n = 0; n < scenarios.length; n++) {
  const sc = scenarios[n];
  await page.evaluate((sc) => window.__nx.load([sc]), sc);
  // let layout settle (spacer passes)
  await page.waitForTimeout(450);
  const m = await page.evaluate(() => window.__nx.metrics());
  all.push({ scenario: sc.title, ...m });
  const clip = await page.evaluate(() => {
    const p = document.querySelector('.page').getBoundingClientRect();
    const els = [...document.querySelectorAll('.block, .dlabel, .marks path')].map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
    const top = Math.min(...els.map((r) => r.top)) - 6, bottom = Math.max(...els.map((r) => r.bottom)) + 8;
    return { x: p.left, y: Math.max(0, top), width: p.width, height: Math.min(860, bottom - Math.max(0, top)) };
  });
  await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}.png`, clip });
}

// contact sheets: 6 per sheet
const files = scenarios.map((_, n) => `${String(n).padStart(2, '0')}.png`);
for (let s = 0; (process.env.SCALE ?? '1') === '1' && s * 6 < files.length; s++) {
  const imgs = files.slice(s * 6, s * 6 + 6).map((f) => `<div><img src="data:image/png;base64,${readFileSync(`${dir}/${f}`).toString('base64')}"></div>`).join('');
  await page.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:1fr 1fr;gap:4px">${imgs}</body>`);
  await page.setViewportSize({ width: 2000, height: 600 });
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 2000, height: h });
  await page.screenshot({ path: `${dir}/sheet${s}.png`, fullPage: true });
}

writeFileSync(`${dir}/metrics.json`, JSON.stringify(all, null, 1));
// summary table
const pad = (v, n) => String(v).padStart(n);
console.log('scenario'.padEnd(46), 'ink', ' note', 'shape', 'maxDx', 'lead', 'off', 'x', 'inv', 'room');
let T = { ink: 0, note: 0, shape: 0, lead: 0, off: 0, cross: 0, inv: 0, room: 0 };
for (const r of all) {
  const t = r.totals[0] ?? { inkHit: 0, noteHit: 0, shapeHit: 0, maxDx: 0, sumLeader: 0, offPage: 0, crossings: 0, inversions: 0 };
  console.log(r.scenario.slice(0, 45).padEnd(46), pad(t.inkHit, 4), pad(t.noteHit, 4), pad(t.shapeHit, 5), pad(t.maxDx, 5), pad(t.sumLeader, 4), pad(t.offPage, 3), pad(t.crossings, 1), pad(t.inversions, 3), pad(r.room, 4));
  T.ink += t.inkHit; T.note += t.noteHit; T.shape += t.shapeHit; T.lead += t.sumLeader; T.off += t.offPage; T.cross += t.crossings; T.inv += t.inversions; T.room += r.room;
}
console.log('TOTAL', JSON.stringify(T));
console.log(errs.join('\n') || 'no errors');
await browser.close();
