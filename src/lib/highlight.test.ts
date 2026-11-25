import { describe, expect, it } from 'vitest';
import { highlight, knownLanguage } from './highlight';

/** The runs of `code` that got kind `tk`, as text. */
function runs(code: string, lang: string, tk: string): string[] {
  const kinds = highlight(code, lang);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i <= code.length; i++) {
    if (i < code.length && kinds[i] === tk) cur += code[i];
    else if (cur) out.push(cur), (cur = '');
  }
  return out;
}

describe('highlight', () => {
  it('python: keywords, strings, comments, numbers, function names', () => {
    const code = 'def mean(xs):\n    # the average\n    return sum(xs) / len(xs) if xs else 0.0\nprint("done")';
    expect(runs(code, 'py', 'kw')).toEqual(expect.arrayContaining(['def', 'return', 'if', 'else']));
    expect(runs(code, 'py', 'com')).toEqual(['# the average']);
    expect(runs(code, 'py', 'str')).toEqual(['"done"']);
    expect(runs(code, 'py', 'num')).toEqual(['0.0']);
    expect(runs(code, 'py', 'fn')).toEqual(expect.arrayContaining(['mean']));
  });

  it('a string over several lines is one string', () => {
    const code = 's = """first\nsecond"""\nx = 1';
    expect(runs(code, 'python', 'str')).toEqual(['"""first\nsecond"""']);
    expect(runs(code, 'python', 'num')).toEqual(['1']);
  });

  it('a block comment over several lines', () => {
    const code = '/* one\n two */ int x = 2;';
    expect(runs(code, 'c', 'com')).toEqual(['/* one\n two */']);
    expect(runs(code, 'c', 'kw')).toContain('int');
  });

  it('every language by its usual names', () => {
    const samples: [string, string, string][] = [
      ['js', 'const f = () => 1;', 'const'],
      ['ts', 'let x: number = 1;', 'let'],
      ['c++', 'template <typename T> class A {};', 'template'],
      ['java', 'public class A {}', 'public'],
      ['rs', 'fn main() { let x = 1; }', 'fn'],
      ['go', 'func main() {}', 'func'],
      ['jl', 'function f(x) end', 'function'],
      ['r', 'f <- function(x) x', 'function'],
      ['matlab', 'for i = 1:10\nend', 'for'],
      ['hs', 'main = do print 1 where x = 2', 'do'],
      ['sql', 'SELECT * FROM t', 'SELECT'],
      ['sh', 'if [ -f x ]; then echo hi; fi', 'if'],
    ];
    for (const [lang, code, kw] of samples) {
      expect(knownLanguage(lang), lang).toBe(true);
      expect(runs(code, lang, 'kw'), lang).toContain(kw);
    }
  });

  it('json and latex', () => {
    expect(runs('{"a": 1, "b": true}', 'json', 'num')).toEqual(expect.arrayContaining(['1']));
    expect(runs('\begin{align} x \end{align} % note', 'tex', 'com')).toEqual(['% note']);
  });

  it('languages are matched without regard to case or spaces', () => {
    expect(knownLanguage(' Python ')).toBe(true);
    expect(runs('def f(): pass', 'PY', 'kw')).toContain('def');
  });

  it('nothing for a language it does not know, or none', () => {
    expect(knownLanguage('brainfuck')).toBe(false);
    expect(highlight('def f(): pass', 'brainfuck').every((k) => k === undefined)).toBe(true);
    expect(highlight('def f(): pass', '').every((k) => k === undefined)).toBe(true);
  });

  it('one kind per position, as long as the code', () => {
    const code = 'x = "é" + 1  # ✓';
    expect(highlight(code, 'py')).toHaveLength(code.length);
  });
});
