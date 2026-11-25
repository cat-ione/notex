// Syntax highlighting for code blocks: each character's kind of token (keyword, string…),
// from Prism's tokenizer, so the editor can colour its own per-character spans.

import Prism from 'prismjs';
// (each registers itself with Prism; the order matters where one builds on another)
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-julia';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-matlab';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-latex';

/** The kinds of token that get a colour (see Editor.svelte, `.ch[data-tk]`). */
export type Tk = 'kw' | 'str' | 'com' | 'num' | 'fn' | 'type' | 'op' | 'pun';

/** A code block's language as written after ``` → Prism's name for it. */
const LANGS: Record<string, string> = {
  py: 'python', python: 'python', python3: 'python',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  java: 'java', rust: 'rust', rs: 'rust', go: 'go', golang: 'go',
  julia: 'julia', jl: 'julia', r: 'r', matlab: 'matlab', octave: 'matlab',
  haskell: 'haskell', hs: 'haskell', sql: 'sql',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  json: 'json', tex: 'latex', latex: 'latex',
};

/** Prism's token types → ours (an unlisted type takes what it's inside of). */
const KINDS: Record<string, Tk> = {
  keyword: 'kw', important: 'kw', atrule: 'kw', rule: 'kw', directive: 'kw', 'directive-hash': 'kw', macro: 'kw',
  string: 'str', char: 'str', 'template-string': 'str', 'triple-quoted-string': 'str', regex: 'str', 'attr-value': 'str', url: 'str',
  comment: 'com', prolog: 'com', doctype: 'com', cdata: 'com',
  number: 'num', boolean: 'num', constant: 'num', symbol: 'num',
  function: 'fn', 'function-definition': 'fn', decorator: 'fn', annotation: 'fn',
  'class-name': 'type', builtin: 'type', 'type-annotation': 'type', namespace: 'type',
  operator: 'op',
  punctuation: 'pun',
};

/** Whether code in this language is highlighted. */
export const knownLanguage = (lang: string) => LANGS[lang.trim().toLowerCase()] !== undefined;

const cache = new Map<string, (Tk | undefined)[]>();

/**
 * Each position of `code` (UTF-16 index): its kind of token, or undefined (plain). Nothing
 * for a language it doesn't know.
 */
export function highlight(code: string, lang: string): (Tk | undefined)[] {
  const name = LANGS[lang.trim().toLowerCase()];
  const grammar = name ? Prism.languages[name] : undefined;
  const out: (Tk | undefined)[] = new Array(code.length);
  if (!grammar) return out;
  const key = `${name}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let at = 0;
  const walk = (stream: Prism.TokenStream, inherited: Tk | undefined) => {
    if (typeof stream === 'string') {
      for (let i = 0; i < stream.length; i++) out[at + i] = inherited;
      at += stream.length;
      return;
    }
    if (Array.isArray(stream)) return stream.forEach((s) => walk(s, inherited));
    const aliases = Array.isArray(stream.alias) ? stream.alias : stream.alias ? [stream.alias] : [];
    const kind = KINDS[stream.type] ?? aliases.map((a) => KINDS[a]).find(Boolean) ?? inherited;
    walk(stream.content, kind);
  };
  walk(Prism.tokenize(code, grammar), undefined);
  // (a small cache: blocks are tokenized again whenever the note changes)
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
