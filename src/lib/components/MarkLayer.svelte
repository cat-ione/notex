<script lang="ts">
  import { draw, fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';
  import { inkVar } from '$lib/marks';

  // `under` holds highlights (painted behind the text); the other layer holds
  // outlines, which can be clicked to select them.
  let { ed, under = false }: { ed: Editor; under?: boolean } = $props();

  const clickable = $derived(ed.mode === 'text' || ed.mode === 'style' || ed.mode === 'math');

  // A pen or finger on a shape or its handle: what a mouse press does there, its moves and
  // lift followed till it lifts (the page doesn't draw or scroll with it). A mouse has its
  // own mouse events.
  function press(e: PointerEvent, start: () => void) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    start();
    const id = e.pointerId;
    const move = (m: PointerEvent) => m.pointerId === id && ed.mouseMove(m);
    const up = (u: PointerEvent) => {
      if (u.pointerId !== id) return;
      ed.mouseUp();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }
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
            onmousedown={(e) => { if (e.button > 1) return; e.stopPropagation(); e.preventDefault(); ed.drawingDown(m.id, e); }}
            onpointerdown={(e) => press(e, () => ed.drawingDown(m.id, e))}
            oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ed.menus.openDrawingMenu(m.id, e.clientX, e.clientY); }}
            ondblclick={(e) => { e.stopPropagation(); ed.editNoteOf(m.id); }}
            onpointerenter={() => ed.hover(m.id, true)}
            onpointerleave={() => ed.hover(m.id, false)}
          />
        {/if}
      </g>
    {/if}
  {/each}
  <!-- a highlight is under the text, out of reach: its edge, over the text, is what takes
       a click (as a box's outline does), to select it, move it, resize it by its handles -->
  {#if !under}
    {#each ed.doc.marks as m (m.id)}
      {@const g = ed.markGeos[m.id]}
      {#if g?.filled}
        {#if ed.styling === m.id || ed.hovered === m.id}
          <path class="edgeline" style="--ink: {inkVar(m.color)}" d={g.d} />
        {/if}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <path
          class="hit edge"
          d={g.d}
          onmousedown={(e) => { if (e.button > 1) return; e.stopPropagation(); e.preventDefault(); ed.drawingDown(m.id, e); }}
          onpointerdown={(e) => press(e, () => ed.drawingDown(m.id, e))}
          oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ed.menus.openDrawingMenu(m.id, e.clientX, e.clientY); }}
          ondblclick={(e) => { e.stopPropagation(); ed.editNoteOf(m.id); }}
          onpointerenter={() => ed.hover(m.id, true)}
          onpointerleave={() => ed.hover(m.id, false)}
        />
      {/if}
    {/each}
  {/if}
  <!-- the selected shape's ends: drag to cover more or less -->
  {#if !under && ed.mode === 'style' && ed.markEnds}
    {@const me = ed.markEnds}
    {@const mk = ed.doc.marks.find((x) => x.id === me.id)}
    {#each [['start', me.a], ['end', me.b]] as const as [part, p] (part)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        class="handle"
        style="--ink: {inkVar(mk?.color)}"
        x={p.x - 2.5}
        y={p.y - 6}
        width="5"
        height="12"
        rx="2"
        onmousedown={(e) => { if (e.button) return; e.stopPropagation(); e.preventDefault(); ed.beginMarkResize(me.id, part); }}
        onpointerdown={(e) => press(e, () => ed.beginMarkResize(me.id, part))}
        data-tip="drag to resize"
        data-tip-key="{part === 'end' ? 'shift' : 'ctrl+shift'}+← →"
        in:fade={{ duration: 120 }}
      />
    {/each}
  {/if}
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
  .handle {
    fill: var(--bg);
    stroke: var(--ink);
    stroke-width: 1.5;
    pointer-events: all;
    cursor: ew-resize;
    touch-action: none;
  }
  /* (a pen or finger: a handle big enough to hit) */
  @media (pointer: coarse) {
    .handle {
      stroke-width: 6;
      paint-order: stroke;
    }
  }
  /* a highlight's edge: shown when it's hovered or selected */
  .edgeline {
    fill: none;
    stroke: color-mix(in srgb, var(--ink) 60%, transparent);
    stroke-width: 1.2;
  }
  .clickable .hit.edge {
    stroke-width: 9;
  }
  .handle:hover {
    fill: var(--ink);
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
    touch-action: none;
  }
  .clickable .sel .hit {
    cursor: move;
  }
</style>
