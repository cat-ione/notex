// The markdown in a note's text, as Obsidian reads it: the markers (** * ` # ```) are
// characters like any other, and what they mean (bold, a heading, a code block) is read
// from the text after every edit (Editor.derive). Shown or hidden is the renderer's call.

/** A character's meaning: bold, italic, code, and whether it's one of the markers. */
export const BOLD = 1, ITALIC = 2, CODE = 4, MARK = 8;

/** One styled span: items start..end (exclusive), the first `open` and last `close` of them markers. */
export type Span = { start: number; end: number; open: number; close: number };

/** What isn't a character (a formula) in the text handed to these. */
export const OBJ = '￼';

const space = (c: string | undefined) => c === undefined || /\s/.test(c);
const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Inline markdown of a paragraph's text: `code` (a run of backticks to the next run as
 * long), then ***both***, **bold**, *italic*, __bold__, _italic_ (exact runs, no space just
 * inside; underscores not inside words). Code holds no markers or formulas; emphasis may
 * hold code, formulas and emphasis of the other kind. Flags per character, and the spans.
 */
export function parseInline(text: string): { flags: Uint8Array; spans: Span[] } {
  const n = text.length;
  const flags = new Uint8Array(n);
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

  const kinds: [string, number, number][] = [
    ['*', 3, BOLD | ITALIC],
    ['*', 2, BOLD],
    ['_', 2, BOLD],
    ['*', 1, ITALIC],
    ['_', 1, ITALIC],
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
  return { flags, spans };
}

/** A heading line: `# ` to `###### ` at its start (the #s and the space are its prefix). */
export function headingOf(text: string): { level: number; prefix: number } | null {
  const m = /^(#{1,6}) /.exec(text);
  return m ? { level: m[1].length, prefix: m[0].length } : null;
}

/** An opening code fence (```, ```python): its language ('' for none); null if it isn't one. */
export function fenceOf(text: string): string | null {
  const m = /^```[ \t]*([\w+#.-]*)[ \t]*$/.exec(text);
  return m ? m[1] : null;
}

/** A closing code fence: ``` alone. */
export const closesFence = (text: string) => /^```[ \t]*$/.test(text);
