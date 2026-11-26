<script lang="ts">
  // Shapes, drawn into an svg (a diagram's canvas, or the layer on top of the note): strokes,
  // lines with their heads, boxes, ellipses, diamonds and their labels; the selection and its
  // handles; the shape being drawn and the selection rectangle; graphs of functions.
  import type { Id } from '$lib/model';
  import { parsePlot, plotGeometry, type PlotGeom } from '$lib/sketch/plot';
  import { renderLabel } from '$lib/labels';
  import {
    diamondPath, HL_PX, inkPoints, isBox, lineEnds, lineLabelBox, lookupIn, penOutline, smoothPath, strokePx,
    type Box, type Pt, type Shape,
  } from '$lib/sketch/shapes';

  let {
    shapes,
    sel = [],
    draft = null,
    marquee = null,
    lasso = null,
    handles = [],
    selBox = null,
    editing = null,
    scale = 1,
    big = false,
  }: {
    shapes: Shape[];
    sel?: Id[];
    draft?: Shape | null;
    marquee?: Box | null;
    lasso?: Pt[] | null;
    handles?: { h: string; p: Pt }[];
    selBox?: Box | null;
    editing?: Id | null;
    /** Screen pixels per unit (handles and outlines keep their size on screen). */
    scale?: number;
    /** Bigger handles, for a pen or a finger. */
    big?: boolean;
  } = $props();

  const find = $derived(lookupIn(draft ? [...shapes, draft] : shapes));
  const ink = (c: string | undefined) => (c ? `var(--ink-${c})` : 'var(--fg)');
  const selected = $derived(new Set(sel));

  /** An arrowhead at `b`, coming from `a`. */
  function head(a: Pt, b: Pt, w: number): string {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 7 + w * 2.2, W = 0.42;
    const p1 = { x: b.x - L * Math.cos(ang - W), y: b.y - L * Math.sin(ang - W) };
    const p2 = { x: b.x - L * Math.cos(ang + W), y: b.y - L * Math.sin(ang + W) };
    return `M${p1.x.toFixed(1)},${p1.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}L${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  /** A graph laid out (kept while its label and box are the same: a curve is hundreds of points). */
  const plots = new Map<string, PlotGeom>();
  function plotOf(s: Shape & { x: number; y: number; w: number; h: number; label?: string }): PlotGeom {
    const key = `${s.label ?? ''}|${s.x},${s.y},${s.w},${s.h}`;
    let g = plots.get(key);
    if (!g) {
      if (plots.size > 64) plots.clear();
      g = plotGeometry(parsePlot(s.label ?? ''), s);
      plots.set(key, g);
    }
    return g;
  }
  /** Each function's colour: the graph's own first (else the accent), then the inks. */
  const curveColor = (i: number, c: string | undefined) => [c ? ink(c) : 'var(--accent)', 'var(--ink-red)', 'var(--ink-green)', 'var(--ink-purple)', 'var(--ink-blue)'][i % 5];

  /** The line stops short of a head's point (so it doesn't poke through it). */
  function short(a: Pt, b: Pt, by: number): Pt {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: b.x - ((b.x - a.x) / l) * by, y: b.y - ((b.y - a.y) / l) * by };
  }
</script>

{#snippet one(s: Shape, isDraft: boolean)}
  {@const w = strokePx(s.width)}
  {@const c = ink(s.color)}
  <g class="shape k-{s.k}" class:sel={selected.has(s.id)} class:draft={isDraft} class:plain={!s.color} data-sid={s.id} style="--c: {c}">
    {#if s.k === 'ink'}
      {#if s.hl}
        <path class="stroke hl" d={smoothPath(inkPoints(s))} stroke-width={HL_PX} />
      {:else if s.pen}
        <path class="fillink" d={penOutline(s.pts, w * 1.6)} />
      {:else}
        <path class="stroke" class:dash={s.dash} d={smoothPath(inkPoints(s))} stroke-width={w} />
      {/if}
    {:else if s.k === 'line'}
      {@const [a, b] = lineEnds(s, find)}
      {@const hb = s.head !== 'none'}
      {@const ha = s.head === 'both'}
      {@const pa = ha ? short(b, a, w) : a}
      {@const pb = hb ? short(a, b, w) : b}
      <line class="stroke" class:dash={s.dash} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke-width={w} />
      {#if hb}<path class="head" d={head(a, b, w)} stroke-width={w} />{/if}
      {#if ha}<path class="head" d={head(b, a, w)} stroke-width={w} />{/if}
      {#if s.label && editing !== s.id}
        {@const lb = lineLabelBox(s, find, 240, 40)}
        <!-- (on the line, over it: the line stops either side of the words; a short line: above it) -->
        {@const short = Math.hypot(b.x - a.x, b.y - a.y) < 32 + s.label.length * 7}
        <foreignObject x={lb.x} y={short ? lb.y - 22 : lb.y} width={lb.w} height={lb.h}>
          <div class="label on-line" class:above={short}><span>{@html renderLabel(s.label)}</span></div>
        </foreignObject>
      {/if}
    {:else if s.k === 'plot'}
      {@const g = plotOf(s)}
      {@const fns = (s.label ?? '').split(/\n|;/).map((l) => l.trim()).filter((l) => l && !/^[xy]\s*(:|∈)/.test(l))}
      <g class="plot">
        <rect class="pframe" x={s.x} y={s.y} width={Math.max(1, s.w)} height={Math.max(1, s.h)} rx="3" />
        {#each g.grid as l, i (i)}<line class="pgrid" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />{/each}
        {#each g.axes as l, i (i)}<line class="paxis" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />{/each}
        <clipPath id="plot-{s.id}"><rect x={g.area.x} y={g.area.y} width={g.area.w} height={g.area.h} /></clipPath>
        <g clip-path="url(#plot-{s.id})">
          {#each g.curves as c (c.i)}<path class="pcurve" class:dash={s.dash} d={c.d} stroke={curveColor(c.i, s.color)} stroke-width={w} />{/each}
        </g>
        {#each g.xticks as t, i (i)}<text class="ptick" x={t.x} y={t.y} text-anchor="middle">{t.label}</text>{/each}
        {#each g.yticks as t, i (i)}<text class="ptick" x={t.x} y={t.y} text-anchor="end">{t.label}</text>{/each}
        {#if fns.length > 1}
          <!-- (behind the legend: the page, so curves under it don't cross the words) -->
          {@const lw = Math.max(...fns.map((f) => f.length)) * 6.7 + 26}
          <rect class="pback" x={s.x + s.w - lw - 4} y={s.y + 5} width={lw} height={fns.length * 14 + 4} rx="3" />
          {#each fns as f, i (i)}
            <line class="pcurve" x1={s.x + s.w - 14} y1={s.y + 14 + i * 14} x2={s.x + s.w - 4} y2={s.y + 14 + i * 14} stroke={curveColor(i, s.color)} stroke-width="2" />
            <text class="plegend" x={s.x + s.w - 18} y={s.y + 18 + i * 14} text-anchor="end">{f}</text>
          {/each}
        {/if}
        {#each g.errors as err, i (i)}<text class="perr" x={s.x + 8} y={s.y + s.h - 10 - i * 13}>{err}</text>{/each}
        {#if !s.label?.trim() && editing !== s.id}<text class="phint" x={s.x + s.w / 2} y={s.y + s.h / 2} text-anchor="middle">a graph: what to plot? (enter)</text>{/if}
      </g>
    {:else}
      {#if s.k === 'rect'}
        <rect class="stroke" class:dash={s.dash} class:filled={s.fill} x={s.x} y={s.y} width={s.w} height={s.h} rx="4" stroke-width={w} />
      {:else if s.k === 'ellipse'}
        <ellipse class="stroke" class:dash={s.dash} class:filled={s.fill} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} stroke-width={w} />
      {:else if s.k === 'diamond'}
        <path class="stroke" class:dash={s.dash} class:filled={s.fill} d={diamondPath(s)} stroke-width={w} />
      {/if}
      {#if s.label && editing !== s.id}
        <foreignObject x={s.x} y={s.y} width={Math.max(1, s.w)} height={Math.max(1, s.h)}>
          <div class="label" class:free={s.k === 'text'}>{@html renderLabel(s.label)}</div>
        </foreignObject>
      {/if}
    {/if}
  </g>
{/snippet}

{#each shapes as s (s.id)}{@render one(s, false)}{/each}
{#if draft}{@render one(draft, true)}{/if}

{#if selBox && !draft}
  <rect class="selbox" x={selBox.x - 4 / scale} y={selBox.y - 4 / scale} width={selBox.w + 8 / scale} height={selBox.h + 8 / scale} stroke-width={1 / scale} />
  {#each handles as h (h.h)}
    <circle class="handle" cx={h.p.x} cy={h.p.y} r={(big ? 8 : 4.5) / scale} stroke-width={1.2 / scale} />
  {/each}
{/if}
{#if lasso && lasso.length > 1}
  <path class="marquee lasso" d={'M' + lasso.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L') + 'Z'} stroke-width={1 / scale} />
{/if}
{#if marquee}
  <rect class="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} stroke-width={1 / scale} />
{/if}

<style>
  .shape {
    pointer-events: none;
  }
  .stroke {
    fill: none;
    stroke: var(--c);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .stroke.filled {
    fill: color-mix(in srgb, var(--c) 14%, transparent);
  }
  .stroke.dash {
    stroke-dasharray: 6 5;
  }
  /* a graph: a faint frame and grid, the axes, the curves over them */
  .pframe {
    fill: none;
    stroke: var(--border);
    stroke-width: 1;
  }
  .sel .pframe,
  .draft .pframe {
    stroke: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .pback {
    fill: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  .pgrid {
    stroke: color-mix(in srgb, var(--fg) 7%, transparent);
    stroke-width: 1;
  }
  .paxis {
    stroke: color-mix(in srgb, var(--fg) 45%, transparent);
    stroke-width: 1.2;
  }
  .pcurve {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pcurve.dash {
    stroke-dasharray: 6 5;
  }
  .ptick,
  .plegend,
  .perr,
  .phint {
    font-family: var(--mono);
    font-size: 10px;
    fill: var(--muted);
  }
  .plegend {
    fill: var(--fg);
    font-size: 11px;
  }
  .perr {
    fill: var(--danger);
  }
  .phint {
    font-size: 12px;
  }
  .head {
    fill: none;
    stroke: var(--c);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* a highlighter: wide and see-through, the text showing under it */
  .stroke.hl {
    stroke-opacity: 0.32;
    stroke-linecap: round;
  }
  /* (in no colour of its own: the highlighter's warm one, not the text's) */
  .plain .stroke.hl {
    stroke: var(--arrow);
  }
  .fillink {
    fill: var(--c);
    stroke: none;
  }
  .draft {
    opacity: 0.85;
  }
  .sel .stroke,
  .sel .fillink,
  .sel .head {
    filter: drop-shadow(0 0 2px var(--accent));
  }
  .label {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 2px 6px;
    box-sizing: border-box;
    color: var(--c);
    font-family: var(--prose);
    font-size: 15px;
    line-height: 1.3;
    text-align: center;
    overflow: visible;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .label.on-line span {
    padding: 0 4px;
    background: var(--bg);
    border-radius: 3px;
  }
  .label.on-line.above {
    align-items: flex-end;
  }
  .label.on-line.above span {
    background: none;
    font-size: 13px;
  }
  .label.free {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    padding: 0 2px;
    white-space: pre;
  }
  .selbox {
    fill: none;
    stroke: var(--accent);
    stroke-dasharray: 4 3;
    pointer-events: none;
  }
  .handle {
    fill: var(--bg);
    stroke: var(--accent);
    pointer-events: none;
  }
  .marquee {
    fill: color-mix(in srgb, var(--accent) 8%, transparent);
    stroke: var(--accent);
    stroke-dasharray: 3 3;
    pointer-events: none;
  }
</style>
