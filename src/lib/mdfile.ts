// Markdown files: a note written out as markdown (as Obsidian reads it), and a markdown
// file read in as a note.
//
// Most of a note is markdown already (its headings, **bold**, `code`, fences and tables are
// in its text). The rest is written as Obsidian writes it: formulas in $…$ and $$…$$ (a
// numbered one with \tag), boxes to tick as - [ ], boxes as callouts (> [!theorem]), quotes
// as >, images inline. Drawings (arrows, marks, diagrams, what's drawn on the note) have no
// markdown: they're counted, to say so.

import { block, chars, isRefItem, math, uid, type Block, type BoxKind, type Doc, type Item, type MSym } from './model';
import { toLatex } from './math/latex';
import { parseLatex } from './math/parse';
import { parsePaste } from './paste';
import { findTables, rowMarkdown, separatorLine } from './tables';
import { withMarkdown } from './format';

/** A line's text as markdown: its characters as they are, formulas as $…$, references as what they say. */
function lineText(items: Item[]): string {
  return items
    .map((it) => (it.t === 'c' ? it.ch : isRefItem(it) ? (it.root[0] as MSym).v : it.display ? `$$${toLatex(it.root).trim()}$$` : `$${toLatex(it.root).trim()}$`))
    .join('');
}

/** The note as markdown, and how many drawings couldn't go in it. */
export function docToMarkdown(doc: Doc): { text: string; lost: number } {
  const blocks = doc.blocks, tables = findTables(blocks);
  let lost = doc.arrows.length + doc.marks.length + (doc.ink?.length ?? 0);
  // numbered lists count on as in the note
  const count: number[] = [];
  const lines: string[] = [];
  /** Whether block `b` follows `b - 1` with no blank line: list items, table rows, code lines. */
  const tight = (b: number) => {
    const a = blocks[b - 1], c = blocks[b];
    if (!a) return true;
    const list = (k: string) => k === 'li' || k === 'ol';
    const code = (k: string) => k === 'code' || k === 'fence';
    return (list(a.kind) && list(c.kind)) || (tables.has(b - 1) && tables.has(b) && tables.get(b)!.role !== 'head') || (code(a.kind) && code(c.kind));
  };
  blocks.forEach((blk, b) => {
    const box = blk.box, first = !!box && blocks[b - 1]?.box?.id !== box.id;
    const quote = box ? '> ' : '';
    if (!tight(b) || first || (box && !blocks[b - 1]?.box)) lines.push(box && !first ? '>' : '');
    if (first && box && box.k !== 'quote') lines.push(`> [!${box.k}]`);
    if (blk.kind !== 'ol') count.length = Math.min(count.length, blk.indent ?? 0);
    const out: string[] = [];
    const row = tables.get(b);
    if (row) {
      out.push(rowMarkdown(blk.items, (items) => lineText(items).trim()));
      if (row.role === 'head') out.push(separatorLine(row.aligns, blk.items.filter((i) => i.t === 'c' && i.cell).length - 1));
    } else if (blk.kind === 'img') out.push(`![${lineText(blk.items).replace(/[[\]]/g, '')}](${blk.src ?? ''})`);
    else if (blk.kind === 'diagram') {
      lost++;
      out.push(`<!-- a diagram: not in markdown${blk.items.length ? ` (${lineText(blk.items)})` : ''} -->`);
    } else if (blk.items.length === 1 && blk.items[0].t === 'm' && blk.items[0].display) {
      const m = blk.items[0];
      out.push('$$', toLatex(m.root).trim() + (m.num ? ` \\tag{${numberOf(doc, m.id)}}` : ''), '$$');
    } else if (blk.kind === 'li' || blk.kind === 'ol') {
      const d = blk.indent ?? 0;
      const tick = blk.kind === 'li' && blk.check !== undefined ? (blk.check ? '[x] ' : '[ ] ') : '';
      count.length = d + 1;
      count[d] = blk.kind === 'ol' ? (count[d] ?? 0) + 1 : 0;
      out.push(`${'  '.repeat(d)}${blk.kind === 'ol' ? `${count[d]}.` : '-'} ${tick}${lineText(blk.items)}`);
    } else out.push(lineText(blk.items));
    if (blk.kind !== 'li' && blk.kind !== 'ol') count.length = 0;
    lines.push(...out.map((l) => quote + l));
  });
  // (no blank line first, one newline at the end)
  while (lines[0] === '') lines.shift();
  return { text: lines.join('\n').replace(/\s+$/, '') + '\n', lost };
}

