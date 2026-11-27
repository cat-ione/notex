import { describe, expect, it } from 'vitest';
import { block, chars, cmd, math, plainCopy, sym } from './model';

describe('plainCopy', () => {
  it('copies a block deeply, sharing nothing with it', () => {
    const blk = { ...block([...chars('ab'), math([sym('x'), cmd('frac', [[sym('1')], [sym('2')]])])]), box: { k: 'theorem' as const, id: 'x' }, check: false };
    (blk.items[0] as { b?: true }).b = true;
    const c = plainCopy(blk);
    expect(c).toEqual(blk);
    expect(c).not.toBe(blk);
    expect(c.items).not.toBe(blk.items);
    expect(c.items[0]).not.toBe(blk.items[0]);
    expect(c.box).not.toBe(blk.box);
    c.items.pop();
    expect(blk.items).toHaveLength(3);
  });

  it('keeps fields set to undefined (JSON would drop them) and plain values as they are', () => {
    expect(plainCopy({ a: undefined, b: [1, null, 'x'] })).toEqual({ a: undefined, b: [1, null, 'x'] });
    expect(plainCopy(null)).toBe(null);
    expect(plainCopy('s')).toBe('s');
  });
});
