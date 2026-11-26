// On-disk note format.
//
// In memory every character has an id (arrows anchor to ids). On disk that
// would be wasteful, so text is stored as plain strings and arrow anchors on
// characters/blocks are rewritten as positions. Math nodes keep their ids.
//
//   { format: 'notex', version: 1,
//     blocks: [{ kind, content: ['plain text', { s: 'bold text', b: 1 }, { m: MRow, id, d?: 1 }, ...] }],
//     arrows: [{ from: ['c0.4', 'c0.5', '<math node id>'], to: [...], ... }],
//     marks: [{ kind: 'circle', at: [...], ... }] }
//
// Anchor forms: `c<block>.<offset>` a character, `b<block>` a whole block,
// anything else a math item / math node id.

import { block, ch, chars, type Arrow, type Mark, type Block, type BlockKind, type Doc, type Id, type Item, type MRow } from './model';
import type { Placed, Shape } from './sketch/shapes';
import { headingOf } from './markdown';
import { structureTables } from './tables';

/** Plain text, styled text (bold / italic / inline code), or a formula. */
type Content = string | { s: string; b?: 1; i?: 1; c?: 1 } | { m: MRow; id: Id; d?: 1 };
/**
 * A table row (`tr`) is its text with | for each cell wall; `lit` lists the | that are typed
 * text, not walls. Its table's header has `head` and the columns' alignment.
 */
type FileBlock = { kind: BlockKind; content: Content[]; indent?: number; lang?: string; src?: string; w?: number; h?: number; shapes?: Shape[]; head?: 1; aligns?: Block['aligns']; lit?: number[] };
type FileArrow = Omit<Arrow, 'id'>;
type FileMark = Omit<Mark, 'id'>;
/** What's drawn on the note: each shape's block (`at`) as `b<index>`. */
type FileInk = Placed;
/** Version 2: the markdown is in the text (** ` # ```); version 1 had styles and kinds for it. */
export type NoteFile = { format: 'notex'; version: 1 | 2; blocks: FileBlock[]; arrows: FileArrow[]; marks?: FileMark[]; ink?: FileInk[] };

export function encode(doc: Doc): NoteFile {
  const where = new Map<Id, string>();
  const blocks = doc.blocks.map((b, bi): FileBlock => {
    where.set(b.id, `b${bi}`);
    const content: Content[] = [];
    let run = '';
    const flush = () => {
      if (run) content.push(run);
      run = '';
    };
    b.items.forEach((it, o) => {
      if (it.t === 'c') {
        where.set(it.id, `c${bi}.${o}`);
        run += it.ch;
      } else {
        flush();
        content.push(it.display ? { m: it.root, id: it.id, d: 1 } : { m: it.root, id: it.id });
      }
    });
    flush();
    return {
      // (headings and code are in the text)
      kind: b.kind === 'li' || b.kind === 'ol' || b.kind === 'img' || b.kind === 'tr' || b.kind === 'diagram' ? b.kind : 'p',
      content,
      ...(b.kind === 'tr' && b.head ? { head: 1 as const, aligns: b.aligns ?? [] } : {}),
      ...(b.kind === 'tr' && b.items.some((it) => it.t === 'c' && it.ch === '|' && !it.cell)
        ? { lit: b.items.flatMap((it, o) => (it.t === 'c' && it.ch === '|' && !it.cell ? [o] : [])) }
        : {}),
      ...(b.indent ? { indent: b.indent } : {}),
      ...(b.src ? { src: b.src } : {}),
      ...(b.w ? { w: b.w } : {}),
      ...(b.kind === 'diagram' ? { h: b.h ?? 0, shapes: b.shapes ?? [] } : {}),
    };
  });
  const mapIds = (ids: Id[]) => ids.map((id) => where.get(id) ?? id);
  const arrows = doc.arrows.map(({ id: _id, ...a }) => ({ ...a, from: mapIds(a.from), to: mapIds(a.to) }));
  const marks = doc.marks.map(({ id: _id, ...m }) => ({ ...m, at: mapIds(m.at) }));
  const file: NoteFile = { format: 'notex', version: 2, blocks, arrows };
  if (marks.length) file.marks = marks;
  // (a shape on a block that's gone goes too)
  const ink = (doc.ink ?? []).filter((s) => where.has(s.at)).map((s) => ({ ...s, at: where.get(s.at)! }) as FileInk);
  if (ink.length) file.ink = ink;
  return file;
}