/** A numbered formula's number, counted as the note counts them. */
function numberOf(doc: Doc, id: string): number {
  let n = 0;
  for (const blk of doc.blocks) {
    const m = blk.items[0];
    if (m?.t === 'm' && m.display && m.num) {
      n++;
      if (m.id === id) return n;
    }
  }
  return n;
}

/** A callout's type as a kind of box (Obsidian's own types as the nearest). */
const CALLOUT: Record<string, BoxKind> = {
  theorem: 'theorem', thm: 'theorem', lemma: 'lemma', lem: 'lemma', proposition: 'proposition', prop: 'proposition',
  corollary: 'corollary', cor: 'corollary', definition: 'definition', def: 'definition', example: 'example', proof: 'proof',
  remark: 'remark', note: 'remark', info: 'remark', tip: 'example', quote: 'quote', cite: 'quote',
};

/** A markdown file as a note. */
export function markdownToDoc(text: string): Doc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = readLines(lines);
  return withMarkdown({ blocks: blocks.length ? blocks : [block()], arrows: [], marks: [] });
}

function readLines(lines: string[]): Block[] {
  const out: Block[] = [];
  let chunk: string[] = [];
  // ordinary lines (paragraphs, headings, lists, inline math) as pasted text is read
  const flush = () => {
    if (!chunk.some((l) => l.trim())) return void (chunk = []);
    for (const p of parsePaste(chunk.join('\n') + '\n')) {
      const blk = block(p.items, p.kind);
      if (p.indent) blk.indent = p.indent;
      // - [ ] / - [x]: a box to tick
      const head = p.items.slice(0, 4).map((i) => (i.t === 'c' ? i.ch : '')).join('');
      if (p.kind === 'li' && /^\[( |x|X)\] $/.test(head)) (blk.check = head[1] !== ' '), blk.items.splice(0, 4);
      out.push(blk);
    }
    chunk = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // a code block: as it is
    if (/^\s*```/.test(line)) {
      flush();
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++;
      for (const l of lines.slice(i, Math.min(j + 1, lines.length))) out.push(block(chars(l.replace(/^\s+(?=```)/, ''))));
      if (j >= lines.length) out.push(block(chars('```')));
      i = j;
      continue;
    }
    // a display formula, on its line or over several ($$ … $$); \tag numbers it
    const dm = /^\s*\$\$(.*)$/.exec(line);
    if (dm) {
      let src = dm[1], j = i;
      if (!/\$\$\s*$/.test(src) || src.trim() === '') {
        const rest: string[] = [src];
        for (j = i + 1; j < lines.length && !/\$\$\s*$/.test(lines[j]); j++) rest.push(lines[j]);
        rest.push((lines[j] ?? '').replace(/\$\$\s*$/, ''));
        src = rest.join(' ');
      } else src = src.replace(/\$\$\s*$/, '');
      // (text after the closing $$ on its line: not a display formula of its own then)
      if (j === i && /\$\$\s*\S/.test(dm[1].replace(/\$\$\s*$/, ''))) {
        chunk.push(line);
        continue;
      }
      flush();
      const tagged = /\\tag\*?\{[^}]*\}/.test(src);
      const m = math(parseLatex(src.replace(/\\tag\*?\{[^}]*\}/g, '').trim()).row, true);
      if (tagged) m.num = true;
      out.push(block([m]));
      i = j;
      continue;
    }
    // a quote or a callout: its lines read as a note's, in a box
    if (/^\s*>/.test(line)) {
      flush();
      let j = i;
      const inner: string[] = [];
      while (j < lines.length && /^\s*>/.test(lines[j])) inner.push(lines[j++].replace(/^\s*> ?/, ''));
      let kind: BoxKind = 'quote';
      const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(inner[0] ?? '');
      if (c) {
        kind = CALLOUT[c[1].toLowerCase()] ?? 'remark';
        inner.shift();
        // (its title: in brackets at its start, as a theorem's name is)
        if (c[2].trim()) inner[0] = `(${c[2].trim()}) ${inner[0] ?? ''}`.trimEnd();
      }
      const id = uid();
      for (const blk of readLines(inner)) (blk.box = { k: kind, id }), out.push(blk);
      i = j - 1;
      continue;
    }
    // an image on its line
    const im = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line);
    if (im) {
      flush();
      out.push(Object.assign(block(chars(im[1]), 'img'), { src: im[2] }));
      continue;
    }
    // a note's comment for a diagram it couldn't write: nothing
    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    chunk.push(line);
  }
  flush();
  return out;
}
