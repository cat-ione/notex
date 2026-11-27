// A LaTeX file as a note. The text is turned into the markdown a note is written in (headings,
// lists, bold, $math$, tables, callouts for theorems) and read as a markdown file is; what
// markdown can't say is put in after: references to numbered formulas and theorems (\ref,
// \eqref) become references in the note, and escaped characters come back as themselves.
// What a note has no place for (pictures, tikz, layout commands) is left out; a command it
// doesn't know keeps its text.

import { markdownToDoc } from './mdfile';
import { BOX_KINDS, BOX_NAME, NUMBERED_BOX, ch, math, uid, type BoxKind, type Doc, type Id, type Item } from './model';

/** Characters escaped in the LaTeX (\$ \_ …), kept apart from markdown till the note is read. */
const KEEP: Record<string, string> = { $: '', _: '', '#': '', '*': '', '`': '', '|': '', '=': '', '~': '', '>': '' };
const KEPT = Object.fromEntries(Object.entries(KEEP).map(([c, k]) => [k, c]));
/** A reference: `` its word before (Theorem, Equation…) `` its label ``. */
const REF = /([^]*)([^]*)/g;

/** Environments that are a box, by name (more come from the file's \newtheorem). */
const BOX_ENVS: Record<string, BoxKind> = {
  thm: 'theorem', lem: 'lemma', prop: 'proposition', cor: 'corollary', defn: 'definition', def: 'definition', dfn: 'definition',
  ex: 'example', exa: 'example', rem: 'remark', rmk: 'remark', note: 'remark', quote: 'quote', quotation: 'quote', proof: 'proof',
  ...Object.fromEntries(BOX_KINDS.map((k) => [k, k])),
};
/** Words a reference may follow, which a reference to a box says itself (Theorem~\ref{…}: Theorem 2). */
const REF_WORD = /(?:\b(Theorems?|Thm\.?|Lemmas?|Lem\.?|Propositions?|Prop\.?|Corollary|Cor\.?|Definitions?|Def\.?|Examples?|Ex\.?|Equations?|Eqs?\.?|eq\.?)[\s~]*)$/;

/** Display math environments: numbered unless starred (as LaTeX does). */
const DISPLAY = new Set(['equation', 'equation*', 'displaymath', 'math', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'flalign', 'flalign*', 'alignat', 'alignat*']);
/** Environments only kept for what's in them. */
const UNWRAP = new Set(['document', 'center', 'flushleft', 'flushright', 'minipage', 'abstract', 'small', 'footnotesize', 'large', 'Large', 'samepage', 'multicols', 'frame', 'block', 'raggedright']);
/** Environments left out (a note has no place for them). */
const DROP = new Set(['tikzpicture', 'tikzcd', 'thebibliography', 'comment', 'filecontents', 'titlepage']);
/** Code, as it is. */
const VERBATIM = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'Verbatim', 'alltt', 'code']);

