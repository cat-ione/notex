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
  const [{ toCanvas, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const width = page.offsetWidth, total = Math.max(page.scrollHeight, page.offsetHeight);
  const ph = sheet.textHeight;
  const count = Math.max(1, Math.ceil((total - 2) / ph));
  progress?.({ count });
  const stop = () => {
    if (cancelled?.()) throw new DOMException('the PDF was cancelled', 'AbortError');
  };
  // (a few sheets at a time: a canvas can't be too tall)
  const per = Math.max(1, Math.floor(12000 / (ph * ratio)));
  const fontEmbedCSS = await getFontEmbedCSS(page);
  const pdf = new jsPDF({ unit: 'in', format: [sheet.w, sheet.h], orientation: sheet.w > sheet.h ? 'landscape' : 'portrait', compress: true });
  const writes = text && text.runs.length ? await textLayer(pdf, sheet, text) : null;
  const tw = sheet.w - 2 * sheet.margin, th = ph / 96;
  const sliceAt = document.createElement('canvas');
  sliceAt.width = Math.round(width * ratio);
  sliceAt.height = Math.round(ph * ratio);
  const sc = sliceAt.getContext('2d')!;
  const restore = inlineSvgStyles(page);
  const real = faithfulCopy();
  try {
    for (let first = 0; first < count; first += per) {
      const n = Math.min(per, count - first);
      // the part of the page these sheets show: moved up by whole pixels (a part of one puts
      // every box between pixels, where a box's line and corners come out with a seam; as does
      // a transform), the rest left over the top of the first
      const top = Math.floor(first * ph), over = first * ph - top;
      stop();
      progress?.({ drawing: Array.from({ length: n }, (_, k) => first + k) });
      const canvas = await toCanvas(page, {
        pixelRatio: ratio,
        width,
        height: Math.ceil(over + n * ph),
        backgroundColor: sheet.bg,
        fontEmbedCSS,
        style: { margin: `${-top}px 0 0 0` },
      });
      for (let k = 0; k < n; k++) {
        sc.fillStyle = sheet.bg;
        sc.fillRect(0, 0, sliceAt.width, sliceAt.height);
        sc.drawImage(canvas, 0, Math.round((over + k * ph) * ratio), sliceAt.width, sliceAt.height, 0, 0, sliceAt.width, sliceAt.height);
        if (first + k > 0) pdf.addPage([sheet.w, sheet.h], sheet.w > sheet.h ? 'landscape' : 'portrait');
        pdf.setFillColor(sheet.bg);
        pdf.rect(0, 0, sheet.w, sheet.h, 'F');
        pdf.addImage(sliceAt, 'PNG', sheet.margin, sheet.margin, tw, Math.min(th, sheet.h - 2 * sheet.margin), undefined, 'FAST');
        writes?.(first + k);
        if (progress) {
          const small = document.createElement('canvas');
          small.width = 240;
          small.height = Math.round((240 * sliceAt.height) / sliceAt.width);
          small.getContext('2d')!.drawImage(sliceAt, 0, 0, small.width, small.height);
          progress({ done: first + k, picture: small.toDataURL() });
          // (a moment for the screen to show it)
          await new Promise((r) => setTimeout(r, 0));
          stop();
        }
      }
    }
  } finally {
    real();
    restore();
  }
  return pdf.output('blob');
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
 * Returns what puts getComputedStyle back.
 */
function faithfulCopy(): () => void {
  const real = window.getComputedStyle;
  const px = (v: string) => parseFloat(v) || 0;
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const cs = real.call(window, el, pseudo);
    const whole = (t: CSSStyleDeclaration, v: string, a: string, b: string) =>
      `${px(v) + px(t.getPropertyValue(`padding-${a}`)) + px(t.getPropertyValue(`padding-${b}`)) + px(t.getPropertyValue(`border-${a}-width`)) + px(t.getPropertyValue(`border-${b}-width`))}px`;
    return new Proxy(cs, {
      get(t, k) {
        if (k === 'getPropertyValue')
          return (name: string) => {
            const v = t.getPropertyValue(name);
            if (name === 'font-size' && v.endsWith('px')) return `calc(${v})`;
            // (a border-box's sizes are already its whole size)
            if (!(el instanceof HTMLElement) || t.getPropertyValue('box-sizing') === 'border-box') return v;
            if (name === 'box-sizing') return 'border-box';
            if (/^(min-|max-)?height$/.test(name) && v.endsWith('px')) return whole(t, v, 'top', 'bottom');
            if (/^(min-|max-)?width$/.test(name) && v.endsWith('px')) return whole(t, v, 'left', 'right');
            return v;
          };
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }) as typeof window.getComputedStyle;
  return () => void (window.getComputedStyle = real);
}

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
