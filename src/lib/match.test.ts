import { describe, expect, it } from 'vitest';
import { matchAt, rank } from './match';

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
