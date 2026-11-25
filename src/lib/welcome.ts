// The welcome note: what notex does, most eye-catching first, as a note to play with.

import { withMarkdown } from './format';
import { isDesktop } from './files';
import { parseLatex } from './math/parse';
import { block, chars, math, uid, type Arrow, type Block, type BlockKind, type Doc, type Id, type Item, type Mark, type MarkKind, type MathItem, type MNode, type MRow } from './model';

/** A formula from LaTeX. */
const M = (tex: string, display = false) => math(parseLatex(tex).row, display);

/** A block of text and formulas. */
const T = (parts: (string | MathItem)[], kind: BlockKind = 'p', indent = 0): Block => {
  const b = block(parts.flatMap((p): Item[] => (typeof p === 'string' ? chars(p) : [p])), kind);
  if (indent) b.indent = indent;
  return b;
};
const P = (s: string, kind: BlockKind = 'p', indent = 0) => T([s], kind, indent);

/** The id of the `n`th node in a formula (depth first) that `hit` accepts. */
function node(m: MathItem, hit: (n: MNode) => boolean, n = 0): Id {
  const found: Id[] = [];
  const walk = (row: MRow) => {
    for (const x of row) {
      if (hit(x)) found.push(x.id);
      if (x.k === 'cmd') x.slots.forEach(walk);
    }
  };
  walk(m.root);
  if (!found[n]) throw new Error('welcome note: no such node');
  return found[n];
}
const symbol = (m: MathItem, v: string, n = 0) => node(m, (x) => x.k === 'sym' && x.v === v, n);
const command = (m: MathItem, name: string, n = 0) => node(m, (x) => x.k === 'cmd' && x.name === name, n);

/** The ids of the characters of `text` in a block (its `n`th occurrence). */
function word(b: Block, text: string, n = 0): Id[] {
  const s = b.items.map((i) => (i.t === 'c' ? i.ch : '￼')).join('');
  let at = -1;
  for (let k = 0; k <= n; k++) at = s.indexOf(text, at + 1);
  if (at < 0) throw new Error(`welcome note: no "${text}"`);
  return b.items.slice(at, at + text.length).map((i) => i.id);
}

const arrow = (from: Id[], to: Id[], o: Partial<Arrow> = {}): Arrow => ({ id: uid(), from, to, bend: 0.4, head: 'end', dash: false, boxed: false, label: '', ...o });
const mark = (kind: MarkKind, at: Id[], o: Partial<Mark> = {}): Mark => ({ id: uid(), kind, at, dash: false, label: '', ...o });

