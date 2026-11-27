// Core document model.
//
// A document is a list of blocks (paragraphs). Each block is a flat list of
// items: single characters or math items. Every item and every math node has a
// stable id, which is what arrows anchor to — so arrows survive edits around
// their endpoints.

import type { Placed, Shape } from './sketch/shapes';

export type Id = string;

/** A symbol; `ref`: a reference to a numbered equation or box (its `v` the label shown, kept up to date). */
/** `big`: a big operator (\int, \sum, \lim…) at display size wherever it is, limits under and over it. */
export type MSym = { k: 'sym'; id: Id; v: string; src?: string; ref?: Id; big?: true };
export type MCmd = { k: 'cmd'; id: Id; name: string; slots: MRow[]; cols?: number };
export type MNode = MSym | MCmd;
export type MRow = MNode[];

/**
 * A character of text. Its meaning in the markdown, read from the text (Editor.derive):
 * `b` / `i` / `c` bold, italic, inline code; `s` / `h` struck, highlighted; `l` a link's
 * text; `m` one of the markers (** ` # ~~ == [[ …).
 */
export type Char = { t: 'c'; id: Id; ch: string; b?: true; i?: true; c?: true; m?: true; s?: true; h?: true; l?: true; cell?: true };
/** A formula; `num`: a display formula with a number, (1), (2)… */
export type MathItem = { t: 'm'; id: Id; root: MRow; display: boolean; num?: true };
export type Item = Char | MathItem;

export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'li' | 'ol' | 'code' | 'fence' | 'img' | 'tr' | 'diagram';
/**
 * `indent`: how deep a list item is nested (0, absent, at the top). Headings (`# ` in their
 * text) and code blocks (lines between ``` fences: `fence` and `code` lines) are read from
 * the text; an opening fence's `lang` names its language. An image (`img`) is its `src`
 * (a data URL), shown `w` pixels wide, with its items as the caption. A table row (`tr`) has
 * its cells between cell walls (characters marked `cell`); its table's first row is the
 * header (`head`), with the columns' alignment (see tables.ts). A diagram (`diagram`) is its
 * `shapes` on a canvas `w` by `h` (its own coordinates; shown scaled down to fit a narrower
 * page), with its items as the caption.
 *
 * `check`: a list item with a box to tick (true: ticked). `box`: the block is in a box — a
 * theorem, a definition, a proof, a quote… — with the blocks next to it that share its `id`.
 * `fold`: a heading whose section is folded away.
 */
export type Block = {
  id: Id;
  kind: BlockKind;
  items: Item[];
  indent?: number;
  lang?: string;
  src?: string;
  w?: number;
  head?: true;
  aligns?: ('left' | 'center' | 'right' | null)[];
  shapes?: Shape[];
  h?: number;
  check?: boolean;
  box?: Box;
  fold?: true;
};
/** The kinds of box: numbered ones (theorem… example) count together, as in many books. */
export type BoxKind = 'theorem' | 'lemma' | 'proposition' | 'corollary' | 'definition' | 'example' | 'remark' | 'proof' | 'quote';
export type Box = { k: BoxKind; id: Id };
export const BOX_KINDS: BoxKind[] = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'example', 'remark', 'proof', 'quote'];
export const NUMBERED_BOX = new Set<BoxKind>(['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'example']);
/** What a box is called, at its start ('' for a quote). */
export const BOX_NAME: Record<BoxKind, string> = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition', corollary: 'Corollary', definition: 'Definition',
  example: 'Example', remark: 'Remark', proof: 'Proof', quote: '',
};
/** A reference's target is a formula (shown as (3)) or a box (Theorem 2). */
export const isRefItem = (it: Item | undefined): it is MathItem & { root: [MSym] } => it?.t === 'm' && it.root.length === 1 && it.root[0].k === 'sym' && !!it.root[0].ref;
/** Blocks shown as a figure with a caption under it: an image, a diagram. */
export const isFigure = (k: BlockKind) => k === 'img' || k === 'diagram';
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

/** `ink`: what's drawn on top of the note, each shape pinned to a block (see sketch/shapes.ts). */
export type Doc = { blocks: Block[]; arrows: Arrow[]; marks: Mark[]; ink?: Placed[] };

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
