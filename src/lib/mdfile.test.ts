import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc } from './mdfile';
import { block, chars, math, sym, type Doc } from './model';
import { toLatex } from './math/latex';
import { structureTables } from './tables';

const doc = (blocks: Doc['blocks']): Doc => ({ blocks, arrows: [], marks: [] });
const md = (d: Doc) => docToMarkdown(d).text;
/** Each block as kind: text (formulas as $…$). */
const shape = (d: Doc) =>
  d.blocks.map((b) => {
    const t = b.items.map((i) => (i.t === 'c' ? i.ch : `$${toLatex(i.root).replace(/\s+/g, '')}$`)).join('');
    return `${b.kind}${b.indent ? ':' + b.indent : ''}${b.check !== undefined ? (b.check ? '[x]' : '[ ]') : ''}${b.box ? '{' + b.box.k + '}' : ''} ${t}`.trim();
  });

describe('a note as markdown', () => {
  it('its text as it is (markdown already), paragraphs apart, list items together', () => {
    const d = doc([block(chars('# Title')), block(chars('some **bold** text')), block(chars('one'), 'li'), Object.assign(block(chars('two'), 'li'), { indent: 1 }), block(chars('first'), 'ol'), block(chars('second'), 'ol')]);
    expect(md(d)).toBe('# Title\n\nsome **bold** text\n\n- one\n  - two\n1. first\n2. second\n');
  });
  it('formulas in dollars, a numbered display formula with its \\tag', () => {
    const eq = Object.assign(math([sym('E')], true), { num: true as const });
    const d = doc([block([...chars('so '), math([sym('x'), sym('+'), sym('1')]), ...chars('.')]), block([eq]), block([math([sym('F')], true)])]);
    expect(md(d)).toBe('so $x+1$.\n\n$$\nE \\tag{1}\n$$\n\n$$\nF\n$$\n');
  });
  it('boxes to tick as - [ ] and - [x]', () => {
    const d = doc([Object.assign(block(chars('milk'), 'li'), { check: false }), Object.assign(block(chars('eggs'), 'li'), { check: true })]);
    expect(md(d)).toBe('- [ ] milk\n- [x] eggs\n');
  });
  it('a theorem as a callout, a quote as >, a paragraph after it apart', () => {
    const t = { k: 'theorem' as const, id: 't' }, q = { k: 'quote' as const, id: 'q' };
    const d = doc([Object.assign(block(chars('Let x.')), { box: t }), Object.assign(block(chars('Then y.')), { box: t }), Object.assign(block(chars('said')), { box: q }), block(chars('after'))]);
    expect(md(d)).toBe('> [!theorem]\n> Let x.\n>\n> Then y.\n\n> said\n\nafter\n');
  });
  it('a table with its separator line; an image inline; a diagram left out (and counted)', () => {
    const rows = structureTables([block(chars('| a | b |')), block(chars('| --: | --- |')), block(chars('| 1 | 2 |'))]);
    const img = Object.assign(block(chars('a cat'), 'img'), { src: 'data:image/png;base64,AAA' });
    const dia = Object.assign(block([], 'diagram'), { shapes: [], h: 200 });
    const r = docToMarkdown(doc([...rows, img, dia]));
    expect(r.text).toBe('| a | b |\n| --: | --- |\n| 1 | 2 |\n\n![a cat](data:image/png;base64,AAA)\n\n<!-- a diagram: not in markdown -->\n');
    expect(r.lost).toBe(1);
  });
  it('drawings are counted as left out', () => {
    const b0 = block(chars('ab'));
    const d: Doc = { blocks: [b0], arrows: [{ id: 'a', from: [b0.items[0].id], to: [b0.items[1].id], bend: 0, head: 'end', dash: false, boxed: false, label: '' }], marks: [] };
    expect(docToMarkdown(d).lost).toBe(1);
  });
});

describe('a markdown file as a note', () => {
  it('headings, paragraphs, lists (nested), boxes to tick and inline math', () => {
    const d = markdownToDoc('# Title\n\nSome $x^2$ text\nnext line\n\n- one\n  - two\n- [ ] milk\n- [x] eggs\n1. first\n');
    // (headings and code are read from the text when the note opens: see Editor.derive)
    expect(shape(d)).toEqual(['p # Title', 'p Some $x^{2}$ text', 'p next line', 'li one', 'li:1 two', 'li[ ] milk', 'li[x] eggs', 'ol first']);
  });
  it('display formulas, on a line or over several; \\tag numbers one', () => {
    const d = markdownToDoc('$$E=mc^2$$\n\n$$\n\\int f \\tag{3}\n$$\nafter');
    expect(shape(d)).toEqual(['p $E=mc^{2}$', 'p $\\intf$', 'p after']);
    expect(d.blocks.map((b) => b.items[0]?.t === 'm' && !!b.items[0].num)).toEqual([false, true, false]);
  });
  it('callouts as boxes (Obsidian’s own types as the nearest), quotes as quotes, a title as a name', () => {
    const d = markdownToDoc('> [!theorem] Fermat\n> No solutions.\n> - for n > 2\n\n> [!note]\n> careful\n\n> said\n> more');
    expect(shape(d)).toEqual(['p{theorem} (Fermat) No solutions.', 'li{theorem} for n > 2', 'p{remark} careful', 'p{quote} said', 'p{quote} more']);
    const ids = d.blocks.map((b) => b.box!.id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[3]).toBe(ids[4]);
    expect(new Set(ids).size).toBe(3);
  });
  it('code blocks as they are; tables as tables; images', () => {
    const d = markdownToDoc('```python\nx = 1  # $no math$\n```\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n![cap](https://x.y/i.png)');
    expect(d.blocks.map((b) => b.kind)).toEqual(['p', 'p', 'p', 'tr', 'tr', 'img']);
    expect(d.blocks[1].items.map((i) => (i.t === 'c' ? i.ch : '?')).join('')).toBe('x = 1  # $no math$');
    expect(d.blocks[3].aligns).toEqual([null, 'right']);
    expect(d.blocks[5].src).toBe('https://x.y/i.png');
  });
  it('a note written out and read back is the same note', () => {
    const t = { k: 'definition' as const, id: 'd' };
    const eq = Object.assign(math([sym('a'), sym('='), sym('b')], true), { num: true as const });
    const d = doc([
      block(chars('## Notes')),
      Object.assign(block(chars('A group is a set.')), { box: t }),
      Object.assign(block(chars('with an operation')), { box: t }),
      block([eq]),
      Object.assign(block(chars('done'), 'li'), { check: true }),
      block(chars('the ~~end~~ ==end==')),
    ]);
    const back = markdownToDoc(md(d));
    expect(shape(back)).toEqual(shape(d));
    expect(back.blocks[3].items[0]).toMatchObject({ display: true, num: true });
  });
});
