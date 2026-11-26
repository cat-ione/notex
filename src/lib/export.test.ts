import { describe, expect, it } from 'vitest';
import { docToLatex } from './export';
import { structureTables } from './tables';
import { block, chars, cmd, math, sym, type Doc, type Mark } from './model';

const mark = (kind: Mark['kind'], at: string[], extra: Partial<Mark> = {}): Mark => ({ id: 'k' + kind, kind, at, dash: false, label: '', ...extra });

function sample() {
  const x = sym('x'), sq = cmd('sup', [[sym('2')]]), plus = sym('+'), one = sym('1');
  const m = math([x, sq, plus, one]);
  const b = block([...chars('so '), m, ...chars(' is big')]);
  const word = b.items.slice(-3).map((i) => i.id); // "big"
  const doc: Doc = { blocks: [b], arrows: [], marks: [] };
  return { doc, m, x, sq, plus, one, word };
}

describe('LaTeX export', () => {
  it('exports plain notes without a preamble note', () => {
    const { doc } = sample();
    expect(docToLatex(doc)).toBe('so $x^{2}+1$ is big\n');
  });

  it('wraps marked prose and math in place', () => {
    const { doc, x, sq, word } = sample();
    doc.marks.push(mark('box', [x.id, sq.id]), mark('underline', word));
    const tex = docToLatex(doc);
    expect(tex).toContain('$\\boxed{x^{2}}+1$');
    expect(tex).toContain('is \\underline{big}');
  });

  it('turns a brace into an underbrace with its note', () => {
    const { doc, m } = sample();
    doc.marks.push(mark('brace', [m.id], { label: 'the sum' }));
    expect(docToLatex(doc)).toContain('$\\underbrace{x^{2}+1}_{\\text{the sum}}$');
  });

  it('nests marks on overlapping-but-nested ranges, skips crossing ones', () => {
    const { doc, x, sq, plus, one } = sample();
    doc.marks.push(mark('box', [x.id, sq.id, plus.id, one.id]), mark('strike', [one.id]), mark('underline', [plus.id, one.id]));
    doc.marks.push(mark('highlight', [sq.id, plus.id]));
    const tex = docToLatex(doc);
    expect(tex).toContain('\\boxed{x^{2}\\underline{+\\cancel{1}}}');
    expect(tex).toContain('1 drawing(s) could not be exported');
  });

  it('draws arrows and circles with tikzmark nodes after the paragraph', () => {
    const { doc, x, word } = sample();
    doc.marks.push(mark('circle', word, { color: 'red', label: 'note' }));
    doc.arrows.push({ id: 'a', from: [x.id, doc.blocks[0].items[4].id].slice(0, 1), to: word, bend: 0.3, head: 'end', dash: true, boxed: false, label: '$f$' });
    const tex = docToLatex(doc);
    expect(tex).toContain('\\usetikzlibrary{tikzmark');
    expect(tex).toMatch(/\$\\tikzmarknode\{nx\d\}\{x\}\^\{2\}\+1\$/);
    expect(tex).toMatch(/is \\tikzmarknode\{nx\d\}\{big\}/);
    expect(tex).toContain('\\begin{tikzpicture}[remember picture, overlay]');
    expect(tex).toMatch(/\\node\[draw, ellipse, inner sep=1.5pt, red!80!black, label=\{\[font=\\scriptsize, red!80!black\]above:note\}, fit=\(nx\d\)\] \{\};/);
    expect(tex).toMatch(/\\draw\[->, dashed\] \(nx\d\) to\[bend left=31\] node\[midway, above, font=\\scriptsize\] \{\$f\$\} \(nx\d\);/);
  });

  it('shares one node when an arrow points at a circled range', () => {
    const { doc, x, word } = sample();
    doc.marks.push(mark('circle', word));
    doc.arrows.push({ id: 'a', from: [x.id], to: word, bend: 0, head: 'end', dash: false, boxed: false, label: '' });
    const tex = docToLatex(doc);
    expect(tex.match(/\\tikzmarknode/g)).toHaveLength(2);
    expect(tex).toMatch(/\(nx\d\) -- \(nx\d\)/);
  });
});

