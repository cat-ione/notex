// Dev-only helpers for layout experiments (exposed as window.__nx in `pnpm dev`).
//
// `load(scenarios)` builds a document from compact scenario specs, and
// `metrics()` measures how the notes ended up: what they cover, how far they
// moved, leader lengths and crossings, order, and how much room was added.

import type { Editor } from './editor.svelte';
import { inkRects, type Rect } from './geom';
import { parseLatex } from './math/parse';
import { rowAt } from './math/edit';
import type { Step } from './math/latex';
import { block, chars, math, uid, type Block, type Doc, type Item, type Mark, type MarkKind, type MRow } from './model';
import { deserialize, withMarkdown } from './format';
import { docToLatex } from './export';
import { findTables } from './tables';
import { toLatex } from './math/latex';
import { PAPER_STYLES } from './pdf';

/** A target: nodes i..j of the row at `path` inside formula `f` (index into the scenario's formulas), or words of the text. */
type Target = { f: number; i: number; j?: number; path?: [number, number][] } | { words: [number, number] };
export type ScenarioMark = { kind: MarkKind; at: Target; label: string };
/** Content: a list of prose strings and formulas ({tex, display?}). */
export type Scenario = { title: string; parts: (string | { tex: string; display?: boolean })[]; marks: ScenarioMark[] };

export function buildDoc(scenarios: Scenario[]): Doc {
  const blocks: Block[] = [];
  const marks: Mark[] = [];
  for (const sc of scenarios) {
    const start = blocks.length;
    blocks.push(block(chars(sc.title), 'h3'));
    const formulas: { root: MRow; id: string }[] = [];
    let items: Item[] = [];
    const flush = () => items.length && (blocks.push(block(items)), (items = []));
    for (const part of sc.parts) {
      if (typeof part === 'string') items.push(...chars(part));
      else {
        const m = math(parseLatex(part.tex).row, !!part.display);
        formulas.push({ root: m.root, id: m.id });
        if (part.display) flush(), blocks.push(block([m]));
        else items.push(m);
      }
    }
    flush();
    // words index over the scenario's prose blocks (all blocks after the title)
    const body = blocks.slice(start + 1);
    const words: string[][] = [];
    for (const b of body) {
      let cur: string[] = [];
      for (const it of b.items) {
        if (it.t === 'c' && !/\s/.test(it.ch)) cur.push(it.id);
        else if (cur.length) words.push(cur), (cur = []);
      }
      if (cur.length) words.push(cur);
    }
    for (const sm of sc.marks) {
      let at: string[];
      if ('words' in sm.at) at = words.slice(sm.at.words[0], sm.at.words[1] + 1).flat();
      else {
        const f = formulas[sm.at.f];
        const row = rowAt(f.root, (sm.at.path ?? []).map(([i, s]) => ({ i, s }) as Step));
        at = row.slice(sm.at.i, (sm.at.j ?? sm.at.i) + 1).map((n) => n.id);
      }
      marks.push({ id: uid(), kind: sm.kind, at, dash: false, label: sm.label });
    }
  }
  return { blocks, arrows: [], marks };
}

const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shrink = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

const segCross = (a: number[], b: number[]) => {
  const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (!d) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
};

