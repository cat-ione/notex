// Layout test scenarios. Targets: {f, i, j, path} = nodes i..j of formula f (path into slots), or {words:[a,b]}.
const INT = String.raw`\int_0^1 f(x)\,dx`;           // 0:int 1:subsup 2:f 3:paren 4:\, 5:d 6:x
const SUM = String.raw`\sum_{i=1}^{n} a_i b_i = S_n`; // 0:sum 1:subsup 2:a 3:sub 4:b 5:sub 6:= 7:S 8:sub
const FRAC = String.raw`\frac{a+b}{c+d} = \frac{x}{y}`; // 0:frac 1:= 2:frac
const RUN = String.raw`a+b+c+d+e+f`;                 // even = letters
const MAT = String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{pmatrix} x \\ y \end{pmatrix} = \lambda v`; // 0 1 2:= 3:lambda 4:v
const ROOT = String.raw`\sqrt{\frac{1}{2\pi}}\, e^{-x^2/2}`; // 0:sqrt 1:\, 2:e 3:sup
const LIM = String.raw`\lim_{h\to 0} \frac{f(x+h)-f(x)}{h}`; // 0:lim 1:sub 2:frac
const EMC = String.raw`E = mc^2`;                    // 0:E 1:= 2:m 3:c 4:sup

const S = 'n', M = 'the integrand', L = 'this term is always positive', XL = 'by the dominated convergence theorem applied twice';
const FR = String.raw`$\frac{1}{2}$ of it`;
const D = (tex) => ({ tex, display: true });

export const scenarios = [
  // ── two neighbours under a display formula ──
  { title: 'int: f(x) + dx, medium + short', parts: [D(INT)], marks: [
    { kind: 'brace', at: { f: 0, i: 2, j: 3 }, label: M }, { kind: 'brace', at: { f: 0, i: 5, j: 6 }, label: 'w.r.t. x' } ] },
  { title: 'int: f(x) + dx, long + long', parts: [D(INT)], marks: [
    { kind: 'brace', at: { f: 0, i: 2, j: 3 }, label: L }, { kind: 'brace', at: { f: 0, i: 5, j: 6 }, label: 'integrate with respect to x' } ] },
  { title: 'int: limits + integrand + dx', parts: [D(INT)], marks: [
    { kind: 'brace', at: { f: 0, i: 0, j: 1 }, label: 'over [0,1]' }, { kind: 'brace', at: { f: 0, i: 2, j: 3 }, label: M }, { kind: 'brace', at: { f: 0, i: 5, j: 6 }, label: 'w.r.t. x' } ] },
  { title: 'int: single note under f, long', parts: [D(INT)], marks: [
    { kind: 'brace', at: { f: 0, i: 2 }, label: XL } ] },

  // ── sums, scripts ──
  { title: 'sum: four notes', parts: [D(SUM)], marks: [
    { kind: 'brace', at: { f: 0, i: 0, j: 1 }, label: 'over all i' }, { kind: 'brace', at: { f: 0, i: 2, j: 3 }, label: 'weights' },
    { kind: 'brace', at: { f: 0, i: 4, j: 5 }, label: 'values' }, { kind: 'brace', at: { f: 0, i: 7, j: 8 }, label: 'partial sum' } ] },
  { title: 'sum: circles with notes above', parts: [D(SUM)], marks: [
    { kind: 'circle', at: { f: 0, i: 2, j: 3 }, label: 'weight' }, { kind: 'circle', at: { f: 0, i: 4, j: 5 }, label: 'value' }, { kind: 'circle', at: { f: 0, i: 7, j: 8 }, label: S } ] },

  // ── fractions: nested targets ──
  { title: 'frac: numerator and denominator parts', parts: [D(FRAC)], marks: [
    { kind: 'box', at: { f: 0, i: 0, j: 2, path: [[0, 0]] }, label: 'numerator' }, { kind: 'brace', at: { f: 0, i: 0, j: 2, path: [[0, 1]] }, label: 'denominator' },
    { kind: 'brace', at: { f: 0, i: 2 }, label: 'ratio' } ] },
  { title: 'lim: difference quotient pieces', parts: [D(LIM)], marks: [
    { kind: 'brace', at: { f: 0, i: 0, j: 1 }, label: 'as h shrinks' }, { kind: 'box', at: { f: 0, i: 0, j: 1, path: [[2, 0]] }, label: 'shifted' },
    { kind: 'box', at: { f: 0, i: 3, j: 4, path: [[2, 0]] }, label: 'original' } ] },

  // ── many narrow neighbours ──
  { title: 'run: six letters, short notes', parts: [D(RUN)], marks: [0, 2, 4, 6, 8, 10].map((i, k) => ({ kind: 'brace', at: { f: 0, i }, label: ['one', 'two', 'three', 'four', 'five', 'six'][k] })) },
  { title: 'run: six letters, medium notes', parts: [D(RUN)], marks: [0, 2, 4, 6, 8, 10].map((i, k) => ({ kind: 'brace', at: { f: 0, i }, label: `term number ${k + 1}` })) },
  { title: 'run: three adjacent, mixed lengths', parts: [D(RUN)], marks: [
    { kind: 'brace', at: { f: 0, i: 4 }, label: S }, { kind: 'brace', at: { f: 0, i: 6 }, label: L }, { kind: 'brace', at: { f: 0, i: 8 }, label: 'k' } ] },
  { title: 'emc: tiny formula, long notes', parts: [D(EMC)], marks: [
    { kind: 'brace', at: { f: 0, i: 0 }, label: 'energy of the body at rest' }, { kind: 'brace', at: { f: 0, i: 2 }, label: 'rest mass' }, { kind: 'brace', at: { f: 0, i: 3, j: 4 }, label: 'speed of light squared' } ] },

  // ── tall things, both sides ──
  { title: 'matrix: notes above and below', parts: [D(MAT)], marks: [
    { kind: 'box', at: { f: 0, i: 0 }, label: 'the operator A' }, { kind: 'brace', at: { f: 0, i: 1 }, label: 'eigenvector' }, { kind: 'circle', at: { f: 0, i: 3 }, label: 'eigenvalue' } ] },
  { title: 'root: math labels', parts: [D(ROOT)], marks: [
    { kind: 'brace', at: { f: 0, i: 0 }, label: FR }, { kind: 'brace', at: { f: 0, i: 2, j: 3 }, label: String.raw`decays like $e^{-x^2}$` } ] },
  { title: 'same target, note above and below', parts: [D(EMC)], marks: [
    { kind: 'circle', at: { f: 0, i: 2 }, label: 'mass' }, { kind: 'brace', at: { f: 0, i: 2, j: 4 }, label: 'the energy content' } ] },
  { title: 'nested braces', parts: [D(String.raw`(a+b)+c`)], marks: [
    { kind: 'brace', at: { f: 0, i: 0, path: [] }, label: 'inner sum' }, { kind: 'brace', at: { f: 0, i: 0, j: 2 }, label: 'whole thing' } ] },

  // ── prose ──
  { title: 'prose: adjacent words', parts: ['we take the limit of the partial sums and compare them to the integral of f over the interval'], marks: [
    { kind: 'brace', at: { words: [3, 3] }, label: 'pointwise' }, { kind: 'brace', at: { words: [6, 7] }, label: 'finite truncations' }, { kind: 'underline', at: { words: [8, 8] }, label: 'key step' } ] },
  { title: 'prose: notes on consecutive lines (gap fight)', parts: ['a fairly long paragraph so that it wraps over several lines in the page, where one word near the end of this first line has a note below it and the word right under it on the next line has a note above it, which compete for the same gap between the two lines'], marks: [
    { kind: 'brace', at: { words: [12, 12] }, label: 'note below line 1' }, { kind: 'box', at: { words: [27, 27] }, label: 'note above line 2' } ] },
  { title: 'prose: page edges', parts: ['Edgeword at the start of a line and then a lot of filler text that goes on until the very last word on this line isRightEdge'], marks: [
    { kind: 'brace', at: { words: [0, 0] }, label: 'a long note at the left edge of the page' }, { kind: 'brace', at: { words: [21, 21] }, label: 'another long note at the right edge' } ] },
  { title: 'prose: inline math with notes', parts: ['so ', { tex: String.raw`\frac{a}{b}` }, ' is the slope and ', { tex: String.raw`x^2` }, ' grows, while ', { tex: String.raw`\sum_k c_k` }, ' converges'], marks: [
    { kind: 'brace', at: { f: 0, i: 0 }, label: 'slope' }, { kind: 'circle', at: { f: 1, i: 0, j: 1 }, label: 'quadratic' }, { kind: 'brace', at: { f: 2, i: 0, j: 1 }, label: 'a series' } ] },
  { title: 'prose: highlight + strike notes', parts: ['this claim is wrong because the bound fails, the correct bound is quadratic'], marks: [
    { kind: 'strike', at: { words: [3, 3] }, label: 'no!' }, { kind: 'highlight', at: { words: [9, 11] }, label: 'remember this' } ] },
];