describe('lists', () => {
  it('nest itemize / enumerate by indent', () => {
    const li = (s: string, kind: 'li' | 'ol', indent = 0) => Object.assign(block(chars(s), kind), indent ? { indent } : {});
    const doc: Doc = { blocks: [li('a', 'ol'), li('b', 'ol', 1), li('c', 'li', 2), li('d', 'ol'), block(chars('end'))], arrows: [], marks: [] };
    expect(docToLatex(doc)).toBe(
      ['\\begin{enumerate}', '  \\item a', '  \\begin{enumerate}', '    \\item b', '    \\begin{itemize}', '      \\item c', '    \\end{itemize}', '  \\end{enumerate}', '  \\item d', '\\end{enumerate}', 'end', ''].join('\n'),
    );
  });
});

describe('bold and italic', () => {
  it('export as \\textbf / \\emph runs', () => {
    const items = chars('a bold, both and it');
    items.slice(2, 6).forEach((c) => c.t === 'c' && (c.b = true));
    items.slice(8, 12).forEach((c) => c.t === 'c' && ((c.b = true), (c.i = true)));
    items.slice(17).forEach((c) => c.t === 'c' && (c.i = true));
    expect(docToLatex({ blocks: [block(items)], arrows: [], marks: [] })).toBe('a \\textbf{bold}, \\textbf{\\emph{both}} and \\emph{it}\n');
  });
});

describe('code', () => {
  it('exports inline code as texttt and code blocks verbatim', () => {
    const p = block(chars('call f now'));
    p.items[5].t === 'c' && (p.items[5].c = true);
    const doc: Doc = { blocks: [p, block(chars('a = $1'), 'code'), block(chars('  b'), 'code')], arrows: [], marks: [] };
    expect(docToLatex(doc)).toBe(String.raw`call \texttt{f} now` + '\n\n' + String.raw`\begin{verbatim}` + '\na = $1\n  b\n' + String.raw`\end{verbatim}` + '\n');
  });
});

describe('images', () => {
  it('export as figures for files of their own', () => {
    const img = Object.assign(block(chars('Setup'), 'img'), { src: 'data:image/jpeg;base64,AAAA', w: 400 });
    const tex = docToLatex({ blocks: [img], arrows: [], marks: [] });
    expect(tex).toContain('includegraphics[width=300pt]{image1.jpg}');
    expect(tex).toContain('caption*{Setup}');
    expect(tex).toContain('usepackage{graphicx}');
  });
});

describe('tables', () => {
  const P = (s: string) => block(chars(s));
  it('a table becomes a tabular: columns aligned as the separator says, a rule under the header', () => {
    const doc: Doc = { blocks: structureTables([P('| x | f(x) | note |'), P('| :-- | :-: | --: |'), P('| 1 | 2 | small |'), P('| 3 | 4 | & big |'), P('after')]), arrows: [], marks: [] };
    const tex = docToLatex(doc);
    expect(tex).toContain(String.raw`\begin{tabular}{l c r}`);
    expect(tex).toContain(String.raw`  x & f(x) & note \\ \hline`);
    expect(tex).toContain(String.raw`  1 & 2 & small \\`);
    // a cell's text is escaped like any text
    expect(tex).toContain(String.raw`  3 & 4 & \& big \\`);
    expect(tex).toContain(String.raw`\end{tabular}`);
    expect(tex.indexOf(String.raw`\end{tabular}`)).toBeLessThan(tex.indexOf('after'));
    expect(tex).not.toContain('---');
  });

  it('formulas in cells stay formulas', () => {
    const doc: Doc = { blocks: structureTables([P('| n | a_n |'), P('| - | - |'), block([...chars('| 1 | '), math([sym('x')]), ...chars(' |')])]), arrows: [], marks: [] };
    expect(docToLatex(doc)).toContain(String.raw`  1 & $x$ \\`);
  });

  it('lines starting with | but no separator are not a table', () => {
    const tex = docToLatex({ blocks: [P('|x| is small')], arrows: [], marks: [] });
    expect(tex).not.toContain('tabular');
  });
});