/** Commands whose argument is left out with them (layout, metadata). */
const DROP_ARGS = new Set(['label', 'vspace', 'vspace*', 'hspace', 'hspace*', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'pagestyle', 'thispagestyle', 'bibliographystyle', 'bibliography', 'input', 'include', 'includegraphics', 'usepackage', 'documentclass', 'newcommand', 'renewcommand', 'providecommand', 'DeclareMathOperator', 'newtheorem', 'theoremstyle', 'numberwithin', 'geometry', 'hypersetup', 'graphicspath', 'tikzset', 'pgfplotsset', 'definecolor', 'newenvironment', 'renewenvironment', 'author', 'date', 'title', 'index', 'phantom', 'hphantom', 'vphantom']);
/** Commands that say nothing (spacing, layout). */
const NOTHING = new Set(['noindent', 'indent', 'medskip', 'smallskip', 'bigskip', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak', 'linebreak', 'centering', 'raggedright', 'raggedleft', 'maketitle', 'tableofcontents', 'hfill', 'vfill', 'hline', 'toprule', 'midrule', 'bottomrule', 'appendix', 'frontmatter', 'mainmatter', 'backmatter', 'normalsize', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'selectfont', 'protect', 'relax', 'null', 'leavevmode', 'nobreak', 'sloppy', 'item', 'bf', 'it', 'rm', 'sf', 'tt', 'em', 'displaystyle']);
/** Commands as the characters they print. */
const WORDS: Record<string, string> = {
  LaTeX: 'LaTeX', TeX: 'TeX', LaTeXe: 'LaTeX2e', ldots: '…', dots: '…', textellipsis: '…', today: new Date().toLocaleDateString(),
  textbackslash: '\\', textasciitilde: KEEP['~'], textasciicircum: '^', textbar: KEEP['|'], textless: '<', textgreater: KEEP['>'],
  textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  S: '§', P: '¶', copyright: '©', dag: '†', ddag: '‡', ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı',
  quad: ' ', qquad: ' ', enspace: ' ', thinspace: ' ', space: ' ', par: '\n\n', newline: '\n\n', break: '\n\n',
};
/** Accents over a letter: \'e, \"o, \^a, \`e, \~n, \c c … */
const ACCENTS: Record<string, string> = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊', k: '̨' };
/** Text styles as markdown: the marker each side. */
const STYLES: Record<string, string> = { textbf: '**', bfseries: '**', emph: '*', textit: '*', textsl: '*', itshape: '*', texttt: '`', sout: '~~', st: '~~', hl: '==', underline: '', uline: '', textrm: '', textsf: '', textup: '', textnormal: '', textsc: '', mbox: '', text: '', makebox: '', fbox: '', framebox: '', textmd: '' };
const HEADINGS: Record<string, string> = { part: '#', chapter: '#', section: '#', subsection: '##', subsubsection: '###', paragraph: '###', subparagraph: '###' };

type State = {
  /** The file's own theorem environments, by name. */
  envs: Record<string, BoxKind>;
  /** Each numbered display formula's label, in order (null: none). */
  eqLabels: (string | null)[];
  /** Each box's label, in order. */
  boxLabels: (string | null)[];
  /** Things left out, to say so. */
  dropped: Set<string>;
};

/** A LaTeX file as a note. `dropped`: the kinds of thing it left out (tikz pictures, images…). */
export function latexToDoc(src: string): Doc & { dropped?: string[] } {
  src = stripComments(src.replace(/\r\n?/g, '\n'));
  const st: State = { envs: { ...BOX_ENVS }, eqLabels: [], boxLabels: [], dropped: new Set() };
  // the file's theorem environments: \newtheorem{lem}[theorem]{Lemma}
  for (const m of src.matchAll(/\\newtheorem\*?\s*\{([^}]+)\}\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    const word = m[2].trim().toLowerCase();
    const kind = BOX_KINDS.find((k) => k === word) ?? BOX_ENVS[word];
    st.envs[m[1].trim()] = kind ?? 'remark';
  }
  const title = /\\title\s*(?:\[[^\]]*\])?\s*\{/.exec(src);
  const begin = src.indexOf('\\begin{document}'), end = src.indexOf('\\end{document}');
  let body = begin >= 0 ? src.slice(begin + '\\begin{document}'.length, end > begin ? end : undefined) : src;
  // the title, where \maketitle puts it (or at the top)
  if (title) {
    const t = `\\section*{${braced(src, title.index + title[0].length - 1)[0]}}\n\n`;
    body = /\\maketitle/.test(body) ? body.replace(/\\maketitle/, t) : t + body;
  }
  const lines = blocks(body, st, 0, false);
  const doc = markdownToDoc(lines.join('\n'));
  resolve(doc, st);
  return st.dropped.size ? { ...doc, dropped: [...st.dropped] } : doc;
}

/** Comments out (a % to the line's end, but not \%); verbatim's lines kept as they are. */
function stripComments(s: string): string {
  let verb = false;
  return s
    .split('\n')
    .map((l) => {
      if (/\\begin\{(verbatim|lstlisting|minted|Verbatim)\*?\}/.test(l)) verb = true;
      if (verb) {
        if (/\\end\{(verbatim|lstlisting|minted|Verbatim)\*?\}/.test(l)) verb = false;
        return l;
      }
      const m = /(^|[^\\])((?:\\\\)*)%/.exec(l);
      // (a line ending in a comment joins the next, as in LaTeX: none of its space)
      return m ? l.slice(0, m.index + m[1].length + m[2].length) + '' : l;
    })
    .join('\n')
    .replace(/\n[ \t]*/g, '')
    .replace(//g, '');
}

/** The group in braces at `i` (spaces before it skipped): its text and the index after it. No group: ['', i]. */
function braced(s: string, i: number, open = '{', close = '}'): [string, number] {
  let j = i;
  while (j < s.length && /[ \t\n]/.test(s[j])) j++;
  if (s[j] !== open) return ['', i];
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return [s.slice(j + 1, k), k + 1];
  }
  return [s.slice(j + 1), s.length];
}

/** An environment's body from `i` (just after its \begin{name}): the body and the index after its \end. */
function envBody(s: string, i: number, name: string): [string, number] {
  const esc = name.replace(/[*]/g, '\\*');
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}`, 'g');
  re.lastIndex = i;
  let depth = 1, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] === 'begin') depth++;
    else if (--depth === 0) return [s.slice(i, m.index), m.index + m[0].length];
  }
  return [s.slice(i), s.length];
}

/** A display formula as markdown's $$ … $$: numbered with \tag; its \label noted. */
function display(tex: string, numbered: boolean, st: State, env = ''): string {
  let label: string | null = null;
  tex = tex.replace(/\\label\s*\{([^}]*)\}/g, (_, l: string) => ((label ??= l.trim()), ''));
  if (/\\(nonumber|notag)\b/.test(tex) && !/\\\\/.test(tex)) numbered = false;
  tex = tex.replace(/\\(nonumber|notag)\b/g, '').replace(/\\tag\*?\s*\{[^}]*\}/g, () => ((numbered = true), ''));
  // several lines: aligned (gathered for gather), in the one formula
  if (/^(align|flalign|alignat|eqnarray|multline|split)/.test(env) || (/\\\\/.test(tex) && !/\\begin\{/.test(tex))) {
    if (env.startsWith('alignat')) tex = tex.replace(/^\s*\{[^}]*\}/, '');
    if (env.startsWith('eqnarray')) tex = tex.replace(/&\s*([=<>]|\\[a-z]+)\s*&/g, '&$1 ');
    tex = `\\begin{${env.startsWith('gather') || env.startsWith('multline') ? 'gathered' : 'aligned'}}${tex}\\end{${env.startsWith('gather') || env.startsWith('multline') ? 'gathered' : 'aligned'}}`;
  }
  if (numbered) st.eqLabels.push(label);
  return `$$${tex.replace(/\s*\n\s*/g, ' ').trim()}${numbered ? ' \\tag{}' : ''}$$`;
}

/** A tabular as markdown's table rows. */
function table(spec: string, body: string, st: State): string[] {
  const aligns = [...spec.replace(/\{[^}]*\}/g, '').replace(/[^lcrpXmb]/g, '')].map((c) => (c === 'c' ? ':---:' : c === 'r' ? '---:' : '---'));
  const rows = body
    .split(/\\\\(?:\s*\[[^\]]*\])?/)
    .map((r) => r.replace(/\\(hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\})/g, '').trim())
    .filter(Boolean)
    .map((r) => splitTop(r, '&').map((c) => inline(c, st).trim().replace(/\|/g, KEEP['|'])));
  if (!rows.length) return [];
  const n = Math.max(aligns.length, ...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: n }, (_, k) => cells[k] ?? '').join(' | ')} |`;
  return ['', line(rows[0]), `| ${Array.from({ length: n }, (_, k) => aligns[k] ?? '---').join(' | ')} |`, ...rows.slice(1).map(line), ''];
}

/** `s` split at `sep` where it's not inside braces or an environment. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  // (a command as the separator, \item: not the start of a longer name, \itemsep)
  const word = /^\\[a-zA-Z]+$/.test(sep);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (depth === 0 && s.startsWith(sep, i) && !(word && /[a-zA-Z]/.test(s[i + sep.length] ?? ''))) {
      out.push(s.slice(from, i));
      from = i + sep.length;
      i += sep.length - 1;
      continue;
    }
    if (c === '\\') {
      const env = /^\\(begin|end)\s*\{/.exec(s.slice(i, i + 12));
      if (env) depth += env[1] === 'begin' ? 1 : -1;
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  out.push(s.slice(from));
  return out;
}

/**
 * LaTeX of a part of the body as markdown lines. `depth`: how deep in lists it is (its
 * items indented by that); `inBox`: in a box already (a box in a box is just its text, as a
 * note's boxes don't nest).
 */
function blocks(s: string, st: State, depth: number, inBox: boolean): string[] {
  const out: string[] = [];
  let para = '';
  const pad = '  '.repeat(Math.max(0, depth - 1));
  const flush = () => {
    const t = inline(para, st).replace(/[ \t]+/g, ' ').trim();
    if (t) out.push(...t.split(/\n{2,}/).map((l) => l.trim()).filter(Boolean).map((l) => (depth ? pad + '  ' + l : l)));
    para = '';
  };
  for (let i = 0; i < s.length; ) {
    const rest = s.slice(i, i + 40);
    // a blank line: a paragraph ends
    const blank = /^\n[ \t]*\n/.exec(rest);
    if (blank) {
      flush();
      i += blank[0].length;
      continue;
    }
    // display math: \[ … \] and $$ … $$
    if (rest.startsWith('\\[') || rest.startsWith('$$')) {
      const close = rest.startsWith('\\[') ? '\\]' : '$$';
      const e = s.indexOf(close, i + 2);
      const tex = s.slice(i + 2, e < 0 ? s.length : e);
      flush();
      out.push(display(tex, false, st));
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    // an escaped character (\$ \% …): text, for inline() to read
    if (s[i] === '\\' && s[i + 1] && /[^a-zA-Z\\([]/.test(s[i + 1])) {
      para += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    // inline math: taken whole (a matrix's \begin in it is the formula's)
    if (s[i] === '$' || rest.startsWith('\\(')) {
      const close = s[i] === '$' ? '$' : '\\)';
      let e = i + close.length;
      while (e < s.length && !s.startsWith(close, e)) e += s[e] === '\\' ? 2 : 1;
      para += s.slice(i, e + close.length);
      i = e + close.length;
      continue;
    }
    // \\ : a new line, a new paragraph in a note
    if (/^\\\\(\s*\[[^\]]*\])?/.test(rest) && !rest.startsWith('\\\\\\')) {
      flush();
      i += /^\\\\(\s*\[[^\]]*\])?/.exec(rest)![0].length;
      continue;
    }
    const cmd = /^\\([a-zA-Z]+)(\*?)/.exec(rest);
    if (cmd) {
      const [whole, name, star] = cmd;
      // headings
      if (HEADINGS[name]) {
        let j = i + whole.length;
        const opt = braced(s, j, '[', ']');
        j = opt[1];
        const [t, after] = braced(s, j);
        flush();
        out.push(`${HEADINGS[name]} ${inline(t, st).replace(/\s+/g, ' ').trim()}`);
        // (its \label right after it: a section can't be referred to in a note)
        i = after;
        continue;
      }
      if (name === 'item' && !star) {
        // (an \item outside a list: a line of its own)
        flush();
        i += whole.length;
        continue;
      }
      if (name === 'begin') {
        const [env, after] = braced(s, i + whole.length);
        const [inner, next] = envBody(s, after, env);
        flush();
        out.push(...environment(env.trim(), inner, st, depth, inBox));
        i = next;
        continue;
      }
    }
    para += s[i];
    i++;
  }
  flush();
  return out;
}

/** An environment as markdown lines. */
function environment(env: string, body: string, st: State, depth: number, inBox: boolean): string[] {
  const base = env.replace(/\*$/, '');
  if (DISPLAY.has(env)) return [display(body, !env.endsWith('*') && env !== 'displaymath' && env !== 'math', st, env)];
  if (VERBATIM.has(env)) {
    // (minted's language, lstlisting's options: the fence's language when there is one)
    let code = body, lang = '';
    const opt = /^\s*\[([^\]]*)\]/.exec(code);
    if (opt) (code = code.slice(opt[0].length)), (lang = /language\s*=\s*\{?(\w+)/.exec(opt[1])?.[1] ?? '');
    if (env === 'minted') {
      const [l, after] = braced(code, 0);
      if (l) (lang = l), (code = code.slice(after));
    }
    return ['```' + lang.toLowerCase(), ...code.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '').split('\n'), '```'];
  }
  if (base === 'tabular' || base === 'tabularx' || base === 'array' || base === 'longtable') {
    let rest = body;
    if (base === 'tabularx') rest = rest.slice(braced(rest, 0)[1]);
    rest = rest.slice(braced(rest, 0, '[', ']')[1]);
    const [spec, after] = braced(rest, 0);
    return table(spec, rest.slice(after), st);
  }
  if (base === 'table' || base === 'figure') {
    if (/\\includegraphics/.test(body)) st.dropped.add('images');
    if (/\\begin\{tikzpicture\}/.test(body)) st.dropped.add('tikz pictures');
    // (its caption as a line under what's kept of it)
    const cap = /\\caption\*?\s*(?:\[[^\]]*\])?\s*\{/.exec(body);
    const caption = cap ? braced(body, cap.index + cap[0].length - 1)[0] : '';
    const inner = blocks(body.replace(/^\s*\[[^\]]*\]/, '').replace(/\\caption\*?\s*(\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, ''), st, depth, inBox);
    return [...inner, ...(caption ? [`*${inline(caption, st).trim()}*`] : [])];
  }
  if (base === 'itemize' || base === 'enumerate' || base === 'description' || base === 'compactitem' || base === 'compactenum' || base === 'inparaenum') {
    const items = splitTop(body.replace(/^\s*\[[^\]]*\]/, ''), '\\item').slice(1);
    const out: string[] = [];
    const pad = '  '.repeat(depth);
    for (let item of items) {
      let mark = base === 'enumerate' || base === 'compactenum' || base === 'inparaenum' ? '1. ' : '- ';
      const opt = /^\s*\[((?:[^\][]|\{[^}]*\})*)\]/.exec(item);
      if (opt) {
        item = item.slice(opt[0].length);
        const l = opt[1].trim();
        if (/^\$?\\(square|Box|ballotbox)\$?$|^\[\s?\]$/.test(l)) mark = '- [ ] ';
        else if (/^\$?\\(boxtimes|checkmark|blacksquare|CheckedBox|XBox)\$?$|^\[[xX]\]$/.test(l)) mark = '- [x] ';
        else if (l) item = `\\textbf{${l}} ${item}`;
      }
      const lines = blocks(item, st, depth + 1, inBox);
      // (the item's first line takes the marker; any after it are its own paragraphs)
      const first = lines.findIndex((l) => l.trim());
      if (first < 0) {
        out.push(pad + mark.trim());
        continue;
      }
      lines[first] = pad + mark + lines[first].trim();
      out.push(...lines.map((l, k) => (k === first || /^\s*([-*+]|\d+[.)])\s/.test(l) ? l : l.trim())));
    }
    return out;
  }
  if (st.envs[base] || BOX_ENVS[base]) {
    const kind = st.envs[base] ?? BOX_ENVS[base];
    let rest = body;
    const opt = /^\s*\[((?:[^\][]|\{[^}]*\})*)\]/.exec(rest);
    if (opt) rest = rest.slice(opt[0].length);
    // its label: the first \label not inside something else in it
    let label: string | null = null;
    const lm = /\\label\s*\{([^}]*)\}/.exec(rest.split(/\\begin\s*\{/)[0]);
    if (lm) (label = lm[1].trim()), (rest = rest.replace(lm[0], ''));
    if (inBox) return blocks(rest, st, depth, true);
    st.boxLabels.push(label);
    const name = opt && kind !== 'proof' ? inline(opt[1], st).replace(/\s+/g, ' ').trim() : '';
    const inner = blocks(rest, st, 0, true).filter((l) => l.trim());
    if (kind === 'quote') return [...inner.map((l) => `> ${l}`), ''];
    // (its name in brackets at its start, as a note writes a theorem's name; a theorem kind
    // the note doesn't have is the nearest it has)
    const head = `> [!${kind}]${name ? ' ' + name : ''}`;
    // (a blank line after it: the next box is one of its own)
    return [head, ...(inner.length ? inner.map((l) => `> ${l}`) : ['> ']), ''];
  }
  if (DROP.has(base)) {
    st.dropped.add(base === 'tikzpicture' || base === 'tikzcd' ? 'tikz pictures' : base === 'thebibliography' ? 'the bibliography' : base);
    return [];
  }
  // anything else (center, abstract, an environment of the file's own…): what's in it
  return blocks(body.replace(UNWRAP.has(base) ? /^$/ : /^\s*(\[[^\]]*\])?(\{[^}]*\})?/, ''), st, depth, inBox);
}

