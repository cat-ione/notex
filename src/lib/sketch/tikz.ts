// A diagram as TikZ: its shapes in a tikzpicture as wide as the text (the diagram was as wide
// as the page's text), y going down as on the page.

import { centre, inkPoints, lineEnds, lookupIn, simplify, type Shape } from './shapes';
import { parsePlot, plotGeometry } from './plot';

/** A graph's curve colours, as the page has them (the graph's own first). */
const CURVES = ['blue', 'red', 'green!50!black', 'violet', 'cyan!60!black'];
/** A tick label as LaTeX: its minus and its π. */
const tickTex = (l: string) => (/[−π]/.test(l) ? `$${l.replace(/−/g, '-').replace(/π/g, '\\pi')}$` : l);

const n = (v: number) => String(Math.round(v * 10) / 10);
const pt = (x: number, y: number) => `(${n(x)},${n(y)})`;
const WIDTH = ['thin', 'semithick', 'very thick'];

/**
 * The tikzpicture for a diagram `w` wide. `color` turns an ink into a TikZ colour (null: the
 * text colour); `text` escapes a label (its $math$ kept).
 */
export function diagramTikz(shapes: Shape[], w: number, color: (c: string) => string, text: (s: string) => string): string[] {
  const find = lookupIn(shapes);
  const k = (1 / Math.max(1, w)).toFixed(6);
  const out = [`\\begin{tikzpicture}[x=${k}\\linewidth, y=-${k}\\linewidth]`];
  for (const s of shapes) {
    const st = [WIDTH[(s.width ?? 2) - 1], ...(s.dash ? ['dashed'] : []), ...(s.color ? [color(s.color)] : [])];
    const fill = 'fill' in s && s.fill ? [`fill=${s.color ? color(s.color) : 'black'}!12`] : [];
    const opt = (more: string[] = []) => `[${[...st, ...more].join(', ')}]`;
    const label = (x: number, y: number) => ('label' in s && s.label ? [`\\node[align=center${s.color ? `, ${color(s.color)}` : ''}] at ${pt(x, y)} {${text(s.label)}};`] : []);
    switch (s.k) {
      case 'ink': {
        // (fewer points: TikZ smooths between them)
        const ps = inkPoints({ ...s, pts: simplify(s.pts, 1.2) });
        if (s.hl) {
          out.push(`  \\draw[line width=6pt, line cap=round, opacity=0.35, ${s.color ? color(s.color) : 'yellow'}] plot[smooth, tension=0.4] coordinates {${ps.map((p) => pt(p.x, p.y)).join(' ')}};`);
          break;
        }
        if (ps.length === 1) out.push(`  \\fill${s.color ? `[${color(s.color)}]` : ''} ${pt(ps[0].x, ps[0].y)} circle[radius=1pt];`);
        else out.push(`  \\draw${opt(['line cap=round', 'line join=round'])} plot[smooth, tension=0.4] coordinates {${ps.map((p) => pt(p.x, p.y)).join(' ')}};`);
        break;
      }
      case 'line': {
        const [a, b] = lineEnds(s, find);
        const tip = s.head === 'both' ? '<->' : s.head === 'end' ? '->' : '-';
        const lbl = s.label ? ` node[midway, fill=white, inner sep=1.5pt${s.color ? `, ${color(s.color)}` : ''}] {${text(s.label)}}` : '';
        out.push(`  \\draw${opt([tip])} ${pt(a.x, a.y)} --${lbl} ${pt(b.x, b.y)};`);
        break;
      }
      case 'rect':
        out.push(`  \\draw${opt(['rounded corners=1pt', ...fill])} ${pt(s.x, s.y)} rectangle ${pt(s.x + s.w, s.y + s.h)};`, ...label(centre(s).x, centre(s).y).map((l) => '  ' + l));
        break;
      case 'ellipse': {
        const c = centre(s);
        out.push(`  \\draw${opt(fill)} ${pt(c.x, c.y)} ellipse [x radius=${n(s.w / 2)}, y radius=${n(s.h / 2)}];`, ...label(c.x, c.y).map((l) => '  ' + l));
        break;
      }
      case 'diamond': {
        const c = centre(s);
        out.push(`  \\draw${opt(fill)} ${pt(c.x, s.y)} -- ${pt(s.x + s.w, c.y)} -- ${pt(c.x, s.y + s.h)} -- ${pt(s.x, c.y)} -- cycle;`, ...label(c.x, c.y).map((l) => '  ' + l));
        break;
      }
      case 'plot': {
        // its grid, axes and tick labels; each curve as the points it's drawn through
        const g = plotGeometry(parsePlot(s.label ?? ''), s, 120);
        for (const l of g.grid) out.push(`  \\draw[gray!25, very thin] ${pt(l.x1, l.y1)} -- ${pt(l.x2, l.y2)};`);
        for (const l of g.axes) out.push(`  \\draw[gray, thin] ${pt(l.x1, l.y1)} -- ${pt(l.x2, l.y2)};`);
        for (const t of g.xticks) out.push(`  \\node[font=\\tiny, gray] at ${pt(t.x, t.y - 3)} {${tickTex(t.label)}};`);
        for (const t of g.yticks) out.push(`  \\node[font=\\tiny, gray, anchor=east] at ${pt(t.x, t.y - 3)} {${tickTex(t.label)}};`);
        for (const c of g.curves) {
          const col = c.i === 0 && s.color ? color(s.color) : CURVES[c.i % CURVES.length];
          for (const seg of c.d.split('M').filter(Boolean)) {
            const ps = seg.split('L').map((q) => q.split(',').map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
            // (within the graph's box: what's beyond it is cut off, as on the page)
            const inBox = ps.map(([x, y]) => [x, Math.max(g.area.y, Math.min(g.area.y + g.area.h, y))]);
            if (inBox.length > 1) out.push(`  \\draw[${col}${s.width ? `, ${WIDTH[(s.width ?? 2) - 1]}` : ''}${s.dash ? ', dashed' : ''}] plot coordinates {${inBox.map(([x, y]) => pt(x, y)).join(' ')}};`);
          }
        }
        break;
      }
      case 'text':
        if (s.label) out.push(`  \\node[anchor=north west, inner sep=1pt, align=left${s.color ? `, ${color(s.color)}` : ''}] at ${pt(s.x, s.y)} {${text(s.label).replace(/\n/g, '\\\\ ')}};`);
        break;
    }
  }
  out.push('\\end{tikzpicture}');
  return out;
}
