<script lang="ts">
  import { fade } from 'svelte/transition';
  import { NOTE_B, type Editor } from '$lib/editor.svelte';
  import { inkVar } from '$lib/marks';
  import { renderLabel as render } from '$lib/labels';
  import MathView from './MathView.svelte';

  // Labels on arrows and notes on shapes. HTML rather than SVG text so they can
  // contain $math$.
  let { ed }: { ed: Editor } = $props();

  type L = { id: string; text: string; noting?: boolean; pinned?: boolean; x: number; y: number; below: boolean; maxW?: number; color?: string; sel: boolean; ghost: boolean };
  const labels = $derived.by(() => {
    const out: L[] = [];
    const ghost = ed.pick?.edit?.id;
    // The note being typed is drawn as the paragraph it's typed as (below), in place
    const editing = (id: string) => ed.note?.id === id;
    const text = (id: string, saved: string) => (editing(id) ? '' : saved);
    const edit = (id: string) => (editing(id) ? true : undefined);
    for (const a of ed.doc.arrows) {
      const g = ed.arrowGeos[a.id];
      const t = text(a.id, a.label);
      if (!g || !(t || editing(a.id))) continue;
      // placed by hand: centred at its offset from the midpoint
      if (a.note) out.push({ id: a.id, text: t, noting: edit(a.id), pinned: true, x: g.mid.x + a.note.dx, y: g.mid.y + a.note.dy, below: false, color: a.color, sel: ed.styling === a.id, ghost: ghost === a.id });
      else out.push({ id: a.id, text: t, noting: edit(a.id), x: g.mid.x, y: g.mid.y - 4, below: false, color: a.color, sel: ed.styling === a.id, ghost: ghost === a.id });
    }
    for (const m of ed.doc.marks) {
      const g = ed.markGeos[m.id];
      const t = text(m.id, m.label);
      if (!g || !(t || editing(m.id))) continue;
      // label.y is a text baseline: shift to the box's top (below) or bottom (above) edge
      const y = g.label.below ? g.label.y - 12 : g.label.y + 3;
      out.push({ id: m.id, text: t, noting: edit(m.id), x: g.label.x, y, below: g.label.below, maxW: g.label.maxW, color: m.color, sel: ed.styling === m.id, ghost: ghost === m.id });
    }
    return out;
  });

  // notes answer the mouse where drawings do (and while one is being typed)
  const live = $derived(ed.mode === 'text' || ed.mode === 'math' || ed.mode === 'style');
</script>

{#each labels as l (l.id)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-id={l.id}
    class="dlabel"
    class:below={l.below}
    class:sel={l.sel}
    class:ghost={l.ghost}
    class:inked={!!l.color}
    class:wrapped={!!l.maxW}
    class:typing={l.noting}
    class:noting={l.noting}
    class:pinned={l.pinned}
    class:live
    class:hover={ed.hovered === l.id}
    onmousedown={(e) => { if (e.button > 1) return; e.stopPropagation(); e.preventDefault(); ed.noteDown(l.id, e); }}
    ondblclick={(e) => { e.stopPropagation(); ed.noteDblClick(l.id, e); }}
    oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); ed.openDrawingMenu(l.id, e.clientX, e.clientY); }}
    onpointerenter={() => ed.hover(l.id, true)}
    onpointerleave={() => ed.hover(l.id, false)}
    style="left: {l.x}px; top: {l.y}px; --ink: {inkVar(l.color)};{l.maxW ? ` max-width: ${l.maxW}px;` : ''}"
    in:fade={{ duration: 200 }}
  >
    {#if l.noting && ed.note}{#each ed.note.blk.items as it, o (it.id)}{#if it.t === 'c'}<span class="ch" class:b={it.b} class:i={it.i} class:lsel={ed.isSelected(NOTE_B, o)} data-nx={it.id}>{it.ch}</span>{:else}<MathView item={it} cursor={ed.mode === 'math' && ed.o === o ? ed.mc : null} sel={ed.mode === 'math' && ed.o === o ? ed.mathSelRange : null} selected={ed.isSelected(NOTE_B, o)} />{/if}{/each}<span class="eol">&#8203;</span>{:else}{@html render(l.text)}{/if}
  </div>
{/each}

<style>
  /* global: $lib/labels measures notes with an offscreen .dlabel */
  :global(.dlabel) {
    position: absolute;
    z-index: 2;
    transform: translate(-50%, -100%);
    pointer-events: none;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.3;
    padding: 0 3px;
    border-radius: 3px;
    color: var(--ink);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    transition: color 160ms ease, left 120ms ease, top 120ms ease;
  }
  :global(.dlabel.wrapped) {
    white-space: normal;
    width: max-content;
    text-align: center;
  }
  :global(.dlabel.below) {
    transform: translate(-50%, 0);
  }
  /* selected (or being typed): its own colour, ringed, as a selected shape keeps its ink */
  :global(.dlabel.sel) {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 55%, transparent);
  }
  :global(.dlabel.typing) {
    background: color-mix(in srgb, var(--ink) 10%, var(--bg));
    box-shadow: 0 0 0 1px var(--ink);
  }
  :global(.dlabel.live) {
    pointer-events: auto;
    cursor: pointer;
  }
  :global(.dlabel.live.sel) {
    cursor: grab;
  }
  :global(.dlabel.live.typing) {
    cursor: text;
  }
  /* hovering a note or its drawing shows them together */
  :global(.dlabel.live.hover) {
    background: color-mix(in srgb, var(--ink) 14%, var(--bg));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 45%, transparent);
  }
  :global(.dlabel.pinned) {
    transform: translate(-50%, -50%);
  }
  :global(.dlabel.ghost) {
    opacity: 0.25;
  }
  :global(.dlabel) :global(.katex) {
    font-size: 1.15em;
  }
  /* being typed: every space counts (a trailing one too), as measured */
  :global(.dlabel.typing) {
    white-space: pre;
  }
  :global(.dlabel.typing.wrapped) {
    white-space: break-spaces;
  }
  /* the note being typed: the page's letters and formulas (and its selections, which on the
     page are drawn behind the text, where the note's background would hide them) */
  :global(.dlabel .ch.b),
  :global(.dlabel b) {
    font-weight: 700;
  }
  :global(.dlabel .ch.i),
  :global(.dlabel i) {
    font-style: italic;
  }
  :global(.dlabel .eol) {
    display: inline-block;
    width: 0;
  }
  :global(.dlabel .nx-sel),
  :global(.dlabel .math.selected) {
    background: var(--text-sel);
    border-radius: 2px;
  }
  :global(.dlabel .lsel) {
    background: var(--text-sel);
    border-radius: 2px;
  }
</style>
