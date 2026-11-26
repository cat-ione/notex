// What the palette remembers: how often and how lately each command was picked, so the
// likeliest come first. A pick counts less as it ages (half after a week). Kept in this
// browser (or app); losing it only loses the order.

const KEY = 'notex.usage.v1';
const HALF_LIFE = 7 * 864e5;
/** At most this many remembered per palette (the least used go). */
const KEEP = 200;

type Use = { s: number; t: number };
/** Palette (text, math, draw, style) → command → its use. */
type Uses = Record<string, Record<string, Use>>;

let uses: Uses = load();

function load(): Uses {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return u && typeof u === 'object' ? u : {};
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(uses));
  } catch {
    /* (no storage: remembered for this visit only) */
  }
}

/** How much a command has been used, lately counting more (0: never, or long ago). */
export function score(ctx: string, name: string, now = Date.now()): number {
  const u = uses[ctx]?.[name];
  return u ? u.s * 0.5 ** (Math.max(0, now - u.t) / HALF_LIFE) : 0;
}

/** A command was picked. */
export function used(ctx: string, name: string, now = Date.now()) {
  const m = (uses[ctx] ??= {});
  m[name] = { s: score(ctx, name, now) + 1, t: now };
  const names = Object.keys(m);
  if (names.length > KEEP) for (const n of names.sort((a, b) => score(ctx, a, now) - score(ctx, b, now)).slice(0, names.length - KEEP)) delete m[n];
  save();
}

/** Forget every pick. */
export function forget() {
  uses = {};
  save();
}

/** `names` with the most used first; the rest (never used) keep their order. */
export function byUse(ctx: string, names: string[], now = Date.now()): string[] {
  const s = new Map(names.map((n) => [n, score(ctx, n, now)]));
  return [...names].sort((a, b) => s.get(b)! - s.get(a)!);
}