/** LaTeX text as a line of markdown: styles as markers, math as $…$, references marked for later. */
function inline(s: string, st: State): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    // math: $…$ and \( … \)
    if (c === '$' || s.startsWith('\\(', i)) {
      const dbl = s.startsWith('$$', i);
      const open = c === '$' ? (dbl ? '$$' : '$') : '\\(';
      const close = c === '$' ? open : '\\)';
      let e = i + open.length;
      while (e < s.length && !s.startsWith(close, e)) e += s[e] === '\\' ? 2 : 1;
      const tex = s.slice(i + open.length, e).replace(/\\label\s*\{[^}]*\}/g, '').replace(/\s*\n\s*/g, ' ').trim();
      if (tex) out += dbl ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
      i = e + close.length;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(\*?)|^\\(.)/.exec(s.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const name = m[1] ?? '';
      const sym = m[3];
      if (sym !== undefined) {
        // \% \& \$ …, \' accents, \\ (a line break), \, (a thin space)
        // (\~ is an accent over a letter; \~{} alone a tilde)
        const accent = ACCENTS[sym] && (sym !== '~' || /^\{?[a-zA-Z]/.test(s.slice(i)));
        if (accent) {
          const [g, after] = braced(s, i);
          const letter = g || s[i];
          i = g ? after : i + 1;
          out += (letter ?? '').normalize('NFD').replace(/^\\i$/, 'i') + ACCENTS[sym];
          out = out.normalize('NFC');
        } else if (sym === '\\') out += '\n\n';
        else if (',;:! '.includes(sym) || sym === '\n') out += ' ';
        else if (sym === '-' || sym === '/') out += '';
        else out += KEEP[sym] ?? sym;
        continue;
      }
      if (ACCENTS[name] && name.length === 1) {
        const [g, after] = braced(s, i);
        const letter = g || s.slice(i).trimStart()[0] || '';
        i = g ? after : i + (s.slice(i).length - s.slice(i).trimStart().length) + 1;
        out = (out + letter + ACCENTS[name]).normalize('NFC');
        continue;
      }
      // references: marked, put in once every label is known
      if (/^(ref|eqref|cref|Cref|autoref|vref)$/.test(name)) {
        const [l, after] = braced(s, i);
        i = after;
        const word = REF_WORD.exec(out);
        if (word) out = out.slice(0, word.index);
        out += `${word ? word[0].replace(/~/g, ' ') : ''}${name === 'eqref' ? '(' : ''}${l.trim()}`;
        continue;
      }
      if (name === 'href') {
        const [url, a] = braced(s, i);
        const [text, b] = braced(s, a);
        i = b;
        out += `[${inline(text, st)}](${url.trim()})`;
        continue;
      }
      if (name === 'url' || name === 'nolinkurl') {
        const [url, a] = braced(s, i);
        i = a;
        out += url.trim();
        continue;
      }
      if (name === 'footnote' || name === 'footnotetext' || name === 'marginpar') {
        const [t, a] = braced(s, i);
        i = a;
        out += ` (${inline(t, st).trim()})`;
        continue;
      }
      if (name === 'cite' || name === 'citep' || name === 'citet' || name === 'parencite' || name === 'textcite') {
        const opt = braced(s, i, '[', ']');
        const [keys, a] = braced(s, opt[1]);
        i = a;
        out += `[${keys.split(',').map((k) => k.trim()).join(', ')}${opt[0] ? ', ' + inline(opt[0], st) : ''}]`;
        continue;
      }
      if (name in STYLES) {
        const [t, a] = braced(s, i);
        const mk = STYLES[name];
        // (a switch, \bfseries: to the group's end, which is the rest of what's here)
        const body = a === i ? s.slice(i) : t;
        i = a === i ? s.length : a;
        const inner = inline(body, st);
        // (markers hug the words: spaces outside them)
        const lead = /^\s*/.exec(inner)![0], trail = /\s*$/.exec(inner)![0];
        const core = inner.trim();
        out += core ? lead + (mk === '`' ? '`' + core.replace(/`/g, KEEP['`']) + '`' : mk + core + mk) + trail : inner;
        continue;
      }
      if (name in WORDS) {
        out += WORDS[name];
        // (a command's name ends at a space, which isn't text: \LaTeX\ or \LaTeX{} keep one)
        if (/^[a-zA-Z]/.test(name)) i = skipEmpty(s, i);
        continue;
      }
      if (DROP_ARGS.has(name + (m[2] ?? '')) || DROP_ARGS.has(name)) {
        let j = braced(s, i, '[', ']')[1];
        // (as many braced groups as follow: \newcommand{\a}[1]{…}, \setlength{\x}{1em})
        for (let g = braced(s, j); g[1] !== j; g = braced(s, j)) {
          j = g[1];
          j = braced(s, j, '[', ']')[1];
        }
        if (name === 'includegraphics') st.dropped.add('images');
        i = j;
        continue;
      }
      if (NOTHING.has(name)) {
        i = skipEmpty(s, i);
        continue;
      }
      // a command it doesn't know: its text (every braced group after it), else nothing
      let j = braced(s, i, '[', ']')[1], text = '';
      for (let g = braced(s, j); g[1] !== j; g = braced(s, j)) (text += inline(g[0], st)), (j = g[1]);
      i = j === i ? skipEmpty(s, i) : j;
      out += text;
      continue;
    }
    if (c === '{' || c === '}') {
      i++;
      continue;
    }
    if (c === '~') (out += ' '), i++;
    else if (s.startsWith('---', i)) (out += '—'), (i += 3);
    else if (s.startsWith('--', i)) (out += '–'), (i += 2);
    else if (s.startsWith('``', i)) (out += '“'), (i += 2);
    else if (s.startsWith("''", i)) (out += '”'), (i += 2);
    else if (c === '`') (out += '‘'), i++;
    else if (c === "'" && /\w$/.test(out) === false && /^\w/.test(s.slice(i + 1))) (out += '‘'), i++;
    else if (c === "'") (out += '’'), i++;
    else if (c === '\n') (out += ' '), i++;
    else (out += c), i++;
  }
  return out;
}

/** After a command's name: the space that ends it, or {}, skipped. */
function skipEmpty(s: string, i: number): number {
  if (s.startsWith('{}', i)) return i + 2;
  let j = i;
  while (s[j] === ' ' || s[j] === '\t') j++;
  return s[j] === '\n' && s[j + 1] !== '\n' ? j + 1 : j;
}

/** References put in (to the numbered formulas and boxes their labels name), and kept characters back. */
function resolve(doc: Doc, st: State) {
  // (each with what it shows, numbered as the editor numbers them: see Editor.labels)
  const targets = new Map<string, { id: Id; box: boolean; shows: string }>();
  let eq = 0, bx = 0, eqN = 0, bxN = 0;
  const seen = new Set<Id>();
  for (const blk of doc.blocks) {
    if (blk.box && !seen.has(blk.box.id)) {
      seen.add(blk.box.id);
      const l = st.boxLabels[bx++];
      if (NUMBERED_BOX.has(blk.box.k)) {
        const shows = `${BOX_NAME[blk.box.k]} ${++bxN}`;
        if (l) targets.set(l, { id: blk.box.id, box: true, shows });
      }
    }
    for (const it of blk.items) {
      if (it.t !== 'm' || !it.display || !it.num) continue;
      const l = st.eqLabels[eq++];
      const shows = `(${++eqN})`;
      if (l) targets.set(l, { id: it.id, box: false, shows });
    }
  }
  for (const blk of doc.blocks) {
    const text = blk.items.map((it) => (it.t === 'c' ? it.ch : '\0')).join('');
    if (!/[-]/.test(text)) continue;
    const items: Item[] = [];
    let k = 0;
    // (a match's characters are each one item: text offsets are item offsets)
    for (const m of text.matchAll(REF)) {
      items.push(...blk.items.slice(k, m.index).map(back));
      const eqref = m[2].startsWith('(');
      const t = targets.get(eqref ? m[2].slice(1) : m[2]);
      const word = m[1];
      if (!t) items.push(...[...(word + '??')].map((c) => ch(c)));
      else {
        // (a reference to a box says its name; to a formula, its number after any word before it)
        if (!t.box && word) items.push(...[...word.replace(/\s*$/, ' ')].map((c) => ch(c)));
        items.push(math([{ k: 'sym', id: uid(), v: t.shows, ref: t.id }]));
      }
      k = m.index + m[0].length;
    }
    items.push(...blk.items.slice(k).map(back));
    blk.items = items;
  }
}

/** A kept character back as itself. */
const back = (it: Item): Item => (it.t === 'c' && KEPT[it.ch] ? { ...it, ch: KEPT[it.ch] } : it);
