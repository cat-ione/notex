// Document -> LaTeX.
//
// Drawings are exported too. A drawn-on range is wrapped in place (\fbox,
// \underline, \cancel, \underbrace, ...), and anything that needs to be drawn
// between places (arrows, circles, notes) wraps its targets in
// \tikzmarknode{...}{...} and is drawn in a tikz overlay after the paragraph.

import type { Arrow, Doc, Id, Item, Mark, MRow } from './model';
import { toLatexWrapped, type Wraps } from './math/latex';
import { CMDS } from './math/defs';

const ESC: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '^': '\\^{}', '~': '\\~{}',
};

/** Escape prose, keeping `$math$` segments as they are. */
const escText = (s: string) =>
  s
    .split(/(\$[^$]+\$)/)
    .map((p) => (/^\$[^$]+\$$/.test(p) ? p : [...p].map((c) => ESC[c] ?? c).join('')))
    .join('');

// ── locating drawn-on ranges ──

/** A contiguous range: items s..e of a block, or nodes i..j of one math row. */
type Span = { key: string; s: number; e: number; b: number; math?: { first: Id; last: Id } };

type NodeAt = { b: number; row: MRow; rowKey: string; i: number; inText: boolean };

function indexDoc(doc: Doc) {
  const items = new Map<Id, { b: number; o: number; it: Item }>();
  const blocks = new Map<Id, number>();
  const nodes = new Map<Id, NodeAt>();
  const walk = (row: MRow, b: number, rowKey: string, inText: boolean) =>
    row.forEach((n, i) => {
      nodes.set(n.id, { b, row, rowKey, i, inText });
      if (n.k === 'cmd') n.slots.forEach((sl, s) => walk(sl, b, `${rowKey}.${i}:${s}`, inText || !!CMDS[n.name]?.text));
    });
  doc.blocks.forEach((blk, b) => {
    blocks.set(blk.id, b);
    blk.items.forEach((it, o) => {
      items.set(it.id, { b, o, it });
      if (it.t === 'm') walk(it.root, b, it.id, false);
    });
  });
  return { items, blocks, nodes };
}

function locate(doc: Doc, ix: ReturnType<typeof indexDoc>, ids: Id[]): Span | null {
  if (!ids.length) return null;
  const mathSpan = (row: MRow, rowKey: string, b: number, i: number, j: number): Span =>
    ({ key: rowKey, s: i, e: j, b, math: { first: row[i].id, last: row[j].id } });

  // A whole math item: wrap its contents (works for display math too).
  if (ids.length === 1) {
    const it = ix.items.get(ids[0]);
    if (it?.it.t === 'm' && it.it.root.length) return mathSpan(it.it.root, it.it.id, it.b, 0, it.it.root.length - 1);
    const b = ix.blocks.get(ids[0]);
    if (b !== undefined) {
      const n = doc.blocks[b].items.length;
      return n && !doc.blocks[b].items.some((x) => x.t === 'm' && x.display) ? { key: `p${b}`, s: 0, e: n - 1, b } : null;
    }
  }
  const its = ids.map((id) => ix.items.get(id));
  if (its.every((x) => x && x.b === its[0]!.b)) {
    const os = its.map((x) => x!.o);
    const b = its[0]!.b, s = Math.min(...os), e = Math.max(...os);
    if (doc.blocks[b].items.slice(s, e + 1).some((x) => x.t === 'm' && x.display)) return null;
    return { key: `p${b}`, s, e, b };
  }
  const ns = ids.map((id) => ix.nodes.get(id));
  if (ns.every((x) => x && !x.inText && x.rowKey === ns[0]!.rowKey)) {
    const is = ns.map((x) => x!.i);
    return mathSpan(ns[0]!.row, ns[0]!.rowKey, ns[0]!.b, Math.min(...is), Math.max(...is));
  }
  return null;
}

const spanId = (sp: Span) => `${sp.key}@${sp.s}-${sp.e}`;

/** Ranges may nest or be disjoint, but braces can't cross. */
function fits(taken: Span[], sp: Span) {
  return taken.every((t) => t.key !== sp.key || t.e < sp.s || sp.e < t.s || (t.s <= sp.s && sp.e <= t.e) || (sp.s <= t.s && t.e <= sp.e));
}

// ── drawing commands ──

