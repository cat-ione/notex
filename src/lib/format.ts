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

import { block, ch, type Arrow, type Mark, type Block, type BlockKind, type Doc, type Id, type Item, type MRow } from './model';

/** Plain text, styled text (bold / italic), or a formula. */
type Content = string | { s: string; b?: 1; i?: 1 } | { m: MRow; id: Id; d?: 1 };
type FileBlock = { kind: BlockKind; content: Content[]; indent?: number };
type FileArrow = Omit<Arrow, 'id'>;
type FileMark = Omit<Mark, 'id'>;
export type NoteFile = { format: 'notex'; version: 1; blocks: FileBlock[]; arrows: FileArrow[]; marks?: FileMark[] };

export function encode(doc: Doc): NoteFile {
  const where = new Map<Id, string>();
  const blocks = doc.blocks.map((b, bi): FileBlock => {
    where.set(b.id, `b${bi}`);
    const content: Content[] = [];
    // runs of text in one style
    let run = '', style = '';
    const flush = () => {
      if (run) content.push(style ? { s: run, ...(style.includes('b') ? { b: 1 as const } : {}), ...(style.includes('i') ? { i: 1 as const } : {}) } : run);
      run = '';
    };
    b.items.forEach((it, o) => {
      if (it.t === 'c') {
        where.set(it.id, `c${bi}.${o}`);
        const st = (it.b ? 'b' : '') + (it.i ? 'i' : '');
        if (st !== style) flush(), (style = st);
        run += it.ch;
      } else {
        flush();
        content.push(it.display ? { m: it.root, id: it.id, d: 1 } : { m: it.root, id: it.id });
      }
    });
    flush();
    return b.indent ? { kind: b.kind, content, indent: b.indent } : { kind: b.kind, content };
  });
  const mapIds = (ids: Id[]) => ids.map((id) => where.get(id) ?? id);
  const arrows = doc.arrows.map(({ id: _id, ...a }) => ({ ...a, from: mapIds(a.from), to: mapIds(a.to) }));
  const marks = doc.marks.map(({ id: _id, ...m }) => ({ ...m, at: mapIds(m.at) }));
  const file: NoteFile = { format: 'notex', version: 1, blocks, arrows };
  if (marks.length) file.marks = marks;
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
          items.push(x);
        }
      else items.push({ t: 'm', id: c.id, root: c.m, display: !!c.d });
    }
    const blk = block(items, fb.kind);
    if (fb.indent) blk.indent = fb.indent;
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
  return { blocks, arrows, marks };
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
  return { blocks: doc.blocks, arrows: doc.arrows ?? [], marks: doc.marks ?? [] };
}
