<script lang="ts">
  // Shapes, drawn into an svg (a diagram's canvas, or the layer on top of the note): strokes,
  // lines with their heads, boxes, ellipses, diamonds and their labels; the selection and its
  // handles; the shape being drawn and the selection rectangle.
  import type { Id } from '$lib/model';
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
    handles = [],
    selBox = null,
    editing = null,
    scale = 1,
  }: {
    shapes: Shape[];
    sel?: Id[];
    draft?: Shape | null;
    marquee?: Box | null;
    handles?: { h: string; p: Pt }[];
    selBox?: Box | null;
    editing?: Id | null;
    /** Screen pixels per unit (handles and outlines keep their size on screen). */
    scale?: number;
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
        <!-- (on the line, over it: the line stops either side of the words) -->
        <foreignObject x={lb.x} y={lb.y} width={lb.w} height={lb.h}>
          <div class="label on-line"><span>{@html renderLabel(s.label)}</span></div>
        </foreignObject>
      {/if}
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
    <circle class="handle" cx={h.p.x} cy={h.p.y} r={4.5 / scale} stroke-width={1.2 / scale} />
  {/each}
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