// Print-friendly versions of the app's inks.
const INK_TEX: Record<string, string> = { red: 'red!80!black', green: 'green!50!black', blue: 'blue!70!black', purple: 'violet' };
const tikzColor = (c?: string) => (c ? `, ${INK_TEX[c] ?? c}` : '');

function markWrap(m: Mark, math: boolean): [string, string] | null {
  const hl = m.color ? `${m.color}!30` : 'yellow!40';
  const note = escText(m.label);
  switch (m.kind) {
    case 'box': return math ? ['\\boxed{', '}'] : ['\\fbox{', '}'];
    case 'underline': return ['\\underline{', '}'];
    case 'highlight': return math ? [`\\colorbox{${hl}}{$`, '$}'] : [`\\colorbox{${hl}}{`, '}'];
    case 'strike': return math ? ['\\cancel{', '}'] : ['\\sout{', '}'];
    case 'brace': return math ? ['\\underbrace{', `}_{\\text{${note}}}`] : ['$\\underbrace{\\text{', `}}_{\\text{${note}}}$`];
    case 'circle': return null; // drawn in the overlay
  }
}

const PKG = {
  tikz: '\\usepackage{tikz} \\usetikzlibrary{tikzmark,fit,shapes.geometric}',
  cancel: '\\usepackage{cancel}',
  ulem: '\\usepackage[normalem]{ulem}',
  xcolor: '\\usepackage{xcolor}',
  amsmath: '\\usepackage{amsmath}',
};

