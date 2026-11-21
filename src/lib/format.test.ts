import { describe, expect, it } from 'vitest';
import { decode, deserialize, encode, serialize } from './format';
import { block, chars, cmd, math, sym, type Doc } from './model';

function sample(): Doc {
  const frac = cmd('frac', [[sym('a')], [sym('b')]]);
  const m = math([sym('x'), sym('='), frac]);
  const b0 = block([...chars('see '), m, ...chars(' here')]);
  const b1 = block(chars('second'), 'h2');
  const word = b0.items.slice(-4).map((i) => i.id);
  return {
    blocks: [b0, b1, block([math([sym('y')], true)])],
    arrows: [
      { id: 'a1', from: [frac.id], to: word, bend: 0.3, head: 'end', dash: true, boxed: false, label: 'hi' },
      { id: 'a2', from: [b1.id], to: [m.id], bend: -0.2, head: 'both', dash: false, boxed: true, label: '' },
    ],
    marks: [{ id: 'k1', kind: 'circle', at: [b0.items[0].id, b0.items[1].id, frac.id], dash: false, label: 'look', color: 'red' }],
  };
}

const text = (doc: Doc) => doc.blocks.map((b) => b.items.map((i) => (i.t === 'c' ? i.ch : `[${i.id}]`)).join(''));

describe('note format', () => {
  it('stores text as plain strings', () => {
    const f = encode(sample());
    expect(f.blocks[0].content[0]).toBe('see ');
    expect(f.blocks[0].content[2]).toBe(' here');
    expect(f.blocks[1]).toEqual({ kind: 'h2', content: ['second'] });
  });

  it('round-trips text, math and block kinds', () => {
    const doc = sample();
    const back = deserialize(serialize(doc));
    expect(text(back)).toEqual(text(doc));
    expect(back.blocks.map((b) => b.kind)).toEqual(['p', 'h2', 'p']);
    expect((back.blocks[2].items[0] as any).display).toBe(true);
  });

  it('re-attaches arrows to the same characters, blocks and math nodes', () => {
    const doc = sample();
    const back = decode(encode(doc));
    const [a1, a2] = back.arrows;
    const b0 = back.blocks[0].items;
    expect(a1.to).toEqual(b0.slice(-4).map((i) => i.id));
    expect(a1.from).toEqual(doc.arrows[0].from); // math node ids are kept
    expect(a2.from).toEqual([back.blocks[1].id]);
    expect(a2.to).toEqual([b0[4].id]);
    expect(a1).toMatchObject({ bend: 0.3, head: 'end', dash: true, label: 'hi' });
  });

  it('re-attaches marks', () => {
    const doc = sample();
    const back = decode(encode(doc));
    const b0 = back.blocks[0].items;
    expect(back.marks[0]).toMatchObject({ kind: 'circle', label: 'look', color: 'red' });
    expect(back.marks[0].at).toEqual([b0[0].id, b0[1].id, doc.marks[0].at[2]]);
  });

  it('omits marks when there are none and reads files without them', () => {
    const doc = { ...sample(), marks: [] };
    const f = encode(doc);
    expect('marks' in f).toBe(false);
    expect(decode(f).marks).toEqual([]);
  });

  it('still reads raw in-memory documents', () => {
    const doc = sample();
    expect(text(deserialize(JSON.stringify(doc)))).toEqual(text(doc));
  });

  it('is much smaller than the in-memory form', () => {
    const doc = sample();
    doc.blocks.push(block(chars('a typical paragraph of prose that goes on for a while. '.repeat(10))));
    expect(serialize(doc).length).toBeLessThan(JSON.stringify(doc).length / 2);
  });
});

describe('lists in the file', () => {
  it('keep their kind and nesting', () => {
    const a = block(chars('one'), 'ol'), b = Object.assign(block(chars('two'), 'li'), { indent: 2 });
    const back = deserialize(serialize({ blocks: [a, b], arrows: [], marks: [] }));
    expect(back.blocks.map((x) => [x.kind, x.indent ?? 0])).toEqual([['ol', 0], ['li', 2]]);
  });
});
