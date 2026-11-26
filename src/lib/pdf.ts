// A PDF of the note made in the browser (where there's no printing straight to a file): the
// note laid out as it prints (see Editor.beginPrint), each sheet's worth of it drawn into an
// image, the images the PDF's pages. Its libraries are loaded only when it's wanted.

/** What a sheet is: its size and margin (inches), its text's height in CSS pixels, its colour. */
export type Sheet = { w: number; h: number; margin: number; textHeight: number; bg: string };

/** The page element, as laid out for print, as a PDF (pixels per CSS pixel: `ratio`). */
export async function pdfOf(page: HTMLElement, sheet: Sheet, ratio = 2.5): Promise<Blob> {
  const [{ toCanvas, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const width = page.offsetWidth, total = Math.max(page.scrollHeight, page.offsetHeight);
  const ph = sheet.textHeight;
  const count = Math.max(1, Math.ceil((total - 2) / ph));
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
  try {
    for (let first = 0; first < count; first += per) {
      const n = Math.min(per, count - first);
      const canvas = await toCanvas(page, {
        pixelRatio: ratio,
        width,
        height: n * ph,
        backgroundColor: sheet.bg,
        fontEmbedCSS,
        // (the part of the page these sheets show)
        style: { transform: `translateY(${-first * ph}px)`, transformOrigin: '0 0', margin: '0' },
      });
      for (let k = 0; k < n; k++) {
        sc.fillStyle = sheet.bg;
        sc.fillRect(0, 0, sliceAt.width, sliceAt.height);
        sc.drawImage(canvas, 0, Math.round(k * ph * ratio), sliceAt.width, sliceAt.height, 0, 0, sliceAt.width, sliceAt.height);
        if (first + k > 0) pdf.addPage([sheet.w, sheet.h], sheet.w > sheet.h ? 'landscape' : 'portrait');
        pdf.setFillColor(sheet.bg);
        pdf.rect(0, 0, sheet.w, sheet.h, 'F');
        pdf.addImage(sliceAt, 'PNG', sheet.margin, sheet.margin, tw, Math.min(th, sheet.h - 2 * sheet.margin), undefined, 'FAST');
      }
    }
  } finally {
    restore();
  }
  return pdf.output('blob');
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
