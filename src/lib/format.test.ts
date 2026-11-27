import { describe, expect, it } from 'vitest';
import { decode, deserialize, encode, serialize, type FileParts } from './format';
import { block, chars, cmd, math, sym, type Doc } from './model';
import { boxShape, inkShape } from './sketch/shapes';

function sample(): Doc {
  const frac = cmd('frac', [[sym('a')], [sym('b')]]);
  const m = math([sym('x'), sym('='), frac]);
  const b0 = block([...chars('see '), m, ...chars(' here')]);
  const b1 = block(chars('## second'), 'h2');
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
    // (a heading is its text: the kind is read from it)
    expect(f.blocks[1]).toEqual({ kind: 'p', content: ['## second'] });
  });

  it('writes the same file when blocks it has written before are reused, and writes anew a block that changed', () => {
    const doc = sample();
    const parts: FileParts = new WeakMap();
    const first = serialize(doc, parts);
    expect(first).toBe(serialize(doc));
    // the same blocks again (as autosave's snapshots share unchanged blocks): their parts reused
    const again = encode(doc, parts);
    expect(again.blocks[0]).toBe(encode(doc, parts).blocks[0]);
    // a changed block is a new block (snapshots are never changed in place): written anew,
    // and the arrows to the characters after it still find them
    const b0 = doc.blocks[0];
    const changed: Doc = { ...doc, blocks: [{ ...b0, items: [...chars('>> '), ...b0.items] }, ...doc.blocks.slice(1)] };
    expect(serialize(changed, parts)).toBe(serialize(changed));
    expect(encode(changed, parts).arrows[0].to).toEqual(['c0.9', 'c0.10', 'c0.11', 'c0.12']);
  });

  it('round-trips text and math', () => {
    const doc = sample();
    const back = deserialize(serialize(doc));
    expect(text(back)).toEqual(text(doc));
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
  it('keep their boxes to tick, ticked or not', () => {
    const a = Object.assign(block(chars('milk'), 'li'), { check: false }), b = Object.assign(block(chars('eggs'), 'li'), { check: true });
    const back = deserialize(serialize({ blocks: [a, b, block(chars('plain'), 'li')], arrows: [], marks: [] }));
    expect(back.blocks.map((x) => x.check)).toEqual([false, true, undefined]);
  });
});

describe('boxes, numbered formulas and references', () => {
  it('keep their kind, their box and its id, a folded heading, a formula number and a reference', () => {
    const eq = Object.assign(math([sym('E')], true), { num: true as const });
    const ref = math([{ k: 'sym', id: 'r1', v: '(1)', ref: eq.id }]);
    const t1 = Object.assign(block(chars('Let x.')), { box: { k: 'theorem' as const, id: 'bx1' } });
    const t2 = Object.assign(block(chars('Then y.')), { box: { k: 'theorem' as const, id: 'bx1' } });
    const h = Object.assign(block(chars('# A')), { fold: true as const });
    const back = deserialize(serialize({ blocks: [h, t1, t2, block([eq]), block([...chars('by '), ref])], arrows: [], marks: [] }));
    expect(back.blocks[0].fold).toBe(true);
    expect(back.blocks.slice(1, 3).map((b) => b.box)).toEqual([{ k: 'theorem', id: 'bx1' }, { k: 'theorem', id: 'bx1' }]);
    expect(back.blocks[3].items[0]).toMatchObject({ t: 'm', display: true, num: true, id: eq.id });
    expect(back.blocks[4].items[3]).toMatchObject({ t: 'm', root: [{ ref: eq.id, v: '(1)' }] });
  });
});

