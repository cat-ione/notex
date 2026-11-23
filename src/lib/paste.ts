// Pasting text from elsewhere: a chat answer, a web page, another notes app, a LaTeX
// source. Its math comes in as formulas ($…$, $$…$$, \(…\), \[…\]); its markdown as the
// text it is (notex reads **bold**, `code`, # headings and ``` fences from the text), lists
// as lists (- / 1., nested by indentation).

import { chars, math, type BlockKind, type Item } from './model';
import { parseLatex } from './math/parse';

export type PastedBlock = { kind: BlockKind; indent?: number; items: Item[] };

/**
 * One line of text as items: formulas from $…$ / $$…$$ (not prices: `$5 and $10` stays
 * text, as in pandoc: no space just inside the dollars, no digit right after the closing
 * one); `code` as it is, dollars and all.
 */
export function inlineItems(line: string): Item[] {
  const out: Item[] = [];
  let at = 0;
  for (const m of line.matchAll(/(`+)[^`]+?\1/g)) {
    out.push(...withMath(line.slice(at, m.index)), ...chars(m[0]));
    at = m.index! + m[0].length;
  }
  return [...out, ...withMath(line.slice(at))];
}

function withMath(line: string): Item[] {
  const out: Item[] = [];
  let last = 0;
  const prose = (s: string) => out.push(...chars(s));
  for (const m of line.matchAll(/\$\$([^$]+)\$\$|\$(?![\s$])([^$\n]*?[^\s$\\])\$(?!\d)|\$(?![\s$])([^$\s])\$(?!\d)/g)) {
    prose(line.slice(last, m.index));
    out.push(math(parseLatex((m[1] ?? m[2] ?? m[3]).trim()).row, !!m[1]));
    last = m.index! + m[0].length;
  }
  prose(line.slice(last));
  return out;
}

/** LaTeX's \(…\) and \[…\] as dollars, and a display formula spread over lines on one line. */
function normalizeMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m: string) => `$$${m.replace(/\s*\n\s*/g, ' ').trim()}$$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m: string) => `$$${m.replace(/\s*\n\s*/g, ' ').trim()}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m.replace(/\s*\n\s*/g, ' ').trim()}$`);
}

/**
 * Pasted text as paragraphs. Several lines: markdown's headings and lists become
 * structure (indented items nest, two spaces or a tab a level) and blank lines between
 * paragraphs go (notex spaces paragraphs itself). One line: just its text and math.
 */
export function parsePaste(text: string): PastedBlock[] {
  text = text.replace(/\r\n?/g, '\n');
  // fenced code: its fences and lines as they are (no math read in it, blank lines kept)
  const fences: PastedBlock[][] = [];
  text = text.replace(/^[ \t]*(```[\w+#.-]*)[ \t]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/gm, (_, open: string, body: string) => {
    const lines = [open, ...body.replace(/\t/g, '  ').split('\n'), '```'];
    fences.push(lines.map((l): PastedBlock => ({ kind: 'p', items: chars(l) })));
    return `\u0000${fences.length - 1}`;
  });
  const lines = normalizeMath(text).split('\n');
  if (lines.length === 1 && !fences.length) return [{ kind: 'p', items: inlineItems(lines[0]) }];
  const out: PastedBlock[] = [];
  for (const raw of lines) {
    const fence = /^\u0000(\d+)$/.exec(raw);
    if (fence) {
      out.push(...fences[+fence[1]]);
      continue;
    }
    if (!raw.trim()) continue;
    const line = raw.replace(/\t/g, '  ');
    let m: RegExpExecArray | null;
    if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) out.push({ kind: 'p', items: inlineItems(`${m[1]} ${m[2]}`) });
    else if ((m = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line))) {
      const indent = Math.min(4, Math.floor(m[1].length / 2));
      out.push({ kind: m[2] ? 'ol' : 'li', ...(indent ? { indent } : {}), items: inlineItems(m[3]) });
    } else out.push({ kind: 'p', items: inlineItems(line.trim()) });
  }
  return out.length ? out : [{ kind: 'p', items: [] }];
}

