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
    return arrowGeo(from, cur, defaultBend(from, cur));
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
      {@const head = sel && !a.color ? 'url(#nx-head-sel)' : marker(a.color)}
      <g class="arrow" class:sel class:inked={!!a.color} style="--ink: {inkVar(a.color)}">
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
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path class="hit" d={g.d} onmousedown={(e) => { if (e.button) return; e.stopPropagation(); e.preventDefault(); ed.selectDrawing(a.id); }} />
        {#if a.label}
          <text x={g.mid.x} y={g.mid.y - 6} text-anchor="middle" in:fade={{ duration: 200 }}>{a.label}</text>
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
  .sel path {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .sel.inked path {
    stroke: var(--ink);
    filter: drop-shadow(0 0 3px var(--ink));
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
  .box {
    fill: var(--arrow-box);
    stroke: var(--ink, var(--arrow));
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }
  .sel .box {
    stroke: var(--accent);
  }
  text {
    fill: var(--ink, var(--arrow));
    font-family: var(--mono);
    font-size: 11px;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
  }
  .sel:not(.inked) text {
    fill: var(--accent);
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
