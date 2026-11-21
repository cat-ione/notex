// LaTeX -> math tree. Used for pasting LaTeX and for user snippets.
//
// Covers the structures the editor knows (fractions, roots, scripts,
// delimiters, accents, fonts, text, matrices); any other control sequence
// becomes a plain symbol, which KaTeX renders as-is. In snippets a `#` marks
// where the caret should land.

import { cmd, sym, type MRow } from '../model';
import { CMDS } from './defs';
import type { MCursor, Step } from './latex';

/** LaTeX command → [editor cmd name, number of braced args]. */
const COMMANDS: Record<string, [string, number]> = {
  '\\frac': ['frac', 2], '\\dfrac': ['dfrac', 2], '\\tfrac': ['frac', 2], '\\binom': ['binom', 2],
  '\\hat': ['hat', 1], '\\widehat': ['widehat', 1], '\\bar': ['bar', 1], '\\overline': ['bar', 1],
  '\\underline': ['underline', 1], '\\vec': ['vec', 1], '\\tilde': ['tilde', 1], '\\widetilde': ['tilde', 1],
  '\\dot': ['dot', 1], '\\ddot': ['ddot', 1], '\\mathbb': ['mathbb', 1], '\\mathcal': ['mathcal', 1],
  '\\mathfrak': ['mathfrak', 1], '\\mathbf': ['mathbf', 1], '\\boldsymbol': ['mathbf', 1], '\\mathrm': ['mathrm', 1],
  '\\boxed': ['boxed', 1], '\\cancel': ['cancel', 1], '\\operatorname': ['operatorname', 1],
  '\\overset': ['overset', 2], '\\underset': ['underset', 2],
  '\\text': ['text', 1], '\\textrm': ['text', 1], '\\mbox': ['text', 1], '\\textit': ['text', 1],
};

const LEFT_DELIMS: Record<string, string> = {
  '(': 'paren', '[': 'bracket', '\\{': 'brace', '\\lbrace': 'brace', '|': 'abs', '\\vert': 'abs', '\\lvert': 'abs',
  '\\|': 'norm', '\\Vert': 'norm', '\\lVert': 'norm', '\\langle': 'angle', '\\lfloor': 'floor', '\\lceil': 'ceil',
};

const ENVS: Record<string, string> = {
  pmatrix: 'pmatrix', bmatrix: 'bmatrix', vmatrix: 'vmatrix', matrix: 'matrix', smallmatrix: 'matrix', array: 'matrix',
  cases: 'cases', aligned: 'aligned', align: 'aligned', 'align*': 'aligned', gathered: 'aligned', split: 'aligned',
};

/** Tokens that carry no content in the tree. */
const IGNORED = new Set(['\\displaystyle', '\\textstyle', '\\limits', '\\nolimits', '\\left.', '\\right.', '\\middle']);

