// Matching what's typed in the palette against command names, as an editor's autocomplete
// does, forgiving a typo or two, and finding a command by the words that describe it.

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

/** How many typos (a letter wrong, missing, extra, or two swapped) make `a` into `b`. */
export function typos(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** How many typos what's typed may have: none for 1–2 letters, one up to 5, then two. */
const allowed = (q: string) => (q.length < 3 ? 0 : q.length < 6 ? 1 : 2);

/**
 * Whether `q` is the start of a name with a typo or two (`tabel`, `itlaic`, `farc`): the
 * letters positioned where they agree, or null.
 */
export function typoAt(n: string, q: string): number[] | null {
  const N = n.toLowerCase(), Q = q.toLowerCase(), k = allowed(Q);
  if (!k) return null;
  let best = Infinity, len = 0;
  for (let l = Math.max(1, Q.length - k); l <= Math.min(N.length, Q.length + k); l++) {
    const t = typos(Q, N.slice(0, l));
    if (t < best) (best = t), (len = l);
  }
  if (best > k) return null;
  return [...N.slice(0, len)].flatMap((c, i) => (c === Q[i] ? [i] : []));
}

/** Whether a word of the description starts with `q` (3 letters on): `heading` finds h1. */
const inDesc = (desc: string, q: string) => q.length >= 3 && desc.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q.toLowerCase()));

/**
 * The names `q` matches, best first: exactly, as a beginning (its case first), whole inside,
 * in order, with a typo, by a word of its description. Within each, the more `use` says a
 * name is used, the earlier; then the shorter.
 */
export function rank(names: string[], q: string, use: (n: string) => number = () => 0, desc: (n: string) => string = () => ''): string[] {
  if (!q) return names;
  const scored: { n: string; tier: number; u: number }[] = [];
  for (const n of names) {
    const hit = matchAt(n, q);
    let tier: number;
    if (hit) {
      const contiguous = hit.at(-1)! - hit[0] === hit.length - 1;
      tier = n === q ? 0 : n.startsWith(q) ? 1 : hit[0] === 0 && contiguous ? 2 : contiguous ? 3 : 5;
    } else if (typoAt(n, q)) tier = 6;
    else if (inDesc(desc(n), q)) tier = 7;
    else continue;
    scored.push({ n, tier, u: use(n) });
  }
  return scored.sort((a, b) => a.tier - b.tier || b.u - a.u || a.n.length - b.n.length).map((x) => x.n);
}

/** The letters of a name to mark as matching what's typed (none, found by its description). */
export const marked = (n: string, q: string): number[] => matchAt(n, q) ?? typoAt(n, q) ?? [];
