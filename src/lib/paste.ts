// Pasting text from elsewhere: a chat answer, a web page, another notes app, a LaTeX
// source. Its math comes in as formulas ($…$, $$…$$, \(…\), \[…\]), its markdown as
// structure (# headings, - / 1. lists, indentation, **bold**, *italic*).

import { ch, math, type BlockKind, type Item } from './model';
import { parseLatex } from './math/parse';
import { noteRuns } from './labels';

export type PastedBlock = { kind: BlockKind; indent?: number; items: Item[] };

/**
 * One line of text as items: formulas from $…$ / $$…$$ (not prices: `$5 and $10` stays
 * text, as in pandoc: no space just inside the dollars, no digit right after the closing
 * one), bold / italic from stars.
 */
export function inlineItems(line: string): Item[] {
  const out: Item[] = [];
  let last = 0;
  const prose = (s: string) => {
    for (const { text, stars } of noteRuns(s))
      for (const c of text) {
        const x = ch(c);
        if (stars >= 2) x.b = true;
        if (stars === 1 || stars === 3) x.i = true;
        out.push(x);
      }
  };
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
  const lines = normalizeMath(text.replace(/\r\n?/g, '\n')).split('\n');
  if (lines.length === 1) return [{ kind: 'p', items: inlineItems(lines[0]) }];
  const out: PastedBlock[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const line = raw.replace(/\t/g, '  ');
    let m: RegExpExecArray | null;
    if ((m = /^\s*(#{1,3})\s+(.*)$/.exec(line))) out.push({ kind: (['h1', 'h2', 'h3'] as const)[m[1].length - 1], items: inlineItems(m[2]) });
    else if ((m = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line))) {
      const indent = Math.min(4, Math.floor(m[1].length / 2));
      out.push({ kind: m[2] ? 'ol' : 'li', ...(indent ? { indent } : {}), items: inlineItems(m[3]) });
    } else out.push({ kind: 'p', items: inlineItems(line.trim()) });
  }
  return out.length ? out : [{ kind: 'p', items: [] }];
}

