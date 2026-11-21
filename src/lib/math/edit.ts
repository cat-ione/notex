// Structural editing of a math tree with a cursor.
//
// A cursor is a path of (node index, slot index) steps from the root row down
// to the row being edited, plus an offset within that row. All operations
// mutate the tree and cursor in place and return whether they did anything;
// returning false at the root boundary lets the caller exit the math item.

import { cmd, sym, type MCmd, type MNode, type MRow } from '../model';
import { AUTO_REPLACE, AUTO_STRUCT, CMDS, OPENERS, type Inserter } from './defs';
import type { MCursor, Step } from './latex';
import { caretFor, parseLatex, type Parsed } from './parse';

export function rowAt(root: MRow, path: Step[]): MRow {
  let r = root;
  for (const st of path) r = (r[st.i] as MCmd).slots[st.s];
  return r;
}

function parentOf(root: MRow, cur: MCursor): { row: MRow; node: MCmd; step: Step } | null {
  if (!cur.path.length) return null;
  const step = cur.path[cur.path.length - 1];
  const row = rowAt(root, cur.path.slice(0, -1));
  return { row, node: row[step.i] as MCmd, step };
}

const hasSlots = (n: MNode | undefined): n is MCmd => n?.k === 'cmd' && n.slots.length > 0;
const def = (n: MCmd) => CMDS[n.name];
const isText = (root: MRow, cur: MCursor) => {
  const p = parentOf(root, cur);
  return !!p && !!def(p.node)?.text;
};
export const inTextSlot = isText;

export function enter(cur: MCursor, i: number, s: number, atEnd: boolean, root: MRow) {
  cur.path.push({ i, s });
  cur.off = atEnd ? rowAt(root, cur.path).length : 0;
}

export function exitAfter(root: MRow, cur: MCursor): boolean {
  const st = cur.path.pop();
  if (!st) return false;
  cur.off = st.i + 1;
  return true;
}

export function moveRight(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off < r.length) {
    const n = r[cur.off];
    if (hasSlots(n)) enter(cur, cur.off, 0, false, root);
    else cur.off++;
    return true;
  }
  const p = parentOf(root, cur);
  if (!p) return false;
  if (def(p.node)?.linear && p.step.s < p.node.slots.length - 1) {
    p.step.s++;
    cur.off = 0;
  } else exitAfter(root, cur);
  return true;
}

export function moveLeft(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off > 0) {
    const n = r[cur.off - 1];
    if (hasSlots(n)) {
      const s = def(n)?.linear ? n.slots.length - 1 : 0;
      enter(cur, cur.off - 1, s, true, root);
    } else cur.off--;
    return true;
  }
  const p = parentOf(root, cur);
  if (!p) return false;
  if (def(p.node)?.linear && p.step.s > 0) {
    p.step.s--;
    cur.off = rowAt(root, cur.path).length;
  } else {
    cur.path.pop();
    cur.off = p.step.i;
  }
  return true;
}

/** Move between vertically arranged slots (fraction parts, scripts, matrix rows). */
export function moveVert(root: MRow, cur: MCursor, dir: 'up' | 'down'): boolean {
  for (let d = cur.path.length - 1; d >= 0; d--) {
    const node = rowAt(root, cur.path.slice(0, d))[cur.path[d].i] as MCmd;
    const df = def(node);
    const s = cur.path[d].s;
    let ns: number | undefined;
    if (df?.grid && node.cols) {
      const t = dir === 'up' ? s - node.cols : s + node.cols;
      if (t >= 0 && t < node.slots.length) ns = t;
    } else ns = df?.[dir]?.[s];
    if (ns !== undefined) {
      const oldOff = cur.off;
      cur.path = [...cur.path.slice(0, d), { i: cur.path[d].i, s: ns }];
      cur.off = Math.min(oldOff, rowAt(root, cur.path).length);
      return true;
    }
  }
  // Not inside anything vertical: try entering a vertical node next to the caret.
  const r = rowAt(root, cur.path);
  for (const idx of [cur.off, cur.off - 1]) {
    const n = r[idx];
    if (hasSlots(n) && (def(n)?.up || def(n)?.down)) {
      const target = Object.entries(def(n)[dir === 'up' ? 'down' : 'up'] ?? {})[0];
      if (target) {
        enter(cur, idx, +target[0], false, root);
        return true;
      }
    }
  }
  return false;
}

/** Tab: next slot, or out of the innermost node. */
export function nextSlot(root: MRow, cur: MCursor): boolean {
  const p = parentOf(root, cur);
  if (!p) return false;
  if (p.step.s < p.node.slots.length - 1) {
    p.step.s++;
    cur.off = 0;
  } else exitAfter(root, cur);
  return true;
}

export function prevSlot(root: MRow, cur: MCursor): boolean {
  const p = parentOf(root, cur);
  if (!p) return false;
  if (p.step.s > 0) {
    p.step.s--;
    cur.off = rowAt(root, cur.path).length;
  } else {
    cur.path.pop();
    cur.off = p.step.i;
  }
  return true;
}

