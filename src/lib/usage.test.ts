import { beforeEach, describe, expect, it } from 'vitest';
import { byUse, forget, score, used } from './usage';
import { rank } from './match';

const DAY = 864e5;
const now = 1_800_000_000_000;

beforeEach(() => forget());

describe('remembering commands', () => {
  it('never picked: no score, the order kept', () => {
    expect(score('text', 'bold', now)).toBe(0);
    expect(byUse('text', ['a', 'b', 'c'], now)).toEqual(['a', 'b', 'c']);
  });

  it('the more picked, the earlier; the rest keep their order', () => {
    used('text', 'c', now);
    used('text', 'b', now);
    used('text', 'b', now);
    expect(byUse('text', ['a', 'b', 'c', 'd'], now)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('a pick counts half after a week, so lately beats long ago', () => {
    used('text', 'old', now - 14 * DAY);
    used('text', 'old', now - 14 * DAY);
    used('text', 'old', now - 14 * DAY);
    used('text', 'new', now - DAY);
    expect(score('text', 'old', now)).toBeCloseTo(0.75);
    expect(byUse('text', ['old', 'new'], now)).toEqual(['new', 'old']);
  });

  it('each palette remembers its own (underline in math is not the drawing)', () => {
    used('math', 'underline', now);
    expect(score('text', 'underline', now)).toBe(0);
    expect(score('math', 'underline', now)).toBe(1);
  });

  it('forget clears it all', () => {
    used('text', 'bold', now);
    forget();
    expect(score('text', 'bold', now)).toBe(0);
  });

  it('keeps the 200 most used', () => {
    for (let i = 0; i < 205; i++) used('math', 'c' + i, now + i);
    expect(score('math', 'c0', now + 300)).toBe(0);
    expect(score('math', 'c204', now + 300)).toBeGreaterThan(0);
  });
});

describe('ranking with what is used', () => {
  const names = ['image', 'italic', 'inlinecode', 'h1', 'help'];
  it('among equally good matches, the used first', () => {
    used('text', 'inlinecode', now);
    expect(rank(names, 'i', (n) => score('text', n, now))).toEqual(['inlinecode', 'image', 'italic']);
  });
  it('an exact name, and a better match, still win', () => {
    used('text', 'help', now);
    expect(rank(names, 'h1', (n) => score('text', n, now))).toEqual(['h1']);
    expect(rank(['hex', 'shell'], 'he', (n) => (n === 'shell' ? 9 : 0))).toEqual(['hex']);
  });
});
