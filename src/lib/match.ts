// Matching what's typed in the palette against command names, as an editor's autocomplete does.

/**
 * Where `q` matches in a command's name (the letters' positions), or null. As in an editor's
 * autocomplete: the name starts with it, or holds it whole (3 letters on), or starts with its
 * first letter and has the rest in order.
 */
export function matchAt(n: string, q: string): number[] | null {
  if (!q) return [];
  const N = n.toLowerCase(), Q = q.toLowerCase();
  const run = (at: number) => Array.from({ length: Q.length }, (_, k) => at + k);
  if (N.startsWith(Q)) return run(0);
  const at = Q.length >= 3 ? N.indexOf(Q) : -1;
  if (at >= 0) return run(at);
  if (N[0] !== Q[0]) return null;
  const hit = [0];
  for (let i = 1, k = 1; k < Q.length; i++) {
    if (i >= N.length) return null;
    if (N[i] === Q[k]) hit.push(i), k++;
  }
  return hit;
}

/**
 * The names `q` matches, best first: exactly, as a beginning (its case first), whole inside,
 * in order. Within each, the more `use` says a name is used, the earlier; then the shorter.
 */
export function rank(names: string[], q: string, use: (n: string) => number = () => 0): string[] {
  if (!q) return names;
  const scored: { n: string; tier: number; u: number }[] = [];
  for (const n of names) {
    const hit = matchAt(n, q);
    if (!hit) continue;
    const contiguous = hit.at(-1)! - hit[0] === hit.length - 1;
    const tier = n === q ? 0 : n.startsWith(q) ? 1 : hit[0] === 0 && contiguous ? 2 : contiguous ? 3 : 5;
    scored.push({ n, tier, u: use(n) });
  }
  return scored.sort((a, b) => a.tier - b.tier || b.u - a.u || a.n.length - b.n.length).map((x) => x.n);
}