export function docToLatex(doc: Doc): string {
  const ix = indexDoc(doc);
  const need = new Set<keyof typeof PKG>();
  const taken: Span[] = [];
  let skipped = 0;

  type W = { sp: Span; open: string; close: string; seq: number };
  const wraps: W[] = [];
  const names = new Map<string, string>(); // spanId -> tikz node name
  const overlays = new Map<number, string[]>(); // block -> tikz commands drawn after it
  let seq = 0;

  const accept = (sp: Span | null): sp is Span => {
    if (!sp || !fits(taken, sp)) return false;
    taken.push(sp);
    return true;
  };
  const nodeName = (sp: Span) => {
    let n = names.get(spanId(sp));
    if (!n) {
      n = `nx${names.size}`;
      names.set(spanId(sp), n);
      // node wrappers go on the outside of other wrappers on the same range
      wraps.push({ sp, open: `\\tikzmarknode{${n}}{`, close: '}', seq: -1 - names.size });
      need.add('tikz');
    }
    return n;
  };
  const overlay = (b: number, cmd: string) => {
    if (!overlays.has(b)) overlays.set(b, []);
    overlays.get(b)!.push(cmd);
  };

  for (const m of doc.marks) {
    const sp = locate(doc, ix, m.at);
    if (!accept(sp)) { skipped++; continue; }
    const w = markWrap(m, !!sp.math);
    if (w) {
      wraps.push({ sp, open: w[0], close: w[1], seq: seq++ });
      if (m.kind === 'highlight' || m.color) need.add('xcolor');
      if (m.kind === 'strike') need.add(sp.math ? 'cancel' : 'ulem');
      if (m.kind === 'brace' || m.kind === 'box') need.add('amsmath');
    }
    const style = `${m.dash ? ', dashed' : ''}${tikzColor(m.color)}`;
    if (m.kind === 'circle') {
      const label = m.label ? `, label={[font=\\scriptsize${tikzColor(m.color)}]above:${escText(m.label)}}` : '';
      overlay(sp.b, `\\node[draw, ellipse, inner sep=1.5pt${style}${label}, fit=(${nodeName(sp)})] {};`);
    } else if (m.label && m.kind !== 'brace') {
      const below = m.kind === 'underline';
      overlay(sp.b, `\\node[font=\\scriptsize, ${below ? 'below' : 'above'}=2pt${tikzColor(m.color)}] at (${nodeName(sp)}.${below ? 'south' : 'north'}) {${escText(m.label)}};`);
    }
  }

  for (const a of doc.arrows) {
    const f = locate(doc, ix, a.from), t = locate(doc, ix, a.to);
    // An arrow end may share a range with a mark (circle it, then point at it).
    const ok = (sp: Span | null) => !!sp && (taken.some((x) => spanId(x) === spanId(sp)) || accept(sp));
    if (!f || !t || !ok(f) || !ok(t)) { skipped++; continue; }
    overlay(Math.max(f.b, t.b), arrowCmd(a, nodeName(f), nodeName(t)));
  }

  // Group wrappers by position: a math node id, or `block:offset` in prose.
  const before = new Map<string, W[]>(), after = new Map<string, W[]>();
  for (const w of wraps) {
    const kb = w.sp.math ? w.sp.math.first : `${w.sp.b}:${w.sp.s}`;
    const ka = w.sp.math ? w.sp.math.last : `${w.sp.b}:${w.sp.e}`;
    if (!before.has(kb)) before.set(kb, []);
    if (!after.has(ka)) after.set(ka, []);
    before.get(kb)!.push(w);
    after.get(ka)!.push(w);
  }
  const len = (w: W) => w.sp.e - w.sp.s;
  // Outer (longer) ranges open first and close last; equal ranges close in reverse order.
  const opens = (ws: W[] = []) => [...ws].sort((x, y) => len(y) - len(x) || x.seq - y.seq).map((w) => w.open).join('');
  const closes = (ws: W[] = []) => [...ws].sort((x, y) => len(x) - len(y) || y.seq - x.seq).map((w) => w.close).join('');

  const mathWraps: Wraps = { before: new Map(), after: new Map() };
  for (const [k, ws] of before) if (!k.includes(':')) mathWraps.before.set(k, opens(ws));
  for (const [k, ws] of after) if (!k.includes(':')) mathWraps.after.set(k, closes(ws));

  const inline = (items: Item[], b: number) =>
    items
      .map((it, o) => {
        const body = it.t === 'c' ? (ESC[it.ch] ?? it.ch) : it.display ? `\n\\[ ${toLatexWrapped(it.root, mathWraps)} \\]\n` : `$${toLatexWrapped(it.root, mathWraps)}$`;
        return opens(before.get(`${b}:${o}`)) + body + closes(after.get(`${b}:${o}`));
      })
      .join('');

  const out: string[] = [];
  let inList = false;
  doc.blocks.forEach((blk, b) => {
    if (blk.kind === 'li' && !inList) out.push('\\begin{itemize}'), (inList = true);
    if (blk.kind !== 'li' && inList) out.push('\\end{itemize}'), (inList = false);
    const body = inline(blk.items, b);
    if (blk.kind === 'h1') out.push(`\\section*{${body}}`);
    else if (blk.kind === 'h2') out.push(`\\subsection*{${body}}`);
    else if (blk.kind === 'h3') out.push(`\\subsubsection*{${body}}`);
    else if (blk.kind === 'li') out.push(`  \\item ${body}`);
    else out.push(body + (overlays.has(b) ? '' : '\n'));
    const ov = overlays.get(b);
    if (ov) out.push('\\begin{tikzpicture}[remember picture, overlay]', ...ov.map((c) => '  ' + c), '\\end{tikzpicture}' + (blk.kind === 'p' ? '\n' : ''));
  });
  if (inList) out.push('\\end{itemize}');

  const head: string[] = [];
  if (need.size) head.push('% preamble:', ...[...need].map((p) => `%   ${PKG[p]}`));
  if (names.size) head.push('% (drawings use tikzmark: compile twice)');
  if (skipped) head.push(`% ${skipped} drawing(s) could not be exported (they span several paragraphs or overlap other drawings)`);
  return [...head, ...(head.length ? [''] : []), ...out].join('\n');
}

function arrowCmd(a: Arrow, from: string, to: string): string {
  const tip = a.head === 'both' ? '<->' : a.head === 'none' ? '-' : '->';
  const style = `${tip}${a.dash ? ', dashed' : ''}${tikzColor(a.color)}`;
  // A quadratic curve with control offset bend*len leaves its ends at atan(2*bend).
  const deg = Math.round((Math.atan(2 * Math.abs(a.bend)) * 180) / Math.PI);
  const path = deg < 2 ? '--' : `to[bend ${a.bend > 0 ? 'left' : 'right'}=${deg}]`;
  const label = a.label ? ` node[midway, above, font=\\scriptsize] {${escText(a.label)}}` : '';
  const boxes = a.boxed ? [from, to].map((n) => `\\node[draw, dashed, rounded corners=2pt, inner sep=1pt, fit=(${n})] {};`).join(' ') + ' ' : '';
  return `${boxes}\\draw[${style}] (${from}) ${path}${label} (${to});`;
}
