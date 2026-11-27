import { describe, expect, it } from 'vitest';
import { latexToDoc } from './teximport';
import { docToLatex } from './export';
import { toLatex } from './math/latex';
import { isRefItem, type Doc, type MSym } from './model';

/** The note as lines: a block's kind, and its text with formulas as $…$ ($$…$$ for display, # for numbered). */
function lines(doc: Doc): string[] {
  return doc.blocks.map((b) => {
    const text = b.items
      .map((i) => {
        if (i.t === 'c') return i.ch;
        if (isRefItem(i)) return `[ref]`;
        return i.display ? `$$${toLatex(i.root)}$$${i.num ? '#' : ''}` : `$${toLatex(i.root)}$`;
      })
      .join('');
    // (a heading's or code's kind is read from its text by the editor: lists and tables are set here)
    const tags = [b.kind === 'li' || b.kind === 'ol' || b.kind === 'tr' ? b.kind : '', b.indent ? `+${b.indent}` : '', b.box ? `[${b.box.k}]` : '', b.check !== undefined ? (b.check ? '[x]' : '[ ]') : ''].join('');
    return tags ? `${tags} ${text}` : text;
  });
}

const doc = (body: string) => latexToDoc(`\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n${body}\n\\end{document}\n`);

describe('LaTeX import', () => {
  it('reads paragraphs, joining their lines; the preamble left out', () => {
    expect(lines(doc('First line\nsame paragraph.\n\nSecond paragraph.'))).toEqual(['First line same paragraph.', 'Second paragraph.']);
  });

  it('reads sections as headings, and the title where \\maketitle puts it', () => {
    const d = latexToDoc('\\title{Group theory}\n\\begin{document}\n\\maketitle\n\\section{Groups}\ntext\n\\subsection*{Subgroups}\n\\subsubsection{Cosets}\n\\end{document}');
    expect(lines(d)).toEqual(['# Group theory', '# Groups', 'text', '## Subgroups', '### Cosets']);
  });

  it('reads inline and display math', () => {
    expect(lines(doc('Let $x^2 = \\frac{a}{b}$ and \\(y\\).\n\\[ \\int_0^1 f \\]\nthen $$a+b$$'))).toEqual([
      'Let $x^{2}=\\frac{a}{b}$ and $y$.',
      '$$\\int _{0}^{1}f$$',
      'then',
      '$$a+b$$',
    ]);
  });

  it('numbers equation environments, not starred ones; align as aligned', () => {
    const d = doc('\\begin{equation} E = mc^2 \\end{equation}\n\\begin{equation*} a \\end{equation*}\n\\begin{align} a &= b \\\\ c &= d \\end{align}');
    expect(lines(d)).toEqual(['$$E=mc^{2}$$#', '$$a$$', '$$\\begin{aligned}a & =b \\\\ c & =d\\end{aligned}$$#']);
  });

  it('reads bold, italic, code and links as markdown', () => {
    const d = doc('\\textbf{bold} and \\emph{this} and \\texttt{code} at \\href{https://a.b}{a site} or \\url{https://c.d}');
    expect(lines(d)).toEqual(['**bold** and *this* and `code` at [a site](https://a.b) or https://c.d']);
  });

  it('reads lists, nested, numbered and with boxes to tick', () => {
    const d = doc('\\begin{itemize}\n\\item one\n\\begin{enumerate}\\item inner\\end{enumerate}\n\\item[$\\square$] todo\n\\item[$\\boxtimes$] done\n\\end{itemize}');
    expect(lines(d)).toEqual(['li one', 'ol+1 inner', 'li[ ] todo', 'li[x] done']);
  });

  it('reads theorems, proofs and quotes as boxes, a theorem with its name', () => {
    const d = doc('\\begin{theorem}[Lagrange]\nThe order divides.\n\\end{theorem}\n\\begin{proof}\nCount cosets.\n\nDone.\n\\end{proof}\n\\begin{quote}Said.\\end{quote}');
    expect(lines(d)).toEqual(['[theorem] (Lagrange) The order divides.', '[proof] Count cosets.', '[proof] Done.', '[quote] Said.']);
  });

  it("knows the file's own theorem environments by what they print", () => {
    const d = latexToDoc('\\newtheorem{lem}[thm]{Lemma}\n\\newtheorem*{obs}{Observation}\n\\begin{document}\n\\begin{lem}A\\end{lem}\n\\begin{obs}B\\end{obs}\n\\end{document}');
    expect(lines(d)).toEqual(['[lemma] A', '[remark] B']);
  });

  it('makes references of \\ref and \\eqref to numbered formulas and theorems', () => {
    const d = doc('\\begin{theorem}\\label{thm:main} Big. \\end{theorem}\n\\begin{equation}\\label{eq:e} x \\end{equation}\nBy Theorem~\\ref{thm:main} and \\eqref{eq:e}, also Equation~\\ref{eq:e} and \\ref{nowhere}.');
    expect(lines(d)).toEqual(['[theorem] Big.', '$$x$$#', 'By [ref] and [ref], also Equation [ref] and ??.']);
    const refs = d.blocks[2].items.filter(isRefItem).map((i) => (i.root[0] as MSym).ref);
    expect(refs).toEqual([d.blocks[0].box!.id, d.blocks[1].items[0].id, d.blocks[1].items[0].id]);
    // (each showing what it points at)
    expect(d.blocks[2].items.filter(isRefItem).map((i) => (i.root[0] as MSym).v)).toEqual(['Theorem 1', '(1)', '(1)']);
  });

  it('keeps escaped characters as themselves, not markdown or math', () => {
    expect(lines(doc('costs \\$5 \\& 10\\% of a\\_b, \\#1 \\{x\\}'))).toEqual(['costs $5 & 10% of a_b, #1 {x}']);
  });

  it('reads accents, dashes, quotes and ties', () => {
    expect(lines(doc("G\\\"odel and Poincar\\'e, pp.~1--2 --- ``so'' \\ldots"))).toEqual(['Gödel and Poincaré, pp. 1–2 — “so” …']);
  });

  it('leaves out comments, but not \\%', () => {
    expect(lines(doc('kept % not kept\n50\\% kept'))).toEqual(['kept 50% kept']);
  });

  it('reads a tabular as a table', () => {
    const d = doc('\\begin{tabular}{l|c}\n\\hline\na & $b$ \\\\ \\hline\nc & d \\\\\n\\end{tabular}');
    expect(lines(d)).toEqual(['tr |a|$b$|', 'tr |c|d|']);
    expect(d.blocks[0].aligns).toEqual([null, 'center']);
  });

  it('reads verbatim and listings as code', () => {
    const d = doc('\\begin{lstlisting}[language=Python]\nx = 1 % 2\n\\end{lstlisting}');
    expect(lines(d)).toEqual(['```python', 'x = 1 % 2', '```']);
  });

  it('keeps the text of commands it does not know, and leaves out layout', () => {
    expect(lines(doc('\\noindent\\vspace{1em}A \\mycmd{word} and \\textcolor{red}{red}\\footnote{note}.'))).toEqual(['A word and redred (note).']);
  });

  it('says what it left out', () => {
    const d = doc('\\begin{figure}\\includegraphics{a.png}\\caption{A picture}\\end{figure}\n\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}');
    expect(lines(d)).toEqual(['*A picture*']);
    expect(d.dropped).toEqual(['images', 'tikz pictures']);
  });

  it('reads a matrix in inline math as part of the formula', () => {
    expect(lines(doc('so $A = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}$ here'))).toEqual(['so $A=\\begin{pmatrix}1 & 0 \\\\ 0 & 1\\end{pmatrix}$ here']);
  });

  it("reads back notex's own LaTeX export", () => {
    const first = doc('\\section*{Notes}\n\\begin{theorem}[Fermat]\\label{t} $a^p \\equiv a$ \\end{theorem}\n\\begin{equation}\\label{e} x = 1 \\end{equation}\nSee Theorem~\\ref{t} and \\eqref{e}.');
    const again = latexToDoc(docToLatex(first));
    expect(lines(again)).toEqual(lines(first));
  });
});
