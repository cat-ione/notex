// Document -> LaTeX.
//
// Drawings are exported too. A drawn-on range is wrapped in place (\fbox,
// \underline, \cancel, \underbrace, ...), and anything that needs to be drawn
// between places (arrows, circles, notes) wraps its targets in
// \tikzmarknode{...}{...} and is drawn in a tikz overlay after the paragraph.

import { BOX_NAME, NUMBERED_BOX, isRefItem, type Arrow, type Block, type BoxKind, type Doc, type Id, type Item, type Mark, type MRow, type MSym } from './model';
import { OBJ, parseInline, type Link } from './markdown';
import { cellSpans, findTables } from './tables';
import { toLatex, toLatexWrapped, type Wraps } from './math/latex';
import { CMDS } from './math/defs';
import { noteRuns, noteTex } from './labels';
import { diagramTikz } from './sketch/tikz';

const ESC: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '^': '\\^{}', '~': '\\~{}',
};

/** Escape prose, keeping `$math$` segments as they are. */
const escText = (s: string) =>
  s
    .split(/(\$[^$]+\$)/)
    .map((p) =>
      /^\$[^$]+\$$/.test(p)
        ? `$${noteTex(p.slice(1, -1))}$`
        : noteRuns(p)
            .map(({ text, stars }) => {
              const t = [...text].map((c) => ESC[c] ?? c).join('');
              return stars === 3 ? `\\textbf{\\emph{${t}}}` : stars === 2 ? `\\textbf{${t}}` : stars === 1 ? `\\emph{${t}}` : t;
            })
            .join(''),
    )
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
  graphicx: '\\usepackage{graphicx}',
  soul: '\\usepackage{soul}',
  amssymb: '\\usepackage{amssymb}',
  amsthm: '\\usepackage{amsthm}',
  hyperref: '\\usepackage{hyperref}',
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

  // links: a web address as \url / \href (its text as it is: no escapes in an address), a
  // note's name as its text
  const linksOf = new Map<number, Link[]>();
  const links = (b: number) => {
    let ls = linksOf.get(b);
    if (!ls) {
      const blk = doc.blocks[b];
      ls = blk.kind === 'code' || blk.kind === 'fence' ? [] : parseInline(blk.items.map((i) => (i.t === 'c' ? i.ch : OBJ)).join('')).links;
      linksOf.set(b, ls);
    }
    return ls;
  };
  const urlChar = (c: string) => (c === '%' || c === '#' ? '\\' + c : c);
  // numbered formulas and boxes: labelled, for references to them
  const labelOf = (id: Id) => `nx:${id}`;
  let refs = false;
  // highlighted / struck / bold / italic runs as \hl / \sout / \textbf / \emph, code as
  // \texttt (closed around a drawing's wrapper, so they nest)
  const OPENS: Record<string, string> = { h: '\\hl{', s: '\\sout{', b: '\\textbf{', i: '\\emph{', c: '\\texttt{' };
  const styleOf = (it: Item) => (it.t !== 'c' ? '' : it.c ? 'c' : (it.h ? 'h' : '') + (it.s ? 's' : '') + (it.b ? 'b' : '') + (it.i ? 'i' : ''));
  const OPEN = (st: string) => [...st].map((c) => OPENS[c]).join('');
  const CLOSE = (st: string) => '}'.repeat(st.length);
  // (`base`: where `items` start in their block, for a cell of a table row)
  const inline = (items: Item[], b: number, base = 0) => {
    let out = '', cur = '';
    const ls = links(b);
    items.forEach((it, i) => {
      const o = base + i;
      const link = ls.find((l) => o >= l.start && o < l.end);
      const lopen = link && o === link.start ? (link.note ? '' : !link.open ? '\\url{' : `\\href{${[...link.to].map(urlChar).join('')}}{`) : '';
      const lclose = link && o === link.end - 1 && !link.note ? '}' : '';
      if (lopen || lclose) need.add('hyperref');
      const pre = opens(before.get(`${b}:${o}`)) + lopen, post = lclose + closes(after.get(`${b}:${o}`));
      // a reference: \eqref{…} to a formula, Theorem~\ref{…} to a box
      if (isRefItem(it)) {
        const r = it.root[0] as MSym;
        refs = true;
        if (cur) (out += CLOSE(cur)), (cur = '');
        out += pre + (/^\(/.test(r.v) ? `\\eqref{${labelOf(r.ref!)}}` : `${r.v.replace(/\s*\d+$/, '')}~\\ref{${labelOf(r.ref!)}}`) + post;
        return;
      }
      const st = styleOf(it);
      if (st.includes('s')) need.add('ulem');
      if (st.includes('h')) need.add('soul'), need.add('xcolor');
      if (st !== cur || pre) (out += CLOSE(cur)), (cur = '');
      out += pre;
      if (st !== cur) (out += OPEN(st)), (cur = st);
      // (markdown's markers are what the styles say: not text)
      const bare = link && !link.note && !link.open;
      // (a link's markers: not text, whatever the flags say)
      const marker = !!link && (o < link.start + link.open || o >= link.end - link.close);
      out +=
        it.t === 'c'
          ? it.m || marker ? '' : bare ? urlChar(it.ch) : (ESC[it.ch] ?? it.ch)
          : it.display && it.num
            ? `\n\\begin{equation} ${toLatexWrapped(it.root, mathWraps)} \\label{${labelOf(it.id)}} \\end{equation}\n`
            : it.display ? `\n\\[ ${toLatexWrapped(it.root, mathWraps)} \\]\n` : `$${toLatexWrapped(it.root, mathWraps)}$`;
      if (post) (out += CLOSE(cur)), (cur = ''), (out += post);
    });
    return out + CLOSE(cur);
  };

  const out: string[] = [];
  // open lists, outermost first (a nested item opens one inside the item before it)
  const lists: ('itemize' | 'enumerate')[] = [];
  const pad = (n: number) => '  '.repeat(n);
  let images = 0;
  const tables = findTables(doc.blocks);
  const closeLists = () => {
    while (lists.length) out.push(`${pad(lists.length - 1)}\\end{${lists.pop()}}`);
  };
  const boxes = new Set<BoxKind>();
  const emit = (blk: Block, b: number) => {
    // a table row: a tabular's row, its cells between the walls
    const row = tables.get(b);
    if (row) {
      const cells = cellSpans(blk.items).map(([s, e]) => inline(blk.items.slice(s, e), b, s).trim());
      if (row.role === 'head') {
        const n = Math.max(cells.length, row.aligns.length);
        const cols = Array.from({ length: n }, (_, c) => ({ left: 'l', center: 'c', right: 'r' })[row.aligns[c] ?? 'left'] ?? 'l').join(' ');
        out.push(`\\begin{tabular}{${cols}}`, `  ${cells.join(' & ')} \\\\ \\hline`);
      } else out.push(`  ${cells.join(' & ')} \\\\`);
      if (row.last) out.push('\\end{tabular}\n');
      return;
    }
    // an image: a figure for a file of its own (the image itself lives in the note)
    if (blk.kind === 'img') {
      need.add('graphicx');
      const caption = inline(blk.items, b);
      const ext = /^data:image\/(\w+)/.exec(blk.src ?? '')?.[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png';
      out.push('\\begin{figure}[h]', '  \\centering', `  \\includegraphics[width=${blk.w ? `${Math.round(blk.w * 0.75)}pt` : '\\linewidth'}]{image${++images}.${ext}}`);
      if (caption) out.push(`  \\caption*{${caption}}`);
      out.push('\\end{figure}\n');
      return;
    }
    // a diagram: its shapes in a tikzpicture, as wide as the text
    if (blk.kind === 'diagram') {
      need.add('tikz');
      if (blk.shapes?.some((x) => x.color)) need.add('xcolor');
      const caption = inline(blk.items, b);
      out.push('\\begin{figure}[h]', '  \\centering', ...diagramTikz(blk.shapes ?? [], blk.w ?? 720, (c) => INK_TEX[c] ?? c, escText).map((l) => '  ' + l));
      if (caption) out.push(`  \\caption*{${caption}}`);
      out.push('\\end{figure}\n');
      return;
    }
    // a code block: its lines as they are (its fences are what verbatim says)
    if (blk.kind === 'fence') return;
    if (blk.kind === 'code') {
      const first = doc.blocks[b - 1]?.kind !== 'code', last = doc.blocks[b + 1]?.kind !== 'code';
      if (first) out.push('\\begin{verbatim}');
      out.push(blk.items.map((it) => (it.t === 'c' ? it.ch : `$${toLatex(it.root)}$`)).join(''));
      if (last) out.push('\\end{verbatim}\n');
      return;
    }
    const list = blk.kind === 'li' || blk.kind === 'ol';
    const depth = list ? (blk.indent ?? 0) + 1 : 0;
    const env = blk.kind === 'ol' ? 'enumerate' : 'itemize';
    while (lists.length > depth || (depth && lists.length === depth && lists[depth - 1] !== env)) out.push(`${pad(lists.length - 1)}\\end{${lists.pop()}}`);
    while (lists.length < depth) {
      const e = lists.length === depth - 1 ? env : 'itemize';
      out.push(`${pad(lists.length)}\\begin{${e}}`);
      lists.push(e);
    }
    let body = inline(blk.items, b);
    // a box's first line: a name in brackets at its start is the box's ([Fermat])
    const box = blk.box, first = !!box && doc.blocks[b - 1]?.box?.id !== box.id;
    if (first && box) {
      const named = box.k !== 'quote' && box.k !== 'proof' ? /^\s*\(([^()]{1,60})\)\s*/.exec(body) : null;
      if (named) body = body.slice(named[0].length);
      out.push(`\\begin{${box.k}}${named ? `[${named[1]}]` : ''}${NUMBERED_BOX.has(box.k) ? `\\label{${labelOf(box.id)}}` : ''}`);
    }
    if (blk.kind === 'h1') out.push(`\\section*{${body}}`);
    else if (blk.kind === 'h2') out.push(`\\subsection*{${body}}`);
    else if (blk.kind === 'h3') out.push(`\\subsubsection*{${body}}`);
    else if (list && blk.kind === 'li' && blk.check !== undefined) (need.add('amssymb'), out.push(`${pad(depth)}\\item[$${blk.check ? '\\boxtimes' : '\\square'}$] ${body}`));
    else if (list) out.push(`${pad(depth)}\\item ${body}`);
    else out.push(body + (overlays.has(b) ? '' : '\n'));
    const ov = overlays.get(b);
    if (ov) out.push('\\begin{tikzpicture}[remember picture, overlay]', ...ov.map((c) => '  ' + c), '\\end{tikzpicture}' + (blk.kind === 'p' ? '\n' : ''));
  };
  doc.blocks.forEach((blk, b) => {
    const box = blk.box;
    // (a box opens on its first line, after any list before it; see emit)
    if (box && doc.blocks[b - 1]?.box?.id !== box.id) closeLists(), boxes.add(box.k);
    if (box && doc.blocks[b - 1]?.box?.id !== box.id && (blk.kind === 'img' || blk.kind === 'diagram' || blk.kind === 'tr' || blk.kind === 'fence' || blk.kind === 'code' || blk.kind === 'li' || blk.kind === 'ol'))
      out.push(`\\begin{${box.k}}${NUMBERED_BOX.has(box.k) ? `\\label{${labelOf(box.id)}}` : ''}`), (blk = { ...blk, box: undefined });
    emit(blk, b);
    if (box && doc.blocks[b + 1]?.box?.id !== box.id) closeLists(), out.push(`\\end{${box.k}}\n`);
  });
  closeLists();

  if (refs) need.add('amsmath');
  if ([...boxes].some((k) => k !== 'quote')) need.add('amsthm');
  const head: string[] = [];
  if (need.size) head.push('% preamble:', ...[...need].map((p) => `%   ${PKG[p]}`));
  // the boxes' environments (theorems… examples numbered together)
  const thm = [...boxes].filter((k) => NUMBERED_BOX.has(k) || k === 'remark');
  if (thm.length) {
    const def = (k: BoxKind) => (k === 'remark' ? `\\newtheorem*{remark}{Remark}` : k === 'theorem' ? `\\newtheorem{theorem}{Theorem}` : `\\newtheorem{${k}}[theorem]{${BOX_NAME[k]}}`);
    const plain = thm.filter((k) => ['lemma', 'proposition', 'corollary'].includes(k));
    const defs = thm.filter((k) => k === 'definition' || k === 'example');
    head.push(`%   ${def('theorem')}`, ...plain.map((k) => `%   ${def(k)}`));
    if (defs.length) head.push('%   \\theoremstyle{definition}', ...defs.map((k) => `%   ${def(k)}`));
    if (thm.includes('remark')) head.push('%   \\theoremstyle{remark}', `%   ${def('remark')}`);
  }
  if (names.size) head.push('% (drawings use tikzmark: compile twice)');
  if (images) head.push(`% ${images} image(s): save them from the note as image1, image2, …`);
  if (doc.ink?.length) head.push(`% ${doc.ink.length} drawing(s) on the note itself are not exported (diagrams are)`);
  if (skipped) head.push(`% ${skipped} drawing(s) could not be exported (they span several paragraphs or overlap other drawings)`);
  return [...head, ...(head.length ? [''] : []), ...out].join('\n');
}

function arrowCmd(a: Arrow, from: string, to: string): string {
  const tip = a.head === 'both' ? '<->' : a.head === 'none' ? '-' : '->';
  const style = `${tip}${a.dash ? ', dashed' : ''}${tikzColor(a.color)}`;
  // A quadratic curve with control offset bend*len leaves its ends at atan(2*bend).
  const deg = Math.round((Math.atan(2 * Math.abs(a.bend)) * 180) / Math.PI);
  // pulled along the arrow too: leave and arrive at the curve's own angles (relative to the chord)
  const skew = a.skew ?? 0;
  const ang = (y: number, x: number) => Math.round((Math.atan2(y, x) * 180) / Math.PI);
  const path = skew
    ? `to[out=${ang(a.bend, 0.5 + skew)}, in=${ang(a.bend, skew - 0.5)}, relative]`
    : deg < 2 ? '--' : `to[bend ${a.bend > 0 ? 'left' : 'right'}=${deg}]`;
  const label = a.label ? ` node[midway, above, font=\\scriptsize] {${escText(a.label)}}` : '';
  const boxes = a.boxed ? [from, to].map((n) => `\\node[draw, dashed, rounded corners=2pt, inner sep=1pt, fit=(${n})] {};`).join(' ') + ' ' : '';
  return `${boxes}\\draw[${style}] (${from}) ${path}${label} (${to});`;
}
