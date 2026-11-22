// Structural editing of a math tree with a cursor.
//
// A cursor is a path of (node index, slot index) steps from the root row down
// to the row being edited, plus an offset within that row. All operations
// mutate the tree and cursor in place and return whether they did anything;
// returning false at the root boundary lets the caller exit the math item.

import { cmd, sym, type MCmd, type MNode, type MRow } from '../model';
import { CMDS, MATH_PALETTE, OPENERS, SUB_DEFAULTS, SUB_GROUPS, TAKES_ARG, type Inserter } from './defs';
import type { MCursor, Step } from './latex';
import { caretFor, parseLatex, type Parsed } from './parse';

const PRIME = '\\prime';

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

const isScriptNode = (n: MNode | undefined) => n?.k === 'cmd' && !!CMDS[n.name]?.script;
const isPrime = (n: MNode | undefined) => n?.k === 'sym' && (n.v === "'" || n.v === PRIME);
/** Scripts and primes belong to the node before them (their base). */
export const isAttached = (n: MNode | undefined) => isScriptNode(n) || isPrime(n);

/**
 * Whether the caret may stop at `off` in `row`. Not between a base and its scripts or
 * primes (nor between two of them): typing there would take them from their base, so
 * arrowing, clicking and selecting skip those places.
 */
export const isStop = (row: MRow, off: number) => !(off > 0 && isAttached(row[off]));

/** The first offset at or after `off` that is a stop: past the scripts. */
const pastScripts = (row: MRow, off: number) => {
  while (!isStop(row, off)) off++;
  return off;
};

/**
 * Move the caret off a non-stop: forward into the script (past a prime), or back to
 * before the base.
 */
export function toStop(root: MRow, cur: MCursor, dir: 1 | -1) {
  for (let row = rowAt(root, cur.path); !isStop(row, cur.off); row = rowAt(root, cur.path)) {
    if (dir < 0) moveLeft(root, cur);
    else if (isPrime(row[cur.off])) cur.off++;
    else enter(cur, cur.off, 0, false, root);
  }
}

export function enter(cur: MCursor, i: number, s: number, atEnd: boolean, root: MRow) {
  cur.path.push({ i, s });
  cur.off = atEnd ? rowAt(root, cur.path).length : 0;
}

export function exitAfter(root: MRow, cur: MCursor): boolean {
  const st = cur.path.pop();
  if (!st) return false;
  // leaving a base: past its scripts too
  cur.off = pastScripts(rowAt(root, cur.path), st.i + 1);
  return true;
}

export function moveRight(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off < r.length) {
    const n = r[cur.off];
    if (hasSlots(n)) enter(cur, cur.off, 0, false, root);
    else cur.off++;
    // past a base: straight into its first script
    toStop(root, cur, 1);
    return true;
  }
  const p = parentOf(root, cur);
  if (!p) return false;
  if (def(p.node)?.linear && p.step.s < p.node.slots.length - 1) {
    p.step.s++;
    cur.off = 0;
  } else {
    // out of a node; out of a script into the next script of the same base
    cur.path.pop();
    cur.off = p.step.i + 1;
    toStop(root, cur, 1);
  }
  return true;
}

/**
 * Ctrl+→ / Ctrl+←: by a whole piece of the row: a run of letters or digits (with their
 * scripts), or one symbol or structure (a fraction, a root… as a whole, not into it). At
 * the end of a box, out of it. False at the edge of the formula (the caret leaves it).
 */
export function wordMove(root: MRow, cur: MCursor, dir: 1 | -1): boolean {
  const r = rowAt(root, cur.path);
  const alnum = (n: MNode | undefined) => n?.k === 'sym' && /^[A-Za-z0-9.]$/.test(n.v);
  // the base of the group ending at j (a script or prime belongs to the node before it)
  const base = (j: number) => {
    while (j > 0 && isAttached(r[j])) j--;
    return j;
  };
  if (dir > 0) {
    if (cur.off >= r.length) return exitAfter(root, cur);
    let i = cur.off;
    if (alnum(r[i])) while (i < r.length && alnum(r[i])) i = pastScripts(r, i + 1);
    else i = pastScripts(r, i + 1);
    cur.off = i;
    return true;
  }
  if (cur.off === 0) {
    const st = cur.path.pop();
    if (!st) return false;
    // out of the box, to before it (and before its base, if the box is a script)
    const row = rowAt(root, cur.path);
    cur.off = st.i;
    while (cur.off > 0 && isAttached(row[cur.off])) cur.off--;
    return true;
  }
  let i = base(cur.off - 1);
  if (alnum(r[i])) while (i > 0 && alnum(r[base(i - 1)])) i = base(i - 1);
  cur.off = i;
  return true;
}