describe('notes from before the markdown was text', () => {
  const v1 = (blocks: unknown[]) => JSON.stringify({ format: 'notex', version: 1, blocks, arrows: [] });
  it('get markers for their styles', () => {
    const back = deserialize(v1([{ kind: 'p', content: ['plain ', { s: 'bold', b: 1 }, ' and ', { s: 'it ', i: 1 }, { s: 'x`y', c: 1 }] }]));
    expect(text(back)).toEqual(['plain **bold** and *it* ``x`y``']);
  });
  it('get #s for their headings and fences for their code', () => {
    const back = deserialize(v1([
      { kind: 'h2', content: ['Title'] },
      { kind: 'code', lang: 'py', content: ['x = 1'] },
      { kind: 'code', content: ['  y'] },
      { kind: 'p', content: ['after'] },
    ]));
    expect(text(back)).toEqual(['## Title', '```py', 'x = 1', '  y', '```', 'after']);
  });
  it('keep their drawings on the same characters', () => {
    const f = { format: 'notex', version: 1, blocks: [{ kind: 'p', content: ['a ', { s: 'bold', b: 1 }] }], arrows: [], marks: [{ kind: 'circle', at: ['c0.2', 'c0.5'], dash: false, label: '' }] };
    const back = deserialize(JSON.stringify(f));
    const items = back.blocks[0].items;
    expect(back.marks[0].at).toEqual([items[4].id, items[7].id]); // b and d, past the opening **
  });
  it('are left alone once they are markdown', () => {
    const doc = sample();
    expect(text(deserialize(serialize(deserialize(serialize(doc)))))).toEqual(text(doc));
  });
});

describe('images', () => {
  it('keep their picture, width and caption', () => {
    const img = Object.assign(block(chars('Fig. 1'), 'img'), { src: 'data:image/png;base64,AAAA', w: 320 });
    const back = decode(encode({ blocks: [img], arrows: [], marks: [] }));
    expect(back.blocks[0]).toMatchObject({ kind: 'img', src: 'data:image/png;base64,AAAA', w: 320 });
    expect(back.blocks[0].items.length).toBe(6);
  });
});

describe('diagrams and drawing on the note', () => {
  const diagramDoc = (): Doc => {
    const p = block(chars('above'));
    const d = Object.assign(block(chars('fig 1'), 'diagram'), {
      w: 600,
      h: 300,
      shapes: [
        boxShape('rect', { x: 10, y: 10, w: 100, h: 50 }, { label: '$x^2$' }),
        inkShape([0, 0, 0.4, 10, 12, 0.8], true, { color: 'red' }),
      ],
    });
    const after = block(chars('below'));
    return { blocks: [p, d, after], arrows: [], marks: [], ink: [{ ...inkShape([1, 2, 0.5, 3, 4, 0.5], false), at: after.id }] };
  };

  it('a diagram keeps its shapes, size and caption', () => {
    const back = deserialize(serialize(diagramDoc()));
    const d = back.blocks[1];
    expect(d.kind).toBe('diagram');
    expect(d).toMatchObject({ w: 600, h: 300 });
    expect(d.shapes).toHaveLength(2);
    expect(d.shapes![0]).toMatchObject({ k: 'rect', label: '$x^2$' });
    expect(d.shapes![1]).toMatchObject({ k: 'ink', pen: true, color: 'red' });
    expect(text(back)[1]).toBe('fig 1');
  });

  it('what is drawn on the note stays pinned to its block', () => {
    const doc = diagramDoc();
    const f = encode(doc);
    expect(f.ink![0].at).toBe('b2');
    const back = decode(f);
    expect(back.ink).toHaveLength(1);
    expect(back.ink![0].at).toBe(back.blocks[2].id);
    expect(back.ink![0]).toMatchObject({ k: 'ink', pts: [1, 2, 0.5, 3, 4, 0.5] });
  });

  it('a drawing whose block is gone is not saved; a note without drawings has no ink', () => {
    const doc = diagramDoc();
    doc.ink![0].at = 'nowhere';
    expect(encode(doc).ink).toBeUndefined();
    expect(decode(encode(sample())).ink).toBeUndefined();
  });
});
