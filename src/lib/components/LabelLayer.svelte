<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';
  import { inkVar } from '$lib/marks';
  import { renderLabel as render } from '$lib/labels';

  // Labels on arrows and notes on shapes. HTML rather than SVG text so they can
  // contain $math$.
  let { ed }: { ed: Editor } = $props();

  type L = { id: string; text: string; edit?: { at: number; anchor: number | null }; x: number; y: number; below: boolean; maxW?: number; color?: string; sel: boolean; ghost: boolean };
  const labels = $derived.by(() => {
    const out: L[] = [];
    const ghost = ed.pick?.edit?.id;
    // While a label is being typed, show the draft in place with its caret (the editor
    // lays the note out for the draft too)
    const editing = (id: string) => ed.mode === 'label' && !!ed.label && ed.styling === id;
    const text = (id: string, saved: string) => (editing(id) ? ed.label!.text : saved);
    const edit = (id: string) => (editing(id) ? { at: ed.label!.at, anchor: ed.label!.anchor } : undefined);
    for (const a of ed.doc.arrows) {
      const g = ed.arrowGeos[a.id];
      const t = text(a.id, a.label);
      if (g && (t || editing(a.id))) out.push({ id: a.id, text: t, edit: edit(a.id), x: g.mid.x, y: g.mid.y - 4, below: false, color: a.color, sel: ed.styling === a.id, ghost: ghost === a.id });
    }
    for (const m of ed.doc.marks) {
      const g = ed.markGeos[m.id];
      const t = text(m.id, m.label);
      if (!g || !(t || editing(m.id))) continue;
      // label.y is a text baseline: shift to the box's top (below) or bottom (above) edge
      const y = g.label.below ? g.label.y - 12 : g.label.y + 3;
      out.push({ id: m.id, text: t, edit: edit(m.id), x: g.label.x, y, below: g.label.below, maxW: g.label.maxW, color: m.color, sel: ed.styling === m.id, ghost: ghost === m.id });
    }
    return out;
  });
</script>

{#each labels as l (l.id)}
  <div
    data-id={l.id}
    class="dlabel"
    class:below={l.below}
    class:sel={l.sel}
    class:ghost={l.ghost}
    class:inked={!!l.color}
    class:wrapped={!!l.maxW}
    class:typing={!!l.edit}
    style="left: {l.x}px; top: {l.y}px; --ink: {inkVar(l.color)};{l.maxW ? ` max-width: ${l.maxW}px;` : ''}"
    in:fade={{ duration: 200 }}
  >
    {@html render(l.text, l.edit)}
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
  :global(.dlabel.sel:not(.inked)) {
    color: var(--accent);
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
  :global(.dlabel .lsel) {
    background: var(--text-sel);
    border-radius: 2px;
  }
  /* zero width: the text around it stays where it is */
  :global(.dlabel .lcaret) {
    display: inline-block;
    position: relative;
    width: 0;
    height: 1.15em;
    vertical-align: text-bottom;
  }
  :global(.dlabel .lcaret)::after {
    content: '';
    position: absolute;
    left: -0.5px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: currentColor;
    animation: lcaret-blink 1s steps(1) infinite;
  }
  @keyframes -global-lcaret-blink {
    50% {
      opacity: 0;
    }
  }
</style>
