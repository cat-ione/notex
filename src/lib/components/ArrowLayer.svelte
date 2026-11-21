<script lang="ts">
  import { draw, fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';
  import { arrowGeo, defaultBend } from '$lib/arrows';

  let { ed }: { ed: Editor } = $props();

  // Live preview while choosing the arrow's end.
  const preview = $derived.by(() => {
    const { from, cur } = ed.pickRects;
    if (ed.pick?.phase !== 'to' || !from || !cur) return null;
    return arrowGeo(from, cur, defaultBend(from, cur));
  });
</script>

<svg class="arrows" aria-hidden="true">
  <defs>
    <marker id="nx-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1,1 L9,5 L1,9 L3,5 Z" fill="var(--arrow)" />
    </marker>
    <marker id="nx-head-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1,1 L9,5 L1,9 L3,5 Z" fill="var(--accent)" />
    </marker>
  </defs>

  {#each ed.doc.arrows as a (a.id)}
    {@const g = ed.arrowGeos[a.id]}
    {#if g}
      {@const sel = ed.styling === a.id}
      {@const head = sel ? 'url(#nx-head-sel)' : 'url(#nx-head)'}
      <g class="arrow" class:sel>
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
    stroke: var(--arrow);
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
  .box {
    fill: var(--arrow-box);
    stroke: var(--arrow);
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }
  .sel .box {
    stroke: var(--accent);
  }
  text {
    fill: var(--arrow);
    font-family: var(--mono);
    font-size: 11px;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
  }
  .sel text {
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
