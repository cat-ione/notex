// Core document model.
//
// A document is a list of blocks (paragraphs). Each block is a flat list of
// items: single characters or math items. Every item and every math node has a
// stable id, which is what arrows anchor to — so arrows survive edits around
// their endpoints.

export type Id = string;

export type MSym = { k: 'sym'; id: Id; v: string; src?: string };
export type MCmd = { k: 'cmd'; id: Id; name: string; slots: MRow[]; cols?: number };
export type MNode = MSym | MCmd;
export type MRow = MNode[];

/** A character of text; `b` / `i`: bold, italic. */
export type Char = { t: 'c'; id: Id; ch: string; b?: true; i?: true };
export type MathItem = { t: 'm'; id: Id; root: MRow; display: boolean };
export type Item = Char | MathItem;

export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'ol';
/** `indent`: how deep a list item is nested (0, absent, at the top). */
export type Block = { id: Id; kind: BlockKind; items: Item[]; indent?: number };
export const isListKind = (k: BlockKind) => k === 'li' || k === 'ol';
/** Deepest a list item can be nested. */
export const MAX_INDENT = 4;

export type ArrowHead = 'end' | 'both' | 'none';
export type Arrow = {
  id: Id;
  from: Id[];
  to: Id[];
  /** How far the curve's middle is pulled across the arrow (a fraction of its length)... */
  bend: number;
  /** ...and along it, towards the tip (absent: 0, the middle). */
  skew?: number;
  head: ArrowHead;
  dash: boolean;
  boxed: boolean;
  label: string;
  color?: string;
  /** Where its note was put by hand (see NoteAt); absent: placed automatically. */
  note?: NoteAt;
  /** Where each end attaches on its target (see Attach); absent: wherever faces the other end. */
  fromAt?: Attach;
  toAt?: Attach;
};
/** A point on the edge of an arrow end's target box, as fractions of its width and height. */
export type Attach = { x: number; y: number };

/** A shape drawn around / under a run of text or math. */
export type MarkKind = 'box' | 'circle' | 'underline' | 'highlight' | 'brace' | 'strike';
export type Mark = { id: Id; kind: MarkKind; at: Id[]; dash: boolean; label: string; color?: string; note?: NoteAt };
/** A note placed by hand: its centre's offset from the middle of its drawing (an arrow's midpoint). */
export type NoteAt = { dx: number; dy: number };

export type Doc = { blocks: Block[]; arrows: Arrow[]; marks: Mark[] };

const prefix = Math.random().toString(36).slice(2, 6);
let counter = 0;
export const uid = (): Id => `${prefix}${(counter++).toString(36)}`;

export const sym = (v: string, src?: string): MSym => (src ? { k: 'sym', id: uid(), v, src } : { k: 'sym', id: uid(), v });
export const cmd = (name: string, slots: MRow[], cols?: number): MCmd =>
  cols ? { k: 'cmd', id: uid(), name, slots, cols } : { k: 'cmd', id: uid(), name, slots };
export const ch = (c: string): Char => ({ t: 'c', id: uid(), ch: c });
export const chars = (s: string): Char[] => [...s].map(ch);
export const math = (root: MRow = [], display = false): MathItem => ({ t: 'm', id: uid(), root, display });
export const block = (items: Item[] = [], kind: BlockKind = 'p'): Block => ({ id: uid(), kind, items });

/** Deep-copy a math row with fresh ids (for paste / duplication). */
export function cloneRow(row: MRow): MRow {
  return row.map((n) => (n.k === 'sym' ? { ...n, id: uid() } : { ...n, id: uid(), slots: n.slots.map(cloneRow) }));
}

/** Collect every id present in the document (used to prune dangling arrows). */
export function allIds(doc: Doc): Set<Id> {
  const ids = new Set<Id>();
  const walk = (row: MRow) => {
    for (const n of row) {
      ids.add(n.id);
      if (n.k === 'cmd') n.slots.forEach(walk);
    }
  };
  for (const b of doc.blocks) {
    ids.add(b.id);
    for (const it of b.items) {
      ids.add(it.id);
      if (it.t === 'm') walk(it.root);
    }
  }
  return ids;
}
