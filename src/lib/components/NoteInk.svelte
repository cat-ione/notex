<script lang="ts">
  // What's drawn on top of the note: each shape where its block is now (see Sketcher.measure).
  // While drawing on the note, a sheet over the text takes the pointer (the text can't be
  // clicked through it; Esc, or the pen button, goes back to it).
  import type { Editor } from '$lib/editor.svelte';
  import SketchShapes from './SketchShapes.svelte';

  let { ed }: { ed: Editor } = $props();

  const sk = $derived(ed.sketch);
  const on = $derived(sk.on?.kind === 'free');
  const shapes = $derived(ed.doc.ink?.length || on ? sk.shapes({ kind: 'free' }) : []);
</script>

{#if shapes.length || on}
  <!-- (drawn at no zoom, shown at the page's: see Sketcher, free surface) -->
  <svg class="note-ink" aria-hidden="true">
    <g transform={ed.zoom === 1 ? undefined : `scale(${ed.zoom})`}>
      {#if on}
        <SketchShapes {shapes} sel={sk.sel} draft={sk.draft} marquee={sk.marquee} lasso={sk.lasso} handles={sk.handles()} selBox={sk.selBox} editing={sk.editing} big={ed.pointer !== 'mouse'} />
      {:else}
        <SketchShapes {shapes} />
      {/if}
    </g>
  </svg>
{/if}
{#if on}
  <div class="sheet tool-{sk.tool}" data-sheet></div>
{/if}

<style>
  .note-ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
    z-index: 4;
  }
  /* over the text while drawing on it: a pointer goes to the drawing */
  .sheet {
    position: absolute;
    inset: 0;
    z-index: 5;
    touch-action: none;
    cursor: crosshair;
    background: repeating-linear-gradient(transparent 0 23px, color-mix(in srgb, var(--accent) 4%, transparent) 23px 24px);
  }
  .sheet.tool-select {
    cursor: default;
    background: none;
  }
  .sheet.tool-eraser {
    cursor: cell;
  }
</style>