export function moveLeft(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  if (cur.off > 0) {
    const n = r[cur.off - 1];
    if (hasSlots(n)) {
      const s = def(n)?.linear ? n.slots.length - 1 : 0;
      enter(cur, cur.off - 1, s, true, root);
    } else {
      cur.off--;
      toStop(root, cur, -1); // over a prime: on to before its base
    }
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
    // out of a script: on to before its base (or into the previous script)
    toStop(root, cur, -1);
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
    toStop(root, cur, -1);
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

// ── selection ranges (within the caret's row) ──

/** Widen [s, e) so it never separates a base from its scripts. */
export function alignRange(row: MRow, s: number, e: number): [number, number] {
  while (s > 0 && isAttached(row[s])) s--;
  while (e < row.length && isAttached(row[e])) e++;
  return [s, e];
}

/** Remove [s, e) from the caret's row and leave the caret where it was. */
export function takeRange(root: MRow, cur: MCursor, s: number, e: number): MRow {
  const nodes = rowAt(root, cur.path).splice(s, e - s);
  cur.off = s;
  return nodes;
}

/**
 * Put [s, e) inside a new structure's `slot`, then move the caret to the
 * structure's first other empty slot, or after it.
 */
export function wrapRange(root: MRow, cur: MCursor, s: number, e: number, node: MCmd, slot = 0) {
  let nodes = takeRange(root, cur, s, e);
  // (a+b) selected and wrapped in a fraction: drop the now-redundant parens
  if (node.name === 'frac' && nodes.length === 1 && nodes[0].k === 'cmd' && nodes[0].name === 'paren') nodes = nodes[0].slots[0];
  node.slots[slot] = nodes;
  rowAt(root, cur.path).splice(s, 0, node);
  const empty = node.slots.findIndex((sl, i) => i !== slot && !sl.length);
  if (empty >= 0) enter(cur, s, empty, false, root);
  else cur.off = s + 1;
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
    // a base with scripts or primes: deleting it alone would hand them to whatever is
    // before it. Go into its scripts (as into a structure); primes go with the base.
    if (cur.off > 0 && isAttached(r[cur.off + 1])) {
      let j = cur.off + 1;
      while (isPrime(r[j])) j++;
      if (isScriptNode(r[j])) {
        enter(cur, j, 0, false, root);
        return true;
      }
      r.splice(cur.off, j - cur.off);
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
  // a name that takes what follows comes along with it (del vec B / del t)
  while (start > 0 && start < cur.off && takesArg(r[start - 1])) start--;
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
  // in an empty limit already (∑ from the palette): `_` stays in the lower one, `^` goes up
  const here = parentOf(root, cur);
  if (here && !r.length && here.node.name === 'subsup') {
    cur.path[cur.path.length - 1] = { ...here.step, s: kind === 'sub' ? 0 : 1 };
    cur.off = rowAt(root, cur.path).length;
    return;
  }
  if (here && !r.length && here.node.name === kind) return;
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

/**
 * LaTeX-style scripts: `^` / `_` take one thing (a number, a letter, a symbol, a sign and
 * one of those, or a group typed as `(…)` / `{…}` whose brackets don't show) and the
 * line carries on after it, so `x^2+1` and `a_0^2/2` come out as written.
 */
let latexScripts = true;
export function setLatexScripts(on: boolean) {
  latexScripts = on;
  buildSubs();
}

/** The substitutions on now: the groups switched on (big operators as LaTeX-style scripts want them). */
let subs: Record<string, string | Inserter | { template: string }> = {};
let groupsOn: Record<string, boolean> = { ...SUB_DEFAULTS };
function buildSubs() {
  subs = {};
  for (const g of SUB_GROUPS)
    if (groupsOn[g.id])
      for (const [k, v] of Object.entries(g.subs))
        subs[k] = g.id === 'operators' && !latexScripts ? MATH_PALETTE[k] : g.template ? { template: v as string } : v;
}
buildSubs();
export function setSubstitutions(on: Record<string, boolean>) {
  groupsOn = { ...SUB_DEFAULTS, ...on };
  buildSubs();
}
/** Would typing `w` in math turn into something (a substitution on now, or the user's own)? */
export const isSubstitution = (w: string) => subs[w] !== undefined || userSnippets[w] !== undefined;

/** A name that takes what follows (sin x, del f), typed or from `\`. */
const takesArg = (n: MNode | undefined) => n?.k === 'sym' && TAKES_ARG.has(n.src ?? n.v.replace(/^\\/, ''));

const samePath = (a: Step[], b: Step[]) => a.length === b.length && a.every((x, i) => x.i === b[i].i && x.s === b[i].s);
const startsWith = (p: Step[], pre: Step[]) => pre.length <= p.length && pre.every((x, i) => x.i === p[i].i && x.s === p[i].s);

/** Does typing `c` continue the one thing in a LaTeX-style script slot? (`sub`: a subscript) */
function continues(slot: MRow, c: string, sub = false): boolean {
  const pieces = slot.map((n) => (n.k === 'sym' ? (n.src ?? n.v) : null));
  if (pieces.some((p) => p === null)) return false; // a structure is one thing
  const body = pieces.join('').replace(/^[-+]/, '');
  if (!body) return true; // only a sign so far
  if (/^[0-9.]+$/.test(body)) return /[0-9.]/.test(c);
  // letters: only while they could still become a symbol (`alpha`, `infty`, a snippet)
  if (/^[a-zA-Z]+$/.test(body) && /^[a-zA-Z]$/.test(c)) {
    // a subscript's letters are an index: a_ij
    if (sub && body.length < 3) return true;
    const w = body + c;
    return [subs, userSnippets].some((t) => Object.keys(t).some((k) => k.startsWith(w)));
  }
  return false;
}

/**
 * Before typing `c`: leave LaTeX-style script slots it doesn't continue (innermost first).
 * Returns true when `c` was used up: the `(` that opens a group, the `)` that closes one.
 */
export function settleAuto(root: MRow, cur: MCursor, c: string): boolean {
  const stack = cur.auto;
  if (!stack) return false;
  // slots the caret has left
  while (stack.length && !startsWith(cur.path, stack[stack.length - 1].path)) stack.pop();
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!samePath(top.path, cur.path)) {
      // deeper inside the slot: only the group's closing bracket reaches out (through a
      // fraction, a script…, as a real bracket would; not out of another bracket)
      if (!top.grouped || (c !== ')' && c !== '}')) break;
      let d = top.path.length;
      for (; d < cur.path.length; d++) if (def(rowAt(root, cur.path.slice(0, d))[cur.path[d].i] as MCmd)?.close) break;
      if (d < cur.path.length) break;
      cur.path = top.path.map((s) => ({ ...s }));
      exitAfter(root, cur);
      stack.pop();
      if (!stack.length) cur.auto = undefined;
      return true;
    }
    const slot = rowAt(root, cur.path);
    if (top.grouped) {
      if (c !== ')' && c !== '}') break;
      exitAfter(root, cur);
      stack.pop();
      return true;
    }
    if (!slot.length && (c === '(' || c === '{')) {
      top.grouped = true;
      return true;
    }
    const p = parentOf(root, cur);
    const sub = !!p && (p.node.name === 'sub' || (p.node.name === 'subsup' && p.step.s === 0));
    if (!slot.length || continues(slot, c, sub)) break;
    exitAfter(root, cur);
    stack.pop();
  }
  if (!stack.length) cur.auto = undefined;
  return false;
}

/** Space: leave the box you're in, but not brackets (spaces there mean nothing) or a `^(…)` group. */
export function space(root: MRow, cur: MCursor): boolean {
  const r = rowAt(root, cur.path);
  // staying put: the space still ends a word (`x in` is not ξ n)
  const stay = () => ((cur.brk = r[cur.off - 1]?.id ?? null), true);
  const top = cur.auto?.[cur.auto.length - 1];
  if (top?.grouped && samePath(top.path, cur.path)) return stay();
  const p = parentOf(root, cur);
  if (p && def(p.node)?.close) return stay();
  // an empty box (a denominator, a root, an accent) isn't left by a space: `x / y`, `sqrt 2`
  // (an empty limit or script is: that's how one is skipped)
  if (p && !r.length && !def(p.node)?.script) return true;
  if (!p) return stay(), false;
  // after a name that takes what follows (1/sin x, del f / del x): between words
  const prev = r[cur.off - 1];
  if (!def(p.node)?.script && takesArg(prev)) return stay();
  return exitAfter(root, cur);
}

/** Structures whose empty box takes `(…)` as a group, brackets not shown: sqrt(x+1), 1/(2pi). */
const GROUPING = new Set(['frac', 'sqrt', 'root', 'vec', 'hat', 'bar', 'tilde', 'dot', 'ddot', 'cancel']);

/** Type a character, applying structure keys and auto-replacements. */
export function typeChar(root: MRow, cur: MCursor, c: string) {
  if (isText(root, cur)) {
    if (c === '"') exitAfter(root, cur);
    else insertNode(root, cur, sym(c));
    return;
  }
  if (latexScripts && settleAuto(root, cur, c)) return;
  if (latexScripts && (c === '(' || c === '{')) {
    const p = parentOf(root, cur);
    if (p && GROUPING.has(p.node.name) && !rowAt(root, cur.path).length && !cur.auto?.some((a) => samePath(a.path, cur.path))) {
      cur.auto ??= [];
      cur.auto.push({ path: cur.path.map((s) => ({ ...s })), grouped: true });
      return;
    }
  }
  if (c === '/') return fraction(root, cur);
  if (c === '^' || c === '_') {
    script(root, cur, c === '^' ? 'sup' : 'sub');
    const p = parentOf(root, cur);
    if (latexScripts && p && def(p.node)?.script) {
      // (assigned first, then pushed: in the editor `cur` is a state proxy, and pushing onto
      // the value of `??=` would push onto the plain array, not the one stored)
      cur.auto ??= [];
      cur.auto.push({ path: cur.path.map((s) => ({ ...s })), grouped: false });
    }
    return;
  }
  if (c === '"') return insertNode(root, cur, cmd('text', [[]]), 0);
  if (OPENERS[c]) return insertNode(root, cur, cmd(OPENERS[c], [[]]), 0);
  if (c === '\'') return insertNode(root, cur, sym("'"));

  // Closing a delimiter we are inside of jumps out of it.
  for (let d = cur.path.length - 1; d >= 0; d--) {
    const n = rowAt(root, cur.path.slice(0, d))[cur.path[d].i] as MCmd;
    if (def(n)?.close === c) {
      const i = cur.path[d].i;
      cur.path = cur.path.slice(0, d);
      cur.off = pastScripts(rowAt(root, cur.path), i + 1);
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
    if (n.k !== 'sym' || (cur.brk && n.id === cur.brk)) break;
    const piece = n.src ?? (n.v.startsWith('\\') && n.v.length > 1 ? null : n.v);
    if (piece == null) break;
    s = piece + s;
    if (userSnippets[s] !== undefined || subs[s] !== undefined) best = { k, key: s };
  }
  if (!best) return;
  r.splice(cur.off - best.k, best.k);
  cur.off -= best.k;
  const v = subs[best.key];
  const template = userSnippets[best.key] ?? (typeof v === 'object' && 'template' in v ? v.template : undefined);
  if (template !== undefined) {
    const parsed = parseLatex(template);
    // A single symbol keeps its trigger so backspace / longer triggers still work.
    if (parsed.row.length === 1 && parsed.row[0].k === 'sym' && !parsed.cursor) insertNode(root, cur, sym(parsed.row[0].v, best.key));
    else insertParsed(root, cur, parsed);
  } else if (typeof v === 'string') insertNode(root, cur, sym(v, best.key));
  else applyInserter(root, cur, v as Inserter);
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