export function welcomeDoc(): Doc {
  const arrows: Arrow[] = [];
  const marks: Mark[] = [];

  // ── drawings ──
  const euler = M('e^{i\\pi}+1=0', true);
  const eulerIntro = P('Euler’s identity, where a turn round the circle meets arithmetic:');
  marks.push(mark('circle', [symbol(euler, 'e'), command(euler, 'sup')], { color: 'red' }));
  marks.push(mark('circle', [symbol(euler, '1')], { color: 'purple' }));
  marks.push(mark('circle', [symbol(euler, '0')], { color: 'green' }));
  arrows.push(arrow(word(eulerIntro, 'a turn round the circle'), [symbol(euler, 'e')], { bend: -0.3, dash: true, color: 'blue', label: 'half a turn' }));
  const eulerAfter = P('Each circle is drawn on part of the formula, and the arrow starts at words. Edit them and the drawings follow.');

  const density = M('f(x)=\\frac{1}{\\sqrt{2\\pi}}e^{-x^2/2}');
  const normal = T(['The standard normal density is ', density, ' and it is normalized:']);
  const total = M('\\int_{-\\infty}^{\\infty} f(x)\\,dx = 1', true);
  arrows.push(arrow([command(density, 'frac')], word(normal, 'normalized'), { bend: 0.45, dash: true, label: 'makes total mass 1' }));
  marks.push(mark('highlight', [command(density, 'sup')], { color: 'green' }));
  marks.push(mark('brace', [total.id], { color: 'blue', label: 'total probability' }));

  const quadratic = M('x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', true);
  const quadIntro = P('The roots of a quadratic, and what decides how many there are:');
  marks.push(mark('box', [command(quadratic, 'sqrt')], { dash: true, color: 'purple', label: 'the discriminant' }));
  marks.push(mark('underline', word(quadIntro, 'how many'), { color: 'purple' }));

  const square = M('(a+b)^2=a^2+b^2');
  const slip = T(['A classic slip: ', square, ' (the middle term is missing).']);
  const eq = square.root.findIndex((x) => x.k === 'sym' && x.v === '=');
  marks.push(mark('strike', square.root.slice(eq).map((x) => x.id), { color: 'red', label: '+2ab' }));

  const how = P('Hold Alt and drag from one thing to another to draw an arrow; Alt+Shift+drag draws a box. Click a drawing to change it: C colour, D dashes, L a note. Drawings stay on what they point at while you edit.');
  marks.push(mark('highlight', word(how, 'stay on what they point at'), { color: 'blue' }));

  // ── math ──
  const intro = P('Math notes at lecture speed. This note is yours to play with: click anywhere, type, draw. F1 lists every key.');

  const doc: Doc = {
    blocks: [
      P('notex', 'h1'),
      intro,
      P('Draw on your math', 'h2'),
      eulerIntro,
      T([euler]),
      eulerAfter,
      normal,
      T([total]),
      quadIntro,
      T([quadratic]),
      slip,
      how,

      P('Type math the way you say it', 'h2'),
      P('$ starts a formula and $$ a centred one; $, → or Esc goes back to text. While typing:'),
      T(['`a/b` gives ', M('\\frac{a}{b}'), ', `x^2` gives ', M('x^2'), ', `x_1` gives ', M('x_1'), ' and `e^(-x^2/2)` gives ', M('e^{-x^2/2}')], 'li'),
      T(['`\\int_0^1 f(x) dx` gives ', M('\\int_0^1 f(x)\\,dx'), ' and `\\sum_(n=1)^\\infty 1/n^2` gives ', M('\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}')], 'li'),
      T(['Any LaTeX command by name: `\\alpha` ', M('\\alpha'), ', `\\sqrt` ', M('\\sqrt{x}'), ', `\\in` ', M('\\in'), ', `\\to` ', M('\\to'), ', and `->` ', M('\\to'), ' or `<=` ', M('\\le'), ' as you type them'], 'li'),
      T(['Matrices: `\\pmatrix`, then & for a new column and Enter for a new row: ', M('\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}')], 'li'),
      P('Space or Tab moves on to the next box; brackets close themselves.', 'li'),
      P('In a sentence, typing x^2 or a_n turns into math by itself, with no $ needed.', 'li'),

      P('Write notes, not markup', 'h2'),
      P('Markdown works as in Obsidian: **bold**, *italic* and `code`, with Ctrl+B, Ctrl+I and Ctrl+E too. The markers hide once the caret moves on, and come back when it’s next to them.'),
      P('Type 1. to start a numbered list', 'ol'),
      P('Tab indents an item, Shift+Tab brings it back', 'ol'),
      P('like this', 'li', 1),
      P('and this', 'li', 2),
      P('- starts a bullet list, # a heading, ``` a code block:', 'ol'),
      { ...P('def mean(xs):', 'code'), lang: 'py' },
      P('    return sum(xs) / len(xs)', 'code'),

      P('Find your way around', 'h2'),
      P('\\ or Ctrl+K opens the command palette: every command, searchable.', 'li'),
      P('Ctrl+F finds text and math; Alt+↑ and Alt+↓ move a paragraph.', 'li'),
      P('Ctrl+D opens the draw menu. Paste or drop an image to put it in the note.', 'li'),

      P('Make it yours', 'h2'),
      P('Ctrl+, opens settings: themes (midnight, phosphor, paper), text size, page width, and which substitutions happen as you type.', 'li'),
      P('All of it is in a config file you can edit, with your own themes, snippets and CSS.', 'li'),

      P('Keep it and share it', 'h2'),
      ...(isDesktop()
        ? [P('Ctrl+S saves the note as a .ntx file; from then on it saves itself as you type.', 'li')]
        : [
            P('Every note is kept in this browser as you type; Ctrl+O lists them, Ctrl+N starts a new one.', 'li'),
            P('Ctrl+S also saves the note to a .ntx file, and keeps saving to it.', 'li'),
            P('Once opened, notex works offline, and the browser can install it as an app.', 'li'),
          ]),
      P('\\pdf saves it as a PDF, drawings and all, and Ctrl+P prints it.', 'li'),
      P('\\export copies it as LaTeX, drawings included.', 'li'),
      P('Press F1 for every shortcut, and type \\welcome to bring this note back.'),
    ],
    arrows,
    marks,
  };
  return withMarkdown(doc);
}