export function insertNode(root: MRow, cur: MCursor, n: MNode, enterSlot?: number) {
  const r = rowAt(root, cur.path);
  r.splice(cur.off, 0, n);
  if (enterSlot !== undefined && hasSlots(n)) enter(cur, cur.off, enterSlot, false, root);
  else cur.off++;
}

export function applyInserter(root: MRow, cur: MCursor, ins: Inserter) {
  if ('node' in ins) insertNode(root, cur, ins.node(), ins.enter);
  else {
    const nodes = ins.nodes();
    nodes.forEach((n, k) => insertNode(root, cur, n, k === nodes.length - 1 ? ins.enterLast : undefined));
  }
}

/** Insert a parsed row at the caret and put the caret where the parse says. */
export function insertParsed(root: MRow, cur: MCursor, parsed: Parsed) {
  const r = rowAt(root, cur.path);
  const start = cur.off;
  r.splice(start, 0, ...parsed.row);
  const c = caretFor(parsed);
  if (!c.path.length) cur.off = start + c.off;
  else {
    cur.path = [...cur.path, { i: start + c.path[0].i, s: c.path[0].s }, ...c.path.slice(1)];
    cur.off = c.off;
  }
}

export function backspace(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off > 0) {
    const prev = r[cur.off - 1];
    if (hasSlots(prev) && prev.slots.some((s) => s.length)) {
      const s = prev.slots.length - 1;
      enter(cur, cur.off - 1, s, true, root);
      return true;
    }
    if (prev.k === 'sym' && prev.src && prev.src.length > 1) {
      // Undo an auto-replacement: `\alpha` -> `alph`.
      const chars = [...prev.src.slice(0, -1)].map((c) => sym(c));
      r.splice(cur.off - 1, 1, ...chars);
      cur.off += chars.length - 1;
      return true;
    }
    r.splice(cur.off - 1, 1);
    cur.off--;
    return true;
  }
  const p = parentOf(root, cur);
  if (!p) return false;
  // At the start of a slot: delete the node if empty, otherwise unwrap it.
  const before = p.node.slots.slice(0, p.step.s).reduce((a, s) => a + s.length, 0);
  const contents = p.node.slots.flat();
  cur.path.pop();
  p.row.splice(p.step.i, 1, ...contents);
  cur.off = p.step.i + before;
  return true;
}

export function deleteForward(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off < r.length) {
    const n = r[cur.off];
    if (hasSlots(n) && n.slots.some((s) => s.length)) {
      enter(cur, cur.off, 0, false, root);
      return true;
    }
    r.splice(cur.off, 1);
    return true;
  }
  return false;
}

