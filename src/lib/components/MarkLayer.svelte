<script lang="ts">
  import { draw, fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';
  import { inkVar } from '$lib/marks';

  // `under` holds highlights (painted behind the text); the other layer holds
  // outlines, which can be clicked to select them.
  let { ed, under = false }: { ed: Editor; under?: boolean } = $props();

  const clickable = $derived(ed.mode === 'text' || ed.mode === 'style' || ed.mode === 'math');
</script>

<svg class="marks" class:under class:clickable aria-hidden="true">
  {#each ed.doc.marks as m (m.id)}
    {@const g = ed.markGeos[m.id]}
    {#if g && g.filled === under}
      {@const sel = ed.styling === m.id}
      <g data-id={m.id} class="mark {m.kind}" class:sel class:hover={ed.hovered === m.id} class:ghost={ed.pick?.edit?.id === m.id} style="--ink: {inkVar(m.color)}">
        {#if g.filled}
          <path class="fill" d={g.d} in:fade={{ duration: 200 }} />
        {:else}
          <path class="line" class:dash={m.dash} d={g.d} in:draw={{ duration: 380 }} />
          {#if g.leader}
            <path class="leader" d={g.leader} in:fade={{ duration: 150 }} />
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <path
            class="hit"
            d={g.d}
            onmousedown={(e) => { if (e.button) return; e.stopPropagation(); e.preventDefault(); ed.selectDrawing(m.id); }}
            oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ed.openDrawingMenu(m.id, e.clientX, e.clientY); }}
            ondblclick={(e) => { e.stopPropagation(); ed.editNoteOf(m.id); }}
            onpointerenter={() => ed.hover(m.id, true)}
            onpointerleave={() => ed.hover(m.id, false)}
          />
        {/if}
      </g>
    {/if}
  {/each}
</svg>

<style>
  .marks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .marks.under {
    z-index: -1;
  }
  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: stroke 160ms ease, stroke-width 160ms ease;
  }
  .line.dash {
    stroke-dasharray: 5 4;
  }
  .brace .line {
    stroke-width: 1.3;
  }
  .strike .line {
    stroke-width: 1.8;
  }
  .fill {
    fill: var(--ink);
    opacity: 0.22;
    transition: opacity 160ms ease;
  }
  .sel .line {
    stroke-width: 2.2;
    filter: drop-shadow(0 0 3px var(--ink));
  }
  .clickable .hover:not(.sel) .line {
    stroke-width: 2;
    filter: drop-shadow(0 0 2px var(--ink));
  }
  .sel .fill {
    opacity: 0.38;
  }
  .leader {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    opacity: 0.7;
  }
  .ghost {
    opacity: 0.25;
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 10;
  }
  .clickable .hit {
    pointer-events: stroke;
    cursor: pointer;
  }
</style>
