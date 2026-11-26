import { describe, expect, it } from 'vitest';
import { marked, matchAt, rank, typoAt, typos } from './match';

const cmds = ['inlinecode', 'print', 'drawings', 'settings', 'underline', 'substitutions', 'image', 'italic', 'addrow', 'deleterow', 'addcolumn', 'deletecolumn', 'h1', 'h2', 'help', 'highlight'];

describe('matching typed letters to command names', () => {
  it('a beginning matches', () => expect(matchAt('inlinecode', 'inl')).toEqual([0, 1, 2]));
  it('a short run inside does not (in is not print or settings)', () => {
    expect(matchAt('print', 'in')).toBeNull();
    expect(matchAt('settings', 'in')).toBeNull();
  });
  it('3 letters on, a run inside matches', () => expect(matchAt('deleterow', 'row')).toEqual([6, 7, 8]));
  it('the first letter, then the rest in order', () => expect(matchAt('addcolumn', 'acl')).toEqual([0, 3, 5]));
  it('letters in order but not from the first do not match', () => expect(matchAt('underline', 'dl')).toBeNull());
  it('ignores case, nothing typed matches everything', () => {
    expect(matchAt('Gamma', 'ga')).toEqual([0, 1]);
    expect(matchAt('anything', '')).toEqual([]);
  });
});

describe('ranking', () => {
  it('only what matches, beginnings first, shorter first', () => {
    expect(rank(cmds, 'in')).toEqual(['inlinecode']);
    expect(rank(cmds, 'h')).toEqual(['h1', 'h2', 'help', 'highlight']);
    expect(rank(cmds, 'row')).toEqual(['addrow', 'deleterow']);
    expect(rank(cmds, 'i')).toEqual(['image', 'italic', 'inlinecode']);
  });
  it('an exact name first, then its case', () => {
    expect(rank(['phi', 'Phi', 'varphi'], 'Phi')).toEqual(['Phi', 'phi', 'varphi']);
  });
  it('a beginning before a run inside, before letters apart', () => {
    expect(rank(['dcol', 'addcolumn', 'colour', 'chosen'], 'col')).toEqual(['colour', 'dcol', 'addcolumn']);
    expect(rank(['cxb', 'cbx'], 'cb')).toEqual(['cbx', 'cxb']);
  });
  it('nothing typed: everything, in its order', () => expect(rank(cmds, '')).toEqual(cmds));
});

describe('typos', () => {
  it('counts a letter wrong, missing, extra, or two swapped as one', () => {
    expect(typos('tabel', 'table')).toBe(1);
    expect(typos('tble', 'table')).toBe(1);
    expect(typos('taable', 'table')).toBe(1);
    expect(typos('tavle', 'table')).toBe(1);
    expect(typos('abc', 'xyz')).toBe(3);
  });
  it('finds a name from its start typed with a typo', () => {
    expect(typoAt('table', 'tabel')).not.toBeNull();
    expect(typoAt('italic', 'itlaic')).not.toBeNull();
    expect(typoAt('frac', 'farc')).not.toBeNull();
    expect(typoAt('settings', 'setings')).not.toBeNull();
  });
  it('forgives none in 1–2 letters, one up to 5, two from 6', () => {
    expect(typoAt('h1', 'h2')).toBeNull();
    expect(typoAt('table', 'tbxle')).toBeNull();
    expect(typoAt('substitutions', 'sbustitutoins')).not.toBeNull();
    expect(typoAt('theme', 'zzzme')).toBeNull();
  });
  it('marks the letters that agree', () => {
    expect(marked('table', 'tabel')).toEqual([0, 1, 2]);
    expect(marked('table', 'tab')).toEqual([0, 1, 2]);
  });
});

describe('fuzzy ranking', () => {
  const cmds = { table: 'insert a table', theme: 'next theme', h1: 'heading 1', h2: 'heading 2', pdf: 'save as PDF', print: 'print  ctrl+p', italic: 'italic  ctrl+i' } as Record<string, string>;
  const r = (q: string) => rank(Object.keys(cmds), q, () => 0, (n) => cmds[n]);
  it('a typo still finds it', () => {
    expect(r('tabel')).toEqual(['table']);
    expect(r('itlaic')).toEqual(['italic']);
  });
  it('a word of what it does finds it', () => {
    expect(r('heading')).toEqual(['h1', 'h2']);
    expect(r('save')).toEqual(['pdf']);
  });
  it('real matches come before typos, and typos before descriptions', () => {
    expect(r('pri')).toEqual(['print']);
    expect(rank(['tab', 'tbx', 'other'], 'tab', () => 0, (n) => (n === 'other' ? 'a tab' : ''))).toEqual(['tab', 'tbx', 'other']);
  });
});