const OPERAND = /^([a-zA-Z0-9.!']|\\[a-zA-Z]+)$/;
const NOT_OPERAND = new Set(['\\to', '\\implies', '\\iff', '\\le', '\\ge', '\\ne', '\\approx', '\\cdot', '\\times', '\\pm', '\\mp', '\\in', '\\mapsto', '\\cong', '\\leftarrow', '\\longrightarrow', '\\dots', '\\quad', '\\qquad', '\\sum', '\\int', '\\prod', '\\lim']);

/** `/`: build a fraction from the operand before the caret (MathQuill-style). */
export function fraction(root: MRow, cur: MCursor) {
  const r = rowAt(root, cur.path);
  let start = cur.off;
  if (start > 0) {
    // Swallow a trailing run of scripts together with their base.
    let j = start;
    while (j > 0 && r[j - 1].k === 'cmd' && def(r[j - 1] as MCmd)?.script) j--;
    if (j < start) start = Math.max(0, j - 1);
    else if (r[start - 1].k === 'cmd') start--;
    else
      while (start > 0 && r[start - 1].k === 'sym' && OPERAND.test((r[start - 1] as any).v) && !NOT_OPERAND.has((r[start - 1] as any).v))
        start--;
  }
  let num = r.splice(start, cur.off - start);
  // (a+b)/c -> \frac{a+b}{c}
  if (num.length === 1 && num[0].k === 'cmd' && num[0].name === 'paren') num = num[0].slots[0];
  const f = cmd('frac', [num, []]);
  r.splice(start, 0, f);
  cur.off = start;
  enter(cur, start, num.length ? 1 : 0, false, root);
}

/** `^` / `_`: attach a script, merging into an adjacent one when possible. */
export function script(root: MRow, cur: MCursor, kind: 'sup' | 'sub') {
  const r = rowAt(root, cur.path);
  // `x_1^2`: at the end of a subscript, `^` adds a superscript to the same base (and vice versa).
  const p = parentOf(root, cur);
  const other = kind === 'sup' ? 'sub' : 'sup';
  if (p && cur.off === r.length && r.length && (p.node.name === other || p.node.name === 'subsup')) {
    cur.path.pop();
    cur.off = p.step.i + 1;
    return script(root, cur, kind);
  }
  const prev = r[cur.off - 1];
  if (prev?.k === 'cmd') {
    if (prev.name === kind) return enter(cur, cur.off - 1, 0, true, root);
    if (prev.name === 'subsup') return enter(cur, cur.off - 1, kind === 'sub' ? 0 : 1, true, root);
    if (prev.name === (kind === 'sup' ? 'sub' : 'sup')) {
      const other = prev.slots[0];
      const ss = cmd('subsup', kind === 'sup' ? [other, []] : [[], other]);
      r.splice(cur.off - 1, 1, ss);
      return enter(cur, cur.off - 1, kind === 'sub' ? 0 : 1, false, root);
    }
  }
  insertNode(root, cur, cmd(kind, [[]]), 0);
}

/** Space: leave the innermost structure. Returns false at the root. */
export function exitStructure(root: MRow, cur: MCursor): boolean {
  return exitAfter(root, cur);
}

/** Type a character, applying structure keys and auto-replacements. */
export function typeChar(root: MRow, cur: MCursor, c: string) {
  if (isText(root, cur)) {
    if (c === '"') exitAfter(root, cur);
    else insertNode(root, cur, sym(c));
    return;
  }
  if (c === '/') return fraction(root, cur);
  if (c === '^') return script(root, cur, 'sup');
  if (c === '_') return script(root, cur, 'sub');
  if (c === '"') return insertNode(root, cur, cmd('text', [[]]), 0);
  if (OPENERS[c]) return insertNode(root, cur, cmd(OPENERS[c], [[]]), 0);
  if (c === '\'') return insertNode(root, cur, sym("'"));

  // Closing a delimiter we are inside of jumps out of it.
  for (let d = cur.path.length - 1; d >= 0; d--) {
    const n = rowAt(root, cur.path.slice(0, d))[cur.path[d].i] as MCmd;
    if (def(n)?.close === c) {
      cur.off = cur.path[d].i + 1;
      cur.path = cur.path.slice(0, d);
      return;
    }
    if (def(n)?.close) break;
  }

  const v = c === '{' ? '\\{' : c === '}' ? '\\}' : c === '%' ? '\\%' : c === '#' ? '\\#' : c === '&' ? '\\&' : c === '~' ? '\\sim' : c === '*' ? '*' : c;
  insertNode(root, cur, sym(v));
  autoReplace(root, cur);
}

/** User snippets (trigger → LaTeX template), set from the config. They win over built-ins. */
let userSnippets: Record<string, string> = {};
let longestTrigger = 8;
export function setMathSnippets(map: Record<string, string>) {
  userSnippets = map;
  longestTrigger = Math.max(8, ...Object.keys(map).map((k) => k.length));
}

function autoReplace(root: MRow, cur: MCursor) {
  const r = rowAt(root, cur.path);
  let best: { k: number; key: string } | null = null;
  let s = '';
  for (let k = 1; k <= cur.off && k <= longestTrigger; k++) {
    const n = r[cur.off - k];
    if (n.k !== 'sym') break;
    const piece = n.src ?? (n.v.startsWith('\\') && n.v.length > 1 ? null : n.v);
    if (piece == null) break;
    s = piece + s;
    if (userSnippets[s] !== undefined || AUTO_REPLACE[s] || AUTO_STRUCT[s]) best = { k, key: s };
  }
  if (!best) return;
  r.splice(cur.off - best.k, best.k);
  cur.off -= best.k;
  const user = userSnippets[best.key];
  if (user !== undefined) {
    const parsed = parseLatex(user);
    // A single symbol keeps its trigger so backspace / longer triggers still work.
    if (parsed.row.length === 1 && parsed.row[0].k === 'sym' && !parsed.cursor) insertNode(root, cur, sym(parsed.row[0].v, best.key));
    else insertParsed(root, cur, parsed);
  } else if (AUTO_REPLACE[best.key]) insertNode(root, cur, sym(AUTO_REPLACE[best.key], best.key));
  else applyInserter(root, cur, AUTO_STRUCT[best.key]);
}

/** `&` / Enter inside a grid: move to the next cell, growing the grid at the edge. */
export function gridNext(root: MRow, cur: MCursor, axis: 'col' | 'row'): boolean {
  for (let d = cur.path.length - 1; d >= 0; d--) {
    const node = rowAt(root, cur.path.slice(0, d))[cur.path[d].i] as MCmd;
    if (!def(node)?.grid || !node.cols) continue;
    const cols = node.cols;
    const s = cur.path[d].s;
    const rowN = Math.floor(s / cols), col = s % cols, rows = node.slots.length / cols;
    let target: number;
    if (axis === 'col') {
      if (col === cols - 1) {
        // add a column
        const ns: MRow[] = [];
        for (let rr = 0; rr < rows; rr++) ns.push(...node.slots.slice(rr * cols, rr * cols + cols), []);
        node.slots = ns;
        node.cols = cols + 1;
        target = rowN * (cols + 1) + col + 1;
      } else target = s + 1;
    } else {
      if (rowN === rows - 1) node.slots.push(...Array.from({ length: cols }, () => []));
      target = (rowN + 1) * cols;
    }
    cur.path = [...cur.path.slice(0, d), { i: cur.path[d].i, s: target }];
    cur.off = 0;
    return true;
  }
  return false;
}

/** All nodes in a row range, used for anchors. */
export function nodeIds(row: MRow, i: number, j: number) {
  return row.slice(i, j + 1).map((n) => n.id);
}
