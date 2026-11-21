<script lang="ts">
  import katex from 'katex';
  import type { MathItem } from '$lib/model';
  import { toLatex, type MCursor, type MSelRange } from '$lib/math/latex';

  let { item, cursor = null, sel = null, selected = false }: { item: MathItem; cursor?: MCursor | null; sel?: MSelRange | null; selected?: boolean } = $props();

  const html = $derived.by(() => {
    try {
      return katex.renderToString(toLatex(item.root, true, cursor, sel), {
        displayMode: item.display,
        throwOnError: false,
        trust: true,
        strict: 'ignore',
        output: 'html',
      });
    } catch (e) {
      return `<span class="nx-err">${String(e)}</span>`;
    }
  });
</script>

<span class="math" class:display={item.display} class:editing={!!cursor} class:selected data-nx={item.id}>{@html html}</span>

<style>
  .math {
    display: inline-block;
    padding: 0 2px;
    border-radius: 4px;
    transition: background-color 160ms ease, box-shadow 160ms ease;
  }
  .math.display {
    display: block;
    text-align: center;
    margin: 0.4em 0;
  }
  .math.selected {
    background: var(--text-sel);
  }
  .math.editing {
    background: var(--math-edit-bg);
    box-shadow: 0 0 0 1px var(--math-edit-ring);
  }
  .math :global(.katex) {
    font-size: 1.12em;
  }
  .math :global(.katex-display) {
    margin: 0.2em 0;
  }
  .math :global(.nx-empty) {
    color: var(--muted);
    opacity: 0.7;
  }
  .math :global(.nx-sel) {
    background: var(--text-sel);
    border-radius: 2px;
  }
  .math :global(.nx-active-row) {
    background: var(--active-row);
    border-radius: 2px;
  }
  .math :global(.nx-err) {
    color: var(--danger);
    font-family: var(--mono);
    font-size: 0.8em;
  }
</style>