function tokenize(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+\*?|.)/s.exec(src.slice(i));
      if (!m) break;
      out.push(m[0]);
      i += m[0].length;
    } else if (c === '%') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (/\s/.test(c)) {
      // Collapse whitespace into one token; it only matters inside \text.
      if (out[out.length - 1] !== ' ') out.push(' ');
      while (i < src.length && /\s/.test(src[i])) i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

export type Parsed = { row: MRow; cursor: MCursor | null };

export function parseLatex(src: string): Parsed {
  const s = src.trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '');
  const toks = tokenize(s);
  let p = 0;
  let cursor: MCursor | null = null;
  const ws = () => {
    while (toks[p] === ' ') p++;
  };

  /** One argument: a braced group, or a single atom. */
  const arg = (path: Step[]): MRow => {
    ws();
    if (toks[p] === '{') {
      p++;
      return row(path, ['}']);
    }
    return row(path, [], 1);
  };

  function readName(): string {
    ws();
    if (toks[p] !== '{') return '';
    p++;
    let n = '';
    while (p < toks.length && toks[p] !== '}') n += toks[p++];
    p++;
    return n.trim();
  }

  /** `\text{...}`: keep characters literally (spaces were dropped by the tokenizer, so re-read raw). */
  function textArg(): MRow {
    ws();
    if (toks[p] !== '{') return toks[p] ? [sym(toks[p++])] : [];
    p++;
    const out: MRow = [];
    let depth = 0;
    while (p < toks.length) {
      const t = toks[p++];
      if (t === '{') { depth++; continue; }
      if (t === '}') { if (depth-- === 0) break; continue; }
      out.push(sym(t === '\\ ' || t === '~' ? ' ' : t.length === 2 && t[0] === '\\' ? t[1] : t));
    }
    return out;
  }

  /** Parse nodes until a stop token (consumed) or, with `max`, until that many nodes. */
  function row(path: Step[], stops: string[], max = Infinity): MRow {
    const r: MRow = [];
    const at = (s: number): Step[] => [...path, { i: r.length, s }];

    while (p < toks.length && r.length < max) {
      const t = toks[p++];
      if (t === ' ') continue;
      if (stops.includes(t)) return r;
      if (t === '#') { cursor = { path, off: r.length }; continue; }
      if (IGNORED.has(t)) continue;
      if (t === '{') { r.push(...row(path, ['}'])); continue; }

      if (t === '^' || t === '_') {
        const kind = t === '^' ? 'sup' : 'sub';
        const prev = r[r.length - 1];
        if (prev?.k === 'cmd' && prev.name === (kind === 'sup' ? 'sub' : 'sup')) {
          r.pop();
          const content = arg(at(kind === 'sub' ? 0 : 1));
          r.push(cmd('subsup', kind === 'sub' ? [content, prev.slots[0]] : [prev.slots[0], content]));
        } else r.push(cmd(kind, [arg(at(0))]));
        continue;
      }

      if (t === '\\left') {
        ws();
        const name = LEFT_DELIMS[toks[p++]] ?? 'paren';
        const body = row(at(0), ['\\right']);
        ws();
        p++; // the closing delimiter
        r.push(cmd(name, [body]));
        continue;
      }

      if (t === '(' || t === '[' || t === '\\{') {
        // Plain brackets become delimiter nodes when they are matched.
        const close = t === '(' ? ')' : t === '[' ? ']' : '\\}';
        if (hasMatch(toks, p, t, close)) r.push(cmd(LEFT_DELIMS[t], [row(at(0), [close])]));
        else r.push(sym(t));
        continue;
      }

      if (t === '\\sqrt') {
        ws();
        if (toks[p] === '[') {
          p++;
          const n = row(at(0), [']']);
          r.push(cmd('root', [n, arg(at(1))]));
        } else r.push(cmd('sqrt', [arg(at(0))]));
        continue;
      }

      if (t === '\\overbrace' || t === '\\underbrace') {
        const body = arg(at(0));
        ws();
        const label = toks[p] === '^' || toks[p] === '_' ? (p++, arg(at(1))) : [];
        r.push(cmd(t.slice(1), [body, label]));
        continue;
      }

      if (t === '\\begin') {
        const env = readName();
        if (env === 'array') readName(); // column spec
        const base = r.length;
        const cells: MRow[] = [];
        const lens: number[] = [];
        let n = 0;
        while (p < toks.length) {
          cells.push(row([...path, { i: base, s: cells.length }], ['&', '\\\\', '\\end']));
          n++;
          const sep = toks[p - 1];
          if (sep === '\\\\') lens.push(n), (n = 0);
          else if (sep === '\\end') { readName(); break; }
          else if (sep !== '&') break;
        }
        if (n) lens.push(n);
        // A trailing `\\` leaves an empty last row.
        if (lens.length > 1 && lens[lens.length - 1] === 1 && !cells[cells.length - 1].length) lens.pop(), cells.pop();
        const width = Math.max(1, ...lens);
        const grid: MRow[] = [];
        let k = 0;
        for (const len of lens) {
          for (let c = 0; c < width; c++) grid.push(c < len ? cells[k + c] : []);
          k += len;
        }
        r.push(cmd(ENVS[env] ?? 'matrix', grid, width));
        continue;
      }

      const c = COMMANDS[t];
      if (c) {
        const [name, n] = c;
        if (CMDS[name]?.text) {
          r.push(cmd(name, [textArg()]));
          continue;
        }
        const slots: MRow[] = [];
        for (let k = 0; k < n; k++) slots.push(arg(at(k)));
        r.push(cmd(name, slots));
        continue;
      }

      if (t === '}' || t === '&' || t === '\\\\') continue; // unmatched / stray structure
      r.push(sym(t === '~' ? '\\ ' : t));
    }
    return r;
  }

  return { row: row([], []), cursor };
}

function hasMatch(toks: string[], from: number, open: string, close: string): boolean {
  let depth = 0;
  for (let i = from; i < toks.length; i++) {
    if (toks[i] === open) depth++;
    else if (toks[i] === close && depth-- === 0) return true;
  }
  return false;
}

/** Where the caret should go after inserting a parsed row: the `#`, else the first empty slot, else the end. */
export function caretFor(parsed: Parsed): MCursor {
  if (parsed.cursor) return parsed.cursor;
  const find = (row: MRow, path: Step[]): MCursor | null => {
    for (let i = 0; i < row.length; i++) {
      const n = row[i];
      if (n.k !== 'cmd') continue;
      for (let s = 0; s < n.slots.length; s++) {
        const sp = [...path, { i, s }];
        if (!n.slots[s].length) return { path: sp, off: 0 };
        const f = find(n.slots[s], sp);
        if (f) return f;
      }
    }
    return null;
  };
  return find(parsed.row, []) ?? { path: [], off: parsed.row.length };
}

/** Does pasted text look like LaTeX rather than plain characters? */
export const looksLikeLatex = (s: string) => /\\[a-zA-Z]+|[\^_]\{|^\$[^$]+\$$/s.test(s.trim());
