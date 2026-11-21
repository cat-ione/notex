<script lang="ts">
  import { draw, fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';
  import { arrowGeo, defaultBend } from '$lib/arrows';
  import { INKS, inkVar } from '$lib/marks';

  let { ed }: { ed: Editor } = $props();

  // Live preview while choosing the arrow's end.
  const preview = $derived.by(() => {
    const { from, cur } = ed.pickRects;
    if (ed.pick?.phase !== 'to' || !from || !cur) return null;
    // Re-picking one end of an existing arrow keeps its bend and direction.
    const edit = ed.pick.edit;
    const a = edit && ed.doc.arrows.find((x) => x.id === edit.id);
    // (dragging an end: attached where it would be let go)
    const here = ed.dragEnd ? ed.dragEnd.at : undefined;
    if (a && edit?.end === 'from') return arrowGeo(cur, from, a.bend, {}, { from: ed.dragEnd ? here : a.fromAt, to: a.toAt }, a.skew);
    return arrowGeo(from, cur, a ? a.bend : defaultBend(from, cur), {}, a ? { from: a.fromAt, to: ed.dragEnd ? here : a.toAt } : {}, a?.skew);
  });

  const clickable = $derived(ed.mode === 'text' || ed.mode === 'style' || ed.mode === 'math');
  const marker = (c: string | undefined) => `url(#nx-head-${c || 'base'})`;
</script>

<svg class="arrows" class:clickable aria-hidden="true">
  <defs>
    {#each INKS as c}
      <marker id="nx-head-{c || 'base'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M1,1 L9,5 L1,9 L3,5 Z" fill={inkVar(c)} />
      </marker>
    {/each}
    <marker id="nx-head-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1,1 L9,5 L1,9 L3,5 Z" fill="var(--accent)" />
    </marker>
  </defs>

  {#each ed.doc.arrows as a (a.id)}
    {@const g = ed.arrowGeos[a.id]}
    {#if g}
      {@const sel = ed.styling === a.id}
      {@const head = marker(a.color)}
      <g data-id={a.id} class="arrow" class:sel class:hover={ed.hovered === a.id} class:inked={!!a.color} class:ghost={ed.pick?.edit?.id === a.id} style="--ink: {inkVar(a.color)}">
        {#if a.boxed}
          <rect class="box" x={g.from.x} y={g.from.y} width={g.from.w} height={g.from.h} rx="4" in:fade={{ duration: 150 }} />
          <rect class="box" x={g.to.x} y={g.to.y} width={g.to.w} height={g.to.h} rx="4" in:fade={{ duration: 150 }} />
        {/if}
        <path
          d={g.d}
          class:dash={a.dash}
          marker-end={a.head !== 'none' ? head : undefined}
          marker-start={a.head === 'both' ? head : undefined}
          in:draw={{ duration: 420 }}
        />
        {#if g.leader}
          <path class="leader" d={g.leader} in:fade={{ duration: 150 }} />
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path
          class="hit"
          d={g.d}
          onmousedown={(e) => { if (e.button > 1) return; e.stopPropagation(); e.preventDefault(); ed.drawingDown(a.id, e); }}
          oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ed.openDrawingMenu(a.id, e.clientX, e.clientY); }}
            ondblclick={(e) => { e.stopPropagation(); ed.editNoteOf(a.id); }}
            onpointerenter={() => ed.hover(a.id, true)}
            onpointerleave={() => ed.hover(a.id, false)}
        />
        {#if sel && ed.mode === 'style'}
          {#each [['from', g.p0], ['to', g.p2], ['bend', g.mid]] as const as [part, p] (part)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle
              class="handle {part}"
              cx={p.x}
              cy={p.y}
              r={part === 'bend' ? 4 : 5}
              onmousedown={(e) => { if (e.button) return; e.stopPropagation(); e.preventDefault(); ed.beginHandleDrag(a.id, part); }}
              data-tip={part === 'bend' ? 'drag to move the middle anywhere' : `drag to move the ${part === 'from' ? 'start' : 'tip'}`}
              data-tip-key={part === 'bend' ? '↑ ↓ ← →' : part === 'from' ? 's / shift+s' : 'e / shift+e'}
              data-tip-more={part === 'bend' ? '' : 'let go on a side of the target to attach there, in its middle for automatic'}
              in:fade={{ duration: 120 }}
            />
          {/each}
        {/if}
      </g>
    {/if}
  {/each}

  {#if preview}
    <path class="preview" d={preview.d} marker-end="url(#nx-head-sel)" />
  {/if}
</svg>

<style>
  .arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  path {
    fill: none;
    stroke: var(--ink, var(--arrow));
    stroke-width: 1.6;
    stroke-linecap: round;
    transition: stroke 160ms ease;
  }
  path.dash {
    stroke-dasharray: 5 4;
  }
  /* selected: its own colour, thicker and glowing (as a selected shape) */
  .sel path {
    stroke-width: 2;
    filter: drop-shadow(0 0 3px var(--ink, var(--arrow)));
  }
  .clickable .hover:not(.sel) path:not(.hit) {
    stroke-width: 2;
    filter: drop-shadow(0 0 2px var(--ink, var(--arrow)));
  }
  path.leader {
    stroke-width: 1;
    stroke-dasharray: 2 2;
    opacity: 0.7;
    filter: none;
  }
  .ghost {
    opacity: 0.25;
  }
  .handle {
    fill: var(--bg);
    stroke: var(--ink, var(--accent));
    stroke-width: 1.5;
    pointer-events: all;
    cursor: grab;
    transition: r 120ms ease;
  }
  .handle:hover {
    r: 6.5;
  }
  .handle.bend {
    fill: var(--ink, var(--accent));
    cursor: move;
  }
  path.hit {
    stroke: transparent;
    stroke-width: 10;
    filter: none;
  }
  .clickable path.hit {
    pointer-events: stroke;
    cursor: pointer;
  }
  .clickable .sel path.hit {
    cursor: grab;
  }
  .box {
    fill: var(--arrow-box);
    stroke: var(--ink, var(--arrow));
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }
  .sel .box {
    stroke-width: 1.4;
  }
  .preview {
    stroke: var(--accent);
    stroke-dasharray: 4 4;
    opacity: 0.8;
    animation: march 600ms linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -8;
    }
  }
</style>