/** Measure the current note layout. One row per note, plus per-scenario totals. */
export function metrics(ed: Editor) {
  const page = ed.page!;
  const origin = page.getBoundingClientRect();
  const rel = (r: DOMRect | Rect): Rect => ('left' in r ? { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height } : { ...r, x: r.x - origin.left, y: r.y - origin.top });
  const ink = [...page.querySelectorAll('.block')].flatMap((b) => inkRects(b).map(rel));
  const titleOf = (el: Element | null) => {
    let b = el?.closest('.block');
    while (b && !b.classList.contains('h3')) b = b.previousElementSibling;
    return b?.textContent?.replace(/​|⁠/g, '') ?? '?';
  };
  const notes = ed.doc.marks
    .filter((m) => m.label && ed.markGeos[m.id])
    .map((m) => {
      const lab = page.querySelector(`.dlabel[data-id="${m.id}"]`)!;
      const box = rel(lab.getBoundingClientRect());
      const g = ed.markGeos[m.id];
      const leader = g.leader?.match(/[\d.-]+/g)?.map(Number) ?? null;
      const tipX = leader ? leader[0] : box.x + box.w / 2;
      return { id: m.id, kind: m.kind, label: m.label, scenario: titleOf(page.querySelector(`[data-nx="${m.at[0]}"]`)), box, bounds: g.bounds, leader, tipX };
    });
  const rows = notes.map((n) => {
    const inner = shrink(n.box, 1);
    const inkHit = ink.reduce((s, r) => s + area(inner, r), 0);
    const noteHit = notes.reduce((s, o) => s + (o.id === n.id ? 0 : area(inner, o.box)), 0);
    const shapeHit = notes.reduce((s, o) => s + (o.id === n.id ? 0 : area(inner, o.bounds)), 0) + area(inner, n.bounds);
    const leaderLen = n.leader ? Math.hypot(n.leader[2] - n.leader[0], n.leader[3] - n.leader[1]) : 0;
    const offPage = Math.max(0, -n.box.x) + Math.max(0, n.box.x + n.box.w - page.clientWidth);
    return {
      scenario: n.scenario, kind: n.kind, label: n.label,
      inkHit: Math.round(inkHit), noteHit: Math.round(noteHit), shapeHit: Math.round(shapeHit),
      dx: Math.round(n.box.x + n.box.w / 2 - n.tipX), leader: Math.round(leaderLen), offPage: Math.round(offPage),
      gap: Math.round(n.box.y >= n.bounds.y + n.bounds.h ? n.box.y - (n.bounds.y + n.bounds.h) : n.bounds.y - (n.box.y + n.box.h)),
    };
  });
  // crossings and order inversions per scenario
  const byScenario = new Map<string, typeof notes>();
  for (const n of notes) byScenario.set(n.scenario, [...(byScenario.get(n.scenario) ?? []), n]);
  const totals = [...byScenario].map(([scenario, ns]) => {
    let crossings = 0, inversions = 0;
    for (let a = 0; a < ns.length; a++)
      for (let b = a + 1; b < ns.length; b++) {
        const A = ns[a], B = ns[b];
        if (A.leader && B.leader && segCross(A.leader, B.leader)) crossings++;
        const sameRow = Math.abs(A.box.y - B.box.y) < 6;
        if (sameRow && Math.sign(A.tipX - B.tipX) * Math.sign(A.box.x - B.box.x) < 0) inversions++;
      }
    const rs = rows.filter((r) => r.scenario === scenario);
    return {
      scenario,
      notes: ns.length,
      inkHit: rs.reduce((s, r) => s + r.inkHit, 0),
      noteHit: rs.reduce((s, r) => s + r.noteHit, 0) / 2,
      shapeHit: rs.reduce((s, r) => s + r.shapeHit, 0),
      maxDx: Math.max(0, ...rs.map((r) => Math.abs(r.dx))),
      sumLeader: rs.reduce((s, r) => s + r.leader, 0),
      offPage: rs.reduce((s, r) => s + r.offPage, 0),
      crossings,
      inversions,
    };
  });
  const room = Object.values(ed.spacers).reduce((s, v) => s + (v.above ?? 0) + (v.below ?? 0), 0);
  return { rows, totals, room };
}

/**
 * A large document for performance checks: `paras` paragraphs of about `chars`
 * characters, every `mathEvery`-th paragraph with an inline formula, and a
 * display formula every `displayEvery` paragraphs.
 */
export function bigDoc({ paras = 200, chars = 400, mathEvery = 3, displayEvery = 10 } = {}): Doc {
  const words = 'the integral of a function over an interval measures the signed area under its graph and depends only on'.split(' ');
  const blocks: Block[] = [];
  let w = 0;
  for (let p = 0; p < paras; p++) {
    let text = '';
    while (text.length < chars) text += words[w++ % words.length] + ' ';
    const items: Item[] = chars ? [...chars_(text)] : [];
    if (mathEvery && p % mathEvery === 0) items.splice(Math.floor(items.length / 2), 0, math(parseLatex(String.raw`\frac{a_${p}+b}{\sqrt{x^2+1}}`).row));
    blocks.push(block(items, p % 25 === 0 ? 'h2' : 'p'));
    if (displayEvery && p % displayEvery === 0) blocks.push(block([math(parseLatex(String.raw`\sum_{i=1}^{n} \int_0^1 f_i(x)\,dx = \lim_{h\to 0} \frac{F(x+h)-F(x)}{h}`).row, true)]));
  }
  return { blocks, arrows: [], marks: [] };
}
const chars_ = chars;

export function install(ed: Editor) {
  (window as any).__nx = {
    ed,
    loadText: (text: string, name = 'note') => ed.load(deserialize(text), { path: null, name }),
    loadBig: (opts?: Parameters<typeof bigDoc>[0]) => ed.load(withMarkdown(bigDoc(opts)), { path: null, name: 'big' }),
    load: (scs: Scenario[]) => ed.load(withMarkdown(buildDoc(scs)), { path: null, name: 'lab' }),
    metrics: () => metrics(ed),
    /** The note as LaTeX (as \export copies it). */
    tex: () => docToLatex(ed.snapshot()),
    /** The tables' rows: [block index, role] (see tables.ts). */
    tables: () => [...findTables(ed.doc.blocks)].map(([b, r]) => [b, r.role, r.table]),
    /** Each formula's LaTeX, in order. */
    formulas: () => ed.doc.blocks.flatMap((b) => b.items.filter((i) => i.t === 'm').map((m) => toLatex(m.root))),
    /** Top-level nodes of a formula (to pick target indices). */
    probe: (tex: string) => describe(parseLatex(tex).row),
    /** The CSS properties the PDF's copy of the page takes (see pdf.ts). */
    paperStyles: PAPER_STYLES,
  };
}

function describe(row: MRow): string {
  return row.map((n, i) => `${i}:` + (n.k === 'sym' ? n.v : `${n.name}[${n.slots.map(describe).join(' | ')}]`)).join('  ');
}
