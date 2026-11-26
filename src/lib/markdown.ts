// The markdown in a note's text, as Obsidian reads it: the markers (** * ` # ```) are
// characters like any other, and what they mean (bold, a heading, a code block) is read
// from the text after every edit (Editor.derive). Shown or hidden is the renderer's call.

/** A character's meaning: bold, italic, code, struck, highlighted, a link's, and whether it's one of the markers. */
export const BOLD = 1, ITALIC = 2, CODE = 4, MARK = 8, STRIKE = 16, HIGHLIGHT = 32, LINK = 64;

/** One styled span: items start..end (exclusive), the first `open` and last `close` of them markers. */
export type Span = { start: number; end: number; open: number; close: number };
/**
 * A link: items start..end (its markers included: the first `open` and last `close`), to a
 * note by name (`note`) or a web address.
 */
export type Link = { start: number; end: number; open: number; close: number; to: string; note: boolean };

/** What isn't a character (a formula) in the text handed to these. */
export const OBJ = '￼';

const space = (c: string | undefined) => c === undefined || /\s/.test(c);
const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Inline markdown of a paragraph's text: `code` (a run of backticks to the next run as
 * long), then ***both***, **bold**, *italic*, __bold__, _italic_, ~~struck~~, ==highlighted==
 * (exact runs, no space just inside; underscores not inside words). Code holds no markers or
 * formulas; emphasis may hold code, formulas and emphasis of the other kind. Links:
 * [[a note]], [[a note|what shows]], [text](address) and bare https:// addresses (not in
 * code). Flags per character, the spans and the links.
 */
export function parseInline(text: string): { flags: Uint16Array; spans: Span[]; links: Link[] } {
  const n = text.length;
  const flags = new Uint16Array(n);
  const spans: Span[] = [];
  /** Characters a marker can't be: in code, or already a marker. */
  const used = new Uint8Array(n);
  const runAt = (i: number, c: string) => {
    let L = 0;
    while (text[i + L] === c) L++;
    return L;
  };

  for (let i = 0; i < n; ) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    const L = runAt(i, '`');
    let close = -1;
    for (let j = i + L; j < n; ) {
      if (text[j] === OBJ) break;
      if (text[j] !== '`') {
        j++;
        continue;
      }
      const K = runAt(j, '`');
      if (K === L) {
        close = j;
        break;
      }
      j += K;
    }
    if (close < 0 || close === i + L) {
      i += L;
      continue;
    }
    for (let k = i; k < close + L; k++) (flags[k] |= CODE), (used[k] = 1);
    for (let k = 0; k < L; k++) (flags[i + k] |= MARK), (flags[close + k] |= MARK);
    spans.push({ start: i, end: close + L, open: L, close: L });
    i = close + L;
  }

  // links: their markers hidden but while the caret is at them, what shows is the link's
  const links: Link[] = [];
  const free = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (used[k] || text[k] === OBJ) return false;
    return true;
  };
  const link = (start: number, end: number, open: number, close: number, to: string, note: boolean) => {
    for (let k = start; k < end; k++) used[k] = 1;
    for (let k = start + open; k < end - close; k++) flags[k] |= LINK;
    for (let k = 0; k < open; k++) flags[start + k] |= MARK;
    for (let k = 1; k <= close; k++) flags[end - k] |= MARK;
    if (open || close) spans.push({ start, end, open, close });
    links.push({ start, end, open, close, to, note });
  };
  for (const m of text.matchAll(/\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g)) {
    const a = m.index!, z = a + m[0].length;
    if (free(a, z)) link(a, z, m[2] ? 3 + m[1].length : 2, 2, m[1].trim(), true);
  }
  for (const m of text.matchAll(/\[([^[\]\n]+)\]\((\S+?)\)/g)) {
    const a = m.index!, z = a + m[0].length;
    if (free(a, z)) link(a, z, 1, m[2].length + 3, m[2], false);
  }
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"\uFFFC]+/g)) {
    const a = m.index!;
    // (not the punctuation after it, or a closing bracket it didn't open)
    let z = a + m[0].length;
    while (z > a && /[.,;:!?'"]/.test(text[z - 1])) z--;
    if (text[z - 1] === ')' && !text.slice(a, z).includes('(')) z--;
    if (free(a, z)) link(a, z, 0, 0, text.slice(a, z), false);
  }

  const kinds: [string, number, number][] = [
    ['*', 3, BOLD | ITALIC],
    ['*', 2, BOLD],
    ['_', 2, BOLD],
    ['*', 1, ITALIC],
    ['_', 1, ITALIC],
    ['~', 2, STRIKE],
    ['=', 2, HIGHLIGHT],
  ];
  for (const [c, L, style] of kinds)
    for (let i = 0; i < n; i++) {
      if (text[i] !== c || used[i] || text[i - 1] === c) continue;
      const run = runAt(i, c);
      if (run !== L || [...Array(L).keys()].some((k) => used[i + k])) {
        i += run - 1;
        continue;
      }
      if (space(text[i + L]) || (c === '_' && wordChar(text[i - 1]))) continue;
      let close = -1;
      for (let j = i + L + 1; j < n; j++) {
        if (text[j] !== c || used[j] || text[j - 1] === c) continue;
        const K = runAt(j, c);
        if (K === L && !space(text[j - 1]) && !(c === '_' && wordChar(text[j + L])) && ![...Array(L).keys()].some((k) => used[j + k])) {
          close = j;
          break;
        }
        j += K - 1;
      }
      if (close < 0) continue;
      for (let k = i + L; k < close; k++) flags[k] |= style;
      for (let k = 0; k < L; k++) {
        flags[i + k] |= MARK;
        flags[close + k] |= MARK;
        used[i + k] = used[close + k] = 1;
      }
      spans.push({ start: i, end: close + L, open: L, close: L });
      i = close + L - 1;
    }
  return { flags, spans, links };
}

/** A heading line: `# ` to `###### ` at its start (the #s and the space are its prefix). */
export function headingOf(text: string): { level: number; prefix: number } | null {
  const m = /^(#{1,6}) /.exec(text);
  return m ? { level: m[1].length, prefix: m[0].length } : null;
}

/** A horizontal line: `---`, `***` or `___` (three or more) alone on a line. */
export const isRule = (text: string) => /^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/.test(text);

/** A paragraph that is a horizontal line (its text one, and no formula in it). */
export const ruleBlock = (blk: { kind: string; items: { t: string; ch?: string }[] }) =>
  blk.kind === 'p' && blk.items.length >= 3 && blk.items.length < 40 && blk.items.every((i) => i.t === 'c') && isRule(blk.items.map((i) => i.ch).join(''));

/** An opening code fence (```, ```python): its language ('' for none); null if it isn't one. */
export function fenceOf(text: string): string | null {
  const m = /^```[ \t]*([\w+#.-]*)[ \t]*$/.exec(text);
  return m ? m[1] : null;
}

/** A closing code fence: ``` alone. */
export const closesFence = (text: string) => /^```[ \t]*$/.test(text);
