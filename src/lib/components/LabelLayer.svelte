<script lang="ts">
  import { fade } from 'svelte/transition';
  import katex from 'katex';
  import type { Editor } from '$lib/editor.svelte';
  import { inkVar } from '$lib/marks';

  // Labels on arrows and notes on shapes. HTML rather than SVG text so they can
  // contain $math$.
  let { ed }: { ed: Editor } = $props();

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const cache = new Map<string, string>();
  function render(text: string): string {
    let html = cache.get(text);
    if (html === undefined) {
      html = text
        .split(/(\$[^$]+\$)/)
        .map((part) =>
          /^\$[^$]+\$$/.test(part)
            ? katex.renderToString(part.slice(1, -1), { throwOnError: false, strict: 'ignore', output: 'html' })
            : esc(part),
        )
        .join('');
      if (cache.size > 200) cache.clear();
      cache.set(text, html);
    }
    return html;
  }

  type L = { id: string; text: string; x: number; y: number; below: boolean; color?: string; sel: boolean; ghost: boolean };
  const labels = $derived.by(() => {
    const out: L[] = [];
    const ghost = ed.pick?.edit?.id;
    // While a label is being typed, show the draft in place.
    const draft = (id: string, text: string) => (ed.mode === 'label' && ed.label && ed.styling === id ? ed.label.text + '▏' : text);
    for (const a of ed.doc.arrows) {
      const g = ed.arrowGeos[a.id];
      const text = draft(a.id, a.label);
      if (g && text) out.push({ id: a.id, text, x: g.mid.x, y: g.mid.y - 4, below: false, color: a.color, sel: ed.styling === a.id, ghost: ghost === a.id });
    }
    for (const m of ed.doc.marks) {
      const g = ed.markGeos[m.id];
      const text = draft(m.id, m.label);
      if (!g || !text) continue;
      // label.y is a text baseline: shift to the box's top (below) or bottom (above) edge
      const y = g.label.below ? g.label.y - 12 : g.label.y + 3;
      out.push({ id: m.id, text, x: g.label.x, y, below: g.label.below, color: m.color, sel: ed.styling === m.id, ghost: ghost === m.id });
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
    style="left: {l.x}px; top: {l.y}px; --ink: {inkVar(l.color)}"
    in:fade={{ duration: 200 }}
  >
    {@html render(l.text)}
  </div>
{/each}

<style>
  .dlabel {
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
  .dlabel.below {
    transform: translate(-50%, 0);
  }
  .dlabel.sel:not(.inked) {
    color: var(--accent);
  }
  .dlabel.ghost {
    opacity: 0.25;
  }
  .dlabel :global(.katex) {
    font-size: 1.15em;
  }
</style>
