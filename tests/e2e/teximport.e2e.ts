// LaTeX files opened as notes: dropped on the page, or picked from the notes list. What's in
// them becomes the note's own structure (headings, boxes, numbered formulas, references).
import { test, expect, open, fresh, text, kinds, formulas, ed, saved } from './helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await open(page);
  await fresh(page);
});

const TEX = String.raw`\documentclass{article}
\usepackage{amsmath,amsthm}
\newtheorem{thm}{Theorem}
\title{Lecture 4}
\begin{document}
\maketitle
\section{Lagrange}
% a comment, left out
\begin{thm}[Lagrange]\label{thm:lagrange}
The order of a subgroup $H \le G$ divides $|G|$.
\end{thm}
\begin{equation}\label{eq:index}
|G| = [G:H]\,|H|
\end{equation}
By Theorem~\ref{thm:lagrange} and \eqref{eq:index}, \textbf{every} order divides.
\begin{itemize}
\item cosets
\item[$\square$] exercises
\end{itemize}
\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}
\end{document}
`;

async function drop(page: Page, name: string, content: string) {
  await page.evaluate(
    ([name, content]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'application/x-tex' }));
      document.querySelector('.scroller')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [name, content],
  );
}

test('a LaTeX file dropped on the page opens as a note: sections, theorems, numbered formulas and references', async ({ page }) => {
  await drop(page, 'lecture 4.tex', TEX);
  await expect.poll(() => ed(page, (e) => e.file.name)).toBe('lecture 4');
  expect(await kinds(page)).toEqual(['h1', 'h1', 'p', 'p', 'p', 'li', 'li']);
  expect((await text(page)).split('\n').slice(0, 3)).toEqual(['# Lecture 4', '# Lagrange', '(Lagrange) The order of a subgroup $H\\le G$ divides $|G|$.']);
  await expect(page.locator('.boxhead')).toHaveText(['Theorem 1.']);
  // the formula numbered, and the references showing what they point at
  expect(await formulas(page)).toContain('|G|=[G:H]\\,|H|');
  await expect(page.locator('.eqn')).toHaveText('(1)');
  const refs = await ed(page, (e) => e.doc.blocks[4].items.filter((i: any) => i.t === 'm' && i.root[0]?.ref).map((i: any) => i.root[0].v));
  expect(refs).toEqual(['Theorem 1', '(1)']);
  // bold read from the text, as typed markdown is
  await expect(page.locator('.ch.b').first()).toHaveCSS('font-weight', '700');
  // a box to tick, and what was left out said
  expect(await ed(page, (e) => e.doc.blocks[6].check)).toBe(false);
  await expect.poll(() => ed(page, (e) => e.message)).toContain('without its tikz pictures');
  // kept in the browser as a note of its own (not saved over the LaTeX)
  await saved(page);
  expect(await ed(page, (e) => e.files.savedWhere)).toBe('in this browser');
});
