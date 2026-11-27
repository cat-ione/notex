// A PDF of the note made in the browser (where there's no printing straight to a file): the
// note laid out as it prints (see Editor.beginPrint), each sheet's worth of it drawn into an
// image, the images the PDF's pages. Its libraries are loaded only when it's wanted.

import mainFont from 'katex/dist/fonts/KaTeX_Main-Regular.ttf?url';
import mathFont from 'katex/dist/fonts/KaTeX_Math-Italic.ttf?url';
import amsFont from 'katex/dist/fonts/KaTeX_AMS-Regular.ttf?url';
import bigFont from 'katex/dist/fonts/KaTeX_Size1-Regular.ttf?url';

/** What a sheet is: its size and margin (inches), its text's height in CSS pixels, its colour. */
export type Sheet = { w: number; h: number; margin: number; textHeight: number; bg: string };

/**
 * How making a PDF is going, as it goes (to show it): how many sheets there will be, which
 * are being drawn now, and each as it's done, with a small picture of it.
 */
export type PdfProgress = { count: number } | { drawing: number[] } | { done: number; picture: string };

/**
 * A line of the note's text, where it is on the page laid out for paper (CSS px) and its size;
 * `xs`, where each of its characters starts (when known).
 */
export type PdfRun = { x: number; y: number; w: number; h: number; size: number; text: string; xs?: number[] };
/** A link's box (CSS px, as runs): a web address to open, or the y of what it goes to. */
export type PdfLink = { x: number; y: number; w: number; h: number; url?: string; to?: number };

/**
 * The page element, as laid out for print, as a PDF (pixels per CSS pixel: `ratio`).
 * `progress` hears how it's going; once `cancelled` says so, it stops (an AbortError).
 */
