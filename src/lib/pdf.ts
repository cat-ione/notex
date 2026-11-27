// A PDF of the note made in the browser (where there's no printing straight to a file): the
// note laid out as it prints (see Editor.beginPrint), each sheet's worth of it drawn into an
// image, the images the PDF's pages. Its libraries are loaded only when it's wanted.

/** What a sheet is: its size and margin (inches), its text's height in CSS pixels, its colour. */
export type Sheet = { w: number; h: number; margin: number; textHeight: number; bg: string };

/**
 * How making a PDF is going, as it goes (to show it): how many sheets there will be, which
 * are being drawn now, and each as it's done, with a small picture of it.
 */
export type PdfProgress = { count: number } | { drawing: number[] } | { done: number; picture: string };

/**
 * The page element, as laid out for print, as a PDF (pixels per CSS pixel: `ratio`).
 * `progress` hears how it's going; once `cancelled` says so, it stops (an AbortError).
 */
export async function pdfOf(
  page: HTMLElement,
  sheet: Sheet,
  { ratio = 2.5, progress, cancelled }: { ratio?: number; progress?: (p: PdfProgress) => void; cancelled?: () => boolean } = {},
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
