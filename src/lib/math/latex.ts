// Math tree -> LaTeX.
//
// With `anchors` on, every node is wrapped in \htmlData{nx=<id>} so the DOM
// that KaTeX produces can be mapped back to nodes (for the caret, hints and
// arrow endpoints). KaTeX treats these wrappers as transparent for spacing.

import type { MCmd, MNode, MRow } from '../model';
import { BIG_OPS, CMDS } from './defs';

export type Step = { i: number; s: number };
export type MCursor = { path: Step[]; off: number };

/** A selected range [s, e) of the row at `path` (aligned to base+script groups). */
export type MSelRange = { path: Step[]; s: number; e: number };

/** Extra LaTeX to emit right before / after particular nodes (used by export to wrap drawn-on ranges). */
export type Wraps = { before: Map<string, string>; after: Map<string, string> };

type Opts = { anchors: boolean; cursor: MCursor | null; sel: MSelRange | null; wraps?: Wraps };

const SEL_OPEN = '\\htmlClass{nx-sel}{';
const CARET = '\\htmlClass{nx-caret}{}';
const CARET_PRE_SCRIPT = '\\htmlClass{nx-caret nx-caret-script}{}';
const EMPTY = '\\htmlClass{nx-empty}{\\square}';

const TEXT_ESC: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};

export function toLatex(root: MRow, anchors = false, cursor: MCursor | null = null, sel: MSelRange | null = null): string {
  return row(root, [], { anchors, cursor, sel }, false);
}

/** Plain LaTeX with `wraps` inserted around the given nodes. */
export function toLatexWrapped(root: MRow, wraps: Wraps): string {
  return row(root, [], { anchors: false, cursor: null, sel: null, wraps }, false);
}

const pathEq = (a: Step[], b: Step[]) => a.length === b.length && a.every((x, i) => x.i === b[i].i && x.s === b[i].s);

const isScript = (n: MNode | undefined) => n?.k === 'cmd' && !!CMDS[n.name]?.script;

/** Characters that would break the surrounding LaTeX if emitted raw. */
const MATH_ESC: Record<string, string> = {
  '{': '\\{', '}': '\\}', '#': '\\#', '%': '\\%', '&': '\\&', $: '\\$', _: '\\_', '^': '\\hat{}', '\\': '\\backslash ', '~': '\\sim ',
};

function symLatex(v: string) {
  if (MATH_ESC[v]) return MATH_ESC[v];
  // Separate control words from following letters: `\alpha x`.
  return /\\[a-zA-Z]+$/.test(v) ? v + ' ' : v;
}

function row(r: MRow, path: Step[], o: Opts, text: boolean): string {
  const hasCaret = !!o.cursor && pathEq(o.cursor.path, path);
  const off = hasCaret ? o.cursor!.off : -1;
  const sel = o.anchors && o.sel && pathEq(o.sel.path, path) ? o.sel : null;

  if (r.length === 0) {
    if (!o.anchors) return '';
    const body = (hasCaret ? CARET : '') + (text ? '\\square' : EMPTY);
    return hasCaret && path.length ? `\\htmlClass{nx-active-row}{${body}}` : body;
  }

  let out = '';
  let i = 0;
  while (i < r.length) {
    const n = r[i];
    if (sel && i === sel.e) out += '}';
    if (sel && i === sel.s) out += SEL_OPEN;
    // A caret right before a script would steal the script from its base, so
    // emit it after the script and let the overlay position it at the script.
    if (i === off) out += isScript(n) && i > 0 ? '' : CARET;
    out += o.wraps?.before.get(n.id) ?? '';

    if (n.k === 'sym' && BIG_OPS.has(n.v) && o.anchors && !text) {
      // Keep big operators and their limits in one group so limits stay attached.
      // A caret among the limits goes after them (anything between the operator and
      // its limits would take the limits from it); the overlay puts it in place.
      let j = i + 1;
      let inner = symLatex(n.v);
      let caret = false;
      while (j < r.length && isScript(r[j])) {
        if (j === off) caret = true;
        inner += cmdLatex(r[j] as MCmd, path, j, o, false);
        j++;
      }
      out += `\\htmlData{nx=${n.id}}{${inner}}` + (caret ? CARET_PRE_SCRIPT : '');
      i = j;
      continue;
    }

    if (isScript(n)) {
      const prev = r[i - 1];
      const needBase = i === 0 || isScript(prev);
      out += (needBase ? '{}' : '') + cmdLatex(n as MCmd, path, i, o, false);
      if (i === off && i > 0) out += CARET_PRE_SCRIPT;
    } else if (n.k === 'sym') {
      const v = text ? (TEXT_ESC[n.v] ?? n.v) : symLatex(n.v);
      out += o.anchors ? `\\htmlData{nx=${n.id}}{${v}}` : v;
    } else {
      const l = cmdLatex(n, path, i, o, text);
      out += o.anchors ? `\\htmlData{nx=${n.id}}{${l}}` : l;
    }
    out += o.wraps?.after.get(n.id) ?? '';
    i++;
  }
  if (off === r.length) out += CARET;
  if (sel && sel.e === r.length) out += '}';

  return hasCaret && path.length && o.anchors ? `\\htmlClass{nx-active-row}{${out}}` : out;
}

function cmdLatex(n: MCmd, path: Step[], i: number, o: Opts, inText: boolean): string {
  const def = CMDS[n.name];
  if (!def) return `\\text{?${n.name}}`;
  const slots = n.slots.map((sl, s) => {
    const r = row(sl, [...path, { i, s }], o, !!def.text);
    // Scripts have no wrapper of their own (they need a base), so the slot carries the anchor.
    return def.script && o.anchors ? `\\htmlData{nx=${n.id}}{${r}}` : r;
  });
  if (def.text && n.slots[0].length === 0 && o.anchors && !inText) {
    const hasCaret = !!o.cursor && pathEq(o.cursor.path, [...path, { i, s: 0 }]);
    return (hasCaret ? CARET : '') + EMPTY;
  }
  const tall = n.slots.some((sl) => sl.some((x) => x.k === 'cmd' && !CMDS[x.name]?.text));
  return def.latex(slots, n.cols, tall);
}