export async function pdfOf(
  page: HTMLElement,
  sheet: Sheet,
  {
    ratio = 2.5,
    progress,
    cancelled,
    text,
  }: { ratio?: number; progress?: (p: PdfProgress) => void; cancelled?: () => boolean; text?: { runs: PdfRun[]; links: PdfLink[] } } = {},
): Promise<Blob> {
  const [{ toSvg, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const width = page.offsetWidth, total = Math.max(page.scrollHeight, page.offsetHeight);
  const ph = sheet.textHeight;
  const count = Math.max(1, Math.ceil((total - 2) / ph));
  progress?.({ count });
  const stop = () => {
    if (cancelled?.()) throw new DOMException('the PDF was cancelled', 'AbortError');
  };
  const fontEmbedCSS = await getFontEmbedCSS(page);
  sheetImages(jsPDF);
  const pdf = new jsPDF({ unit: 'in', format: [sheet.w, sheet.h], orientation: sheet.w > sheet.h ? 'landscape' : 'portrait', compress: true });
  const writes = text && text.runs.length ? await textLayer(pdf, sheet, text) : null;
  const tw = sheet.w - 2 * sheet.margin, th = ph / 96;
  const sliceAt = document.createElement('canvas');
  sliceAt.width = Math.round(width * ratio);
  sliceAt.height = Math.round(ph * ratio);
  const sc = sliceAt.getContext('2d')!;
  const restore = inlineSvgStyles(page);
  const real = faithfulCopy(page);
  try {
    stop();
    progress?.({ drawing: Array.from({ length: count }, (_, k) => k) });
    // the page copied once, as a picture of it all (copying it is most of the work: a part
    // copied for each few sheets made a long note take as long as the square of its length)
    const svg = await toSvg(page, { width, height: total, fontEmbedCSS, includeStyleProperties: PAPER_STYLES, style: { margin: '0' } });
    const img = new Image();
    img.src = svg;
    await img.decode();
    stop();
    for (let k = 0; k < count; k++) {
      // the part of the picture this sheet shows, from a whole pixel (a part of one puts every
      // box between pixels, where a box's line and corners come out with a seam), the rest
      // left over its top
      const top = Math.floor(k * ph), over = k * ph - top;
      sc.fillStyle = sheet.bg;
      sc.fillRect(0, 0, sliceAt.width, sliceAt.height);
      sc.drawImage(img, 0, top, width, Math.ceil(over + ph), 0, -Math.round(over * ratio), sliceAt.width, Math.ceil(over + ph) * ratio);
      if (k > 0) pdf.addPage([sheet.w, sheet.h], sheet.w > sheet.h ? 'landscape' : 'portrait');
      pdf.setFillColor(sheet.bg);
      pdf.rect(0, 0, sheet.w, sheet.h, 'F');
      pdf.addImage(await sheetImage(sc, `nx-sheet-${k}`), 'NXSHEET', sheet.margin, sheet.margin, tw, Math.min(th, sheet.h - 2 * sheet.margin), `nx-sheet-${k}`);
      writes?.(k);
      if (progress) {
        const small = document.createElement('canvas');
        small.width = 240;
        small.height = Math.round((240 * sliceAt.height) / sliceAt.width);
        small.getContext('2d')!.drawImage(sliceAt, 0, 0, small.width, small.height);
        progress({ done: k, picture: small.toDataURL() });
        // (a moment for the screen to show it)
        await new Promise((r) => setTimeout(r, 0));
        stop();
      }
    }
  } finally {
    real();
    restore();
  }
  return pdf.output('blob');
}

/** The sheets' pictures waiting for jsPDF to take them, by name, with their sizes. */
const waiting = new Map<string, { w: number; h: number }>();

/**
 * A sheet's picture as the PDF keeps it: its pixels' colours, deflated by the browser, which
 * jsPDF takes as they are (an image type of its own, NXSHEET). Given a canvas, jsPDF would
 * make a PNG of it, read that back in JavaScript and deflate it again, with a mask for the
 * see-through parts it hasn't (a fifth of the time a PDF took); this is a third of that.
 */
async function sheetImage(c: CanvasRenderingContext2D, name: string): Promise<Uint8Array> {
  const { width: w, height: h } = c.canvas;
  const px = c.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i];
    rgb[j + 1] = px[i + 1];
    rgb[j + 2] = px[i + 2];
  }
  waiting.set(name, { w, h });
  return new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/** Teach jsPDF the NXSHEET image type (see sheetImage). */
function sheetImages(jsPDF: typeof import('jspdf').jsPDF) {
  (jsPDF.API as unknown as Record<string, unknown>).processNXSHEET = (data: Uint8Array, index: number, alias: string) => {
    const size = waiting.get(alias)!;
    waiting.delete(alias);
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { data: bin, filter: 'FlateDecode', colorSpace: 'DeviceRGB', bitsPerComponent: 8, width: size.w, height: size.h, index, alias };
  };
}

/**
 * html-to-image copies each element's computed styles onto its copy, which is laid out again
 * inside an image, and that copy must come out where the original is (the drawings are placed
 * by the original). Two things move it, so while it copies, getComputedStyle answers otherwise:
 *
 * - A font size in pixels it rounds down and takes 0.1px off (17.92px comes out 16.9px): the
 *   text narrower, its lines wrapping elsewhere. A font size reads as `calc(…px)`, left alone.
 * - Borders are a whole number of device pixels, and the copy isn't laid out at the screen's
 *   pixel ratio: a border comes out a little thicker or thinner, and everything after it moves
 *   (a pixel or so for each, adding up down a sheet). Every box reads as its whole size
 *   (`border-box`), so a border that differs moves only what's inside its own box, a little.
 *
 * And a property an element's copy would have anyway reads as nothing, so it isn't written
 * (most of them, most places: the copy a tenth the size, quicker to make and to draw). That is
 * one as an element of its kind has it with no stylesheet (`fresh`) and as its parent has it:
 * so the same whether it's inherited or not. Not sizes, nor the copy's root, nor `::before`
 * and `::after`, which always say all.
 *
 * Returns what puts getComputedStyle back.
 */
function faithfulCopy(root: HTMLElement): () => void {
  const real = window.getComputedStyle;
  const px = (v: string) => parseFloat(v) || 0;
  // elements with no stylesheet, as the copy's are without what's written on them
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 800px; height: 600px; border: 0; visibility: hidden';
  document.body.appendChild(frame);
  const blank = frame.contentDocument!;
  blank.open();
  blank.write('<!doctype html><html><head></head><body></body></html>');
  blank.close();
  const fresh = new Map<string, { cs: CSSStyleDeclaration; vs: Map<string, string> }>();
  const freshOf = (el: Element) => {
    // (its attributes too, but its own style: a link with an address is a link, a hidden one hidden)
    const attrs = [...el.attributes].filter((a) => a.name !== 'style' && a.name !== 'class' && a.name !== 'id' && !a.name.startsWith('data-'));
    const key = `${el.namespaceURI} ${el.localName} ${attrs.map((a) => (a.name === 'type' ? `${a.name}=${a.value}` : a.name)).join(' ')}`;
    let r = fresh.get(key);
    if (!r) {
      const f = blank.createElementNS(el.namespaceURI, el.localName);
      for (const a of attrs) f.setAttribute(a.name, a.value);
      blank.body.appendChild(f);
      fresh.set(key, (r = { cs: frame.contentWindow!.getComputedStyle(f), vs: new Map() }));
    }
    const { cs, vs } = r;
    return (name: string) => {
      let v = vs.get(name);
      if (v === undefined) vs.set(name, (v = cs.getPropertyValue(name)));
      return v;
    };
  };
  // each element's own values, as read (a parent's are asked for by each of its children)
  const read = new Map<Element, { cs: CSSStyleDeclaration; vs: Map<string, string> }>();
  const own = (el: Element, name: string) => {
    let r = read.get(el);
    if (!r) read.set(el, (r = { cs: real.call(window, el), vs: new Map() }));
    let v = r.vs.get(name);
    if (v === undefined) r.vs.set(name, (v = r.cs.getPropertyValue(name)));
    return v;
  };
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const cs = real.call(window, el, pseudo);
    const whole = (t: CSSStyleDeclaration, v: string, a: string, b: string) =>
      `${px(v) + px(t.getPropertyValue(`padding-${a}`)) + px(t.getPropertyValue(`padding-${b}`)) + px(t.getPropertyValue(`border-${a}-width`)) + px(t.getPropertyValue(`border-${b}-width`))}px`;
    const parent = !pseudo && el !== root ? el.parentElement : null;
    // (a border-box's sizes are already its whole size; asked once, not for every property)
    let sized: boolean | undefined;
    let base: ((name: string) => string) | undefined;
    const value = (name: string) => {
      const v = parent ? own(el, name) : cs.getPropertyValue(name);
      if (parent && !SIZES.has(name) && v === own(parent, name) && v === (base ??= freshOf(el))(name)) return '';
      if (name === 'font-size' && v.endsWith('px')) return `calc(${v})`;
      if ((sized ??= !(el instanceof HTMLElement) || cs.getPropertyValue('box-sizing') === 'border-box')) return v;
      if (name === 'box-sizing') return 'border-box';
      if (/^(min-|max-)?height$/.test(name) && v.endsWith('px')) return whole(cs, v, 'top', 'bottom');
      if (/^(min-|max-)?width$/.test(name) && v.endsWith('px')) return whole(cs, v, 'left', 'right');
      return v;
    };
    return new Proxy(cs, {
      get(t, k) {
        if (k === 'getPropertyValue') return value;
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }) as typeof window.getComputedStyle;
  return () => {
    window.getComputedStyle = real;
    frame.remove();
  };
}

/** Properties always written on a copy (see faithfulCopy): what it's laid out by, and what's changed. */
const SIZES = new Set(['box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'font-size', 'display', 'position']);

/** What the PDF's own Helvetica can write (WinAnsi: Latin-1, and curly quotes, dashes, a bullet…). */
const WIN_ANSI = new Set([...Array.from({ length: 95 }, (_, i) => 32 + i), ...Array.from({ length: 96 }, (_, i) => 160 + i), ...[...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!)]);
/** Fonts for the rest, tried in turn: arrows and relations, Greek, more symbols, big operators. */
const MORE_FONTS = [mainFont, mathFont, amsFont, bigFont];

/**
 * The text over the pictures: each run written where it shows, invisible (as a scanned page's
 * recognised text is), stretched to the width it has on the page, so it can be selected,
 * copied and searched; and the links' boxes. Returns what writes sheet `i`'s, on its page.
 * Helvetica writes what it can; KaTeX's fonts, put in only when wanted, what it can't (π, →, ∫).
 */
async function textLayer(pdf: import('jspdf').jsPDF, sheet: Sheet, { runs, links }: { runs: PdfRun[]; links: PdfLink[] }) {
  // the fonts the characters it can't write need, in turn
  const fonts: { name: string; has: (cp: number) => boolean }[] = [];
  let wanting = new Set<number>();
  for (const r of runs) for (const c of r.text) if (!WIN_ANSI.has(c.codePointAt(0)!)) wanting.add(c.codePointAt(0)!);
  for (let k = 0; k < MORE_FONTS.length && wanting.size; k++) {
    const bytes = new Uint8Array(await (await fetch(MORE_FONTS[k])).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const name = `nx-text-${k}`;
    pdf.addFileToVFS(`${name}.ttf`, btoa(bin));
    pdf.addFont(`${name}.ttf`, name, 'normal');
    pdf.setFont(name, 'normal');
    const meta = (pdf.getFont() as unknown as { metadata: { characterToGlyph: (cp: number) => number } }).metadata;
    const has = (cp: number) => meta.characterToGlyph(cp) > 0;
    if ([...wanting].some(has)) fonts.push({ name, has });
    wanting = new Set([...wanting].filter((cp) => !has(cp)));
  }
  const fontOf = (c: string) => {
    const cp = c.codePointAt(0)!;
    return WIN_ANSI.has(cp) ? 'helvetica' : (fonts.find((f) => f.has(cp))?.name ?? null);
  };
  const ph = sheet.textHeight, m = sheet.margin;
  const sheetOf = (y: number) => Math.floor(y / ph);
  return (i: number) => {
    for (const r of runs) {
      if (sheetOf(r.y + r.h / 2) !== i) continue;
      pdf.setFontSize(r.size * 0.75);
      // the run in pieces of one font each (a character no font has is left out)
      const chars = [...r.text];
      const pieces: { font: string; from: number; to: number; natural: number }[] = [];
      chars.forEach((c, k) => {
        const font = fontOf(c), last = pieces[pieces.length - 1];
        if (!font) return;
        if (last && last.font === font && last.to === k) last.to = k + 1;
        else pieces.push({ font, from: k, to: k + 1, natural: 0 });
      });
      for (const p of pieces) {
        pdf.setFont(p.font, 'normal');
        p.natural = pdf.getTextWidth(chars.slice(p.from, p.to).join(''));
      }
      // where each piece starts and ends: its characters' places, or shared out by width
      const total = pieces.reduce((a, p) => a + p.natural, 0);
      let shared = r.x;
      for (const p of pieces) {
        const left = r.xs?.[p.from] ?? shared;
        const right = r.xs ? (r.xs[p.to] ?? r.x + r.w) : shared + (total ? (p.natural / total) * r.w : 0);
        shared = right;
        if (!p.natural || right <= left) continue;
        pdf.setFont(p.font, 'normal');
        // (the baseline a third of the text's size under its box's middle: a line's, or a tall formula's)
        pdf.text(chars.slice(p.from, p.to).join(''), m + left / 96, m + (r.y - i * ph + r.h / 2 + r.size * 0.32) / 96, { renderingMode: 'invisible', horizontalScale: (right - left) / 96 / p.natural });
      }
    }
    for (const l of links) {
      if (sheetOf(l.y + l.h / 2) !== i) continue;
      const [x, y, w, h] = [m + l.x / 96, m + (l.y - i * ph) / 96, l.w / 96, l.h / 96];
      if (l.url) pdf.link(x, y, w, h, { url: l.url });
      else if (l.to !== undefined) pdf.link(x, y, w, h, { pageNumber: sheetOf(l.to) + 1, magFactor: 'XYZ', top: m + (l.to - sheetOf(l.to) * ph) / 96 });
    }
  };
}

/**
 * The CSS properties copied onto each element of the page's copy (html-to-image copies every
 * one there is otherwise, some 500, nearly all left as they start: most of the time a PDF takes
 * is that). Those that change how the page looks, each side's of its own (not the logical
 * `inline`/`block` ones, which say the same); not those that say nothing a picture shows
 * (cursor, selection, transitions), nor the theme's variables (a value has them filled in).
 * A browser test (pdfpages) checks the paper layout uses none that's left out.
 */
export const PAPER_STYLES = [
  // the box and where it goes
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow-x', 'overflow-y', 'overflow-clip-margin', 'vertical-align', 'isolation', 'contain', 'content-visibility', 'zoom',
  'transform', 'transform-origin', 'translate', 'rotate', 'scale', 'perspective', 'transform-style', 'writing-mode', 'direction', 'unicode-bidi',
  // flex, grid, table, columns, lists
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'align-items', 'align-self', 'align-content', 'justify-content', 'justify-items', 'justify-self', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'column-count', 'column-width',
  'list-style-type', 'list-style-position', 'list-style-image', 'content', 'quotes', 'counter-reset', 'counter-increment', 'counter-set',
  // how the box looks
  'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-clip',
  'background-origin', 'background-attachment', 'background-blend-mode',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat',
  'box-shadow', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'opacity', 'visibility', 'filter', 'backdrop-filter', 'mix-blend-mode', 'clip-path', 'mask-image', 'object-fit', 'object-position', 'image-rendering',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'color-scheme',
  // text
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-size-adjust', 'font-kerning', 'font-optical-sizing',
  'font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-position', 'font-variant-alternates',
  'font-feature-settings', 'font-variation-settings', 'font-synthesis-weight', 'font-synthesis-style', '-webkit-locale',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-align-last', 'text-indent', 'text-transform', 'text-shadow',
  'text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset', 'text-underline-position',
  'white-space-collapse', 'text-wrap-mode', 'text-wrap-style', 'word-break', 'overflow-wrap', 'line-break', 'hyphens', 'tab-size', 'text-overflow',
  'text-rendering', '-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color',
];

/** What decides how an SVG's shapes look. */
const SVG_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'display', 'visibility', 'filter', 'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-anchor', 'dominant-baseline',
];

/**
 * An SVG is copied for its image whole, without the page's stylesheet, so its shapes (and
 * the labels in them) would lose their colours: their styles, as they are, written on them
 * for the while. Returns what puts them back.
 */
function inlineSvgStyles(page: HTMLElement): () => void {
  const was: [Element, string | null][] = [];
  // (all read before any is written: a style holds the colours its insides read)
  const css = [...page.querySelectorAll('svg *')].map((el) => {
    const cs = getComputedStyle(el);
    const props = el instanceof SVGElement ? SVG_PROPS : Array.from(cs);
    return [el, props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')] as const;
  });
  for (const [el, s] of css) {
    was.push([el, el.getAttribute('style')]);
    el.setAttribute('style', s);
  }
  return () => {
    for (const [el, s] of was) s === null ? el.removeAttribute('style') : el.setAttribute('style', s);
  };
}

/** A colour as `#rrggbb` (jsPDF reads no other kind), via the browser's own reading of it. */
export function hexColour(css: string): string {
  const c = document.createElement('canvas').getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillStyle = css;
  const v = c.fillStyle;
  if (v.startsWith('#')) return v;
  // (rgba(…) for a see-through one: its colour, on white)
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return '#ffffff';
  const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
  const mix = (x: number) => Math.round(x * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return '#' + mix(r) + mix(g) + mix(b);
}