export function decode(file: NoteFile): Doc {
  const blocks: Block[] = file.blocks.map((fb) => {
    const items: Item[] = [];
    for (const c of fb.content) {
      if (typeof c === 'string') for (const s of c) items.push(ch(s));
      else if ('s' in c)
        for (const s of c.s) {
          const x = ch(s);
          if (c.b) x.b = true;
          if (c.i) x.i = true;
          if (c.c) x.c = true;
          items.push(x);
        }
      else items.push({ t: 'm', id: c.id, root: c.m, display: !!c.d });
    }
    const blk = block(items, fb.kind);
    if (fb.kind === 'tr') {
      // its | are cell walls, but those typed as text
      const lit = new Set(fb.lit ?? []);
      items.forEach((it, o) => it.t === 'c' && it.ch === '|' && !lit.has(o) && (it.cell = true));
      if (fb.head) (blk.head = true), (blk.aligns = fb.aligns ?? []);
    }
    if (fb.indent) blk.indent = fb.indent;
    if (fb.lang) blk.lang = fb.lang;
    if (fb.src) blk.src = fb.src;
    if (fb.w) blk.w = fb.w;
    if (fb.kind === 'diagram') (blk.shapes = fb.shapes ?? []), (blk.h = fb.h ?? 240);
    return blk;
  });
  const resolve = (ref: string): Id => {
    const cm = /^c(\d+)\.(\d+)$/.exec(ref);
    if (cm) return blocks[+cm[1]]?.items[+cm[2]]?.id ?? ref;
    const bm = /^b(\d+)$/.exec(ref);
    if (bm) return blocks[+bm[1]]?.id ?? ref;
    return ref;
  };
  let n = 0;
  const arrows: Arrow[] = file.arrows.map((a) => ({ ...a, id: `a${Date.now().toString(36)}${n++}`, from: a.from.map(resolve), to: a.to.map(resolve) }));
  const marks: Mark[] = (file.marks ?? []).map((m) => ({ ...m, id: `k${Date.now().toString(36)}${n++}`, at: m.at.map(resolve) }));
  const ink: Placed[] = (file.ink ?? []).map((s) => ({ ...s, at: resolve(s.at) }) as Placed).filter((s) => blocks.some((b) => b.id === s.at));
  return withMarkdown({ blocks, arrows, marks, ...(ink.length ? { ink } : {}) });
}

/**
 * A note from before the markdown was in the text (styles, headings and code blocks as
 * flags and kinds): the same, with its markers written in. Drawings keep their anchors
 * (the characters keep their ids). What's in markdown already is left as it is.
 */
export function withMarkdown(doc: Doc): Doc {
  const blocks = doc.blocks, out: Block[] = [];
  const plain = (b: Block) => b.items.map((i) => (i.t === 'c' ? i.ch : '\uFFFC')).join('');
  for (let bi = 0; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    // a code block: its lines between fences
    if (blk.kind === 'code' && blocks[bi - 1]?.kind !== 'code' && blocks[bi - 1]?.kind !== 'fence') {
      out.push(block(chars('```' + (blk.lang ?? ''))));
      let j = bi;
      for (; blocks[j]?.kind === 'code'; j++) {
        delete blocks[j].lang;
        for (const it of blocks[j].items) if (it.t === 'c') delete it.b, delete it.i, delete it.c, delete it.m;
        out.push(blocks[j]);
      }
      if (blocks[j]?.kind !== 'fence') out.push(block(chars('```')));
      bi = j - 1;
      continue;
    }
    // a heading: its #s
    const h = /^h([1-3])$/.exec(blk.kind);
    if (h && !headingOf(plain(blk))) blk.items.unshift(...chars('#'.repeat(+h[1]) + ' '));
    // styled text: between its markers
    if (!blk.items.some((i) => i.t === 'c' && i.m)) blk.items = withMarkers(blk.items);
    out.push(blk);
  }
  // markdown tables (from a file before tables were tables, or written out): tables
  doc.blocks = structureTables(out);
  return doc;
}

/** Styled runs (flags) as text between markers: ` ** * ***, spaces kept outside them. */
function withMarkers(items: Item[]): Item[] {
  const key = (it: Item) => (it.t !== 'c' ? '' : it.c ? 'c' : (it.b ? 'b' : '') + (it.i ? 'i' : ''));
  if (!items.some(key)) return items;
  const MK: Record<string, string> = { c: '`', b: '**', i: '*', bi: '***' };
  const out: Item[] = [];
  for (let i = 0; i < items.length; ) {
    const k = key(items[i]);
    let j = i;
    while (j < items.length && key(items[j]) === k) j++;
    const run = items.slice(i, j);
    for (const it of run) if (it.t === 'c') delete it.b, delete it.i, delete it.c;
    const ws = (it: Item) => it.t === 'c' && /\s/.test(it.ch);
    let a = 0, z = run.length;
    if (k && k !== 'c') {
      while (a < z && ws(run[a])) a++;
      while (z > a && ws(run[z - 1])) z--;
    }
    // (code holding a backtick is fenced by two)
    const mk = k === 'c' && run.some((it) => it.t === 'c' && it.ch === '`') ? '``' : MK[k];
    if (k && z > a) out.push(...run.slice(0, a), ...chars(mk), ...run.slice(a, z), ...chars(mk), ...run.slice(z));
    else out.push(...run);
    i = j;
  }
  return out;
}

export function serialize(doc: Doc): string {
  return JSON.stringify(encode(doc));
}

export function deserialize(text: string): Doc {
  const data = JSON.parse(text);
  if (data?.format === 'notex' && Array.isArray(data.blocks)) return decode(data);
  // Raw in-memory documents (older saves, clipboard JSON).
  const doc = data?.doc ?? data;
  if (!doc || !Array.isArray(doc.blocks)) throw new Error('not a notex note');
  return withMarkdown({ blocks: doc.blocks, arrows: doc.arrows ?? [], marks: doc.marks ?? [], ...(doc.ink ? { ink: doc.ink } : {}) });
}
