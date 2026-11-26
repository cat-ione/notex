// DOM measurement helpers. KaTeX output contains invisible positioning spans
// (struts) with large heights, so we measure the ink: text runs, svgs and rules.

export type Rect = { x: number; y: number; w: number; h: number };

export const union = (rs: Rect[]): Rect | null => {
  if (!rs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const fromDOM = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const INK = 'svg, .frac-line, .rule, .overline-line, .underline-line, .hline';

/**
 * One Range for all measuring. The browser keeps every live Range up to date on
 * each DOM change until it is garbage collected, so creating one per measurement
 * (thousands in a long note) makes later edits crawl. Collapse it after use.
 */
let shared: Range | null = null;
export function sharedRange(): Range {
  return (shared ??= document.createRange());
}
export function releaseRange() {
  shared?.collapse(true);
  shared?.setStart(document, 0);
}

/** The individual ink boxes inside an element (viewport coords): text runs, svgs and rules. */
export function inkRects(el: Element): Rect[] {
  const rects: Rect[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const range = sharedRange();
  let n: Node | null = walker.currentNode;
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) {
      // (line spacers hold an invisible word joiner; they are not ink)
      if (n.textContent && n.textContent.trim() && !n.parentElement?.classList.contains('nx-sp')) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width || r.height) rects.push(fromDOM(r));
      }
    } else if ((n as Element).matches?.(INK)) {
      const r = (n as Element).getBoundingClientRect();
      if (r.width || r.height) rects.push(fromDOM(r));
    }
    n = walker.nextNode();
  }
  releaseRange();
  return rects;
}

/** Tight bounding box of the visible content of an element (viewport coords). */
export function measure(el: Element): Rect | null {
  const rects = inkRects(el);
  if (!rects.length) {
    const r = el.getBoundingClientRect();
    return r.width || r.height ? fromDOM(r) : { x: r.left, y: r.top, w: 0, h: r.height || 16 };
  }
  return union(rects);
}

export const relTo = (r: Rect, origin: DOMRect): Rect => ({ x: r.x - origin.left, y: r.y - origin.top, w: r.w, h: r.h });

export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

/** Group rects by visual line (a rect whose vertical centre falls inside one of a line's rects joins it). */
export function lineGroups(rs: Rect[]): Rect[][] {
  const lines: Rect[][] = [];
  for (const r of [...rs].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = r.y + r.h / 2;
    const line = lines.find((l) => l.some((q) => cy >= q.y && cy <= q.y + q.h));
    if (line) line.push(r);
    else lines.push([r]);
  }
  return lines;
}

/** Merge rects into one rect per visual line. */
export const byLine = (rs: Rect[]): Rect[] => lineGroups(rs).map((l) => union(l)!);

/**
 * Did the mouse itself move (not the list under it: the browser also sends a move, or an
 * enter, when a menu opens or scrolls under a still mouse)? For hovering a menu's items.
 */
let lastMouse = { x: NaN, y: NaN };
export function mouseMoved(e: MouseEvent): boolean {
  if (e.screenX === lastMouse.x && e.screenY === lastMouse.y) return false;
  lastMouse = { x: e.screenX, y: e.screenY };
  return true;
}
