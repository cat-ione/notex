import type { Doc, Item } from './model';
import { toLatex } from './math/latex';

const ESC: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '^': '\\^{}', '~': '\\~{}',
};

function inline(items: Item[]) {
  return items
    .map((it) => (it.t === 'c' ? (ESC[it.ch] ?? it.ch) : it.display ? `\n\\[ ${toLatex(it.root)} \\]\n` : `$${toLatex(it.root)}$`))
    .join('');
}

export function docToLatex(doc: Doc): string {
  const out: string[] = [];
  let inList = false;
  for (const b of doc.blocks) {
    if (b.kind === 'li' && !inList) out.push('\\begin{itemize}'), (inList = true);
    if (b.kind !== 'li' && inList) out.push('\\end{itemize}'), (inList = false);
    const body = inline(b.items);
    if (b.kind === 'h1') out.push(`\\section*{${body}}`);
    else if (b.kind === 'h2') out.push(`\\subsection*{${body}}`);
    else if (b.kind === 'h3') out.push(`\\subsubsection*{${body}}`);
    else if (b.kind === 'li') out.push(`  \\item ${body}`);
    else out.push(body + '\n');
  }
  if (inList) out.push('\\end{itemize}');
  if (doc.arrows.length) out.push(`% ${doc.arrows.length} arrow(s) not exported yet`);
  return out.join('\n');
}
