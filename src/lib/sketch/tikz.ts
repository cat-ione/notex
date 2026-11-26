// A diagram as TikZ: its shapes in a tikzpicture as wide as the text (the diagram was as wide
// as the page's text), y going down as on the page.

import { centre, inkPoints, lineEnds, lookupIn, simplify, type Shape } from './shapes';

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
      case 'text':
        if (s.label) out.push(`  \\node[anchor=north west, inner sep=1pt, align=left${s.color ? `, ${color(s.color)}` : ''}] at ${pt(s.x, s.y)} {${text(s.label).replace(/\n/g, '\\\\ ')}};`);
        break;
    }
  }
  out.push('\\end{tikzpicture}');
  return out;
}
