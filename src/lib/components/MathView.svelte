<script lang="ts">
  import katex from 'katex';
  import type { MathItem } from '$lib/model';
  import { toLatex, type MCursor, type MSelRange } from '$lib/math/latex';

  // Only the commands the editor itself writes: ids on nodes and its own classes. A note file
  // from someone else can't bring links, styles or other HTML into the page.
  const trust = (c: { command: string; class?: string }) =>
    c.command === '\\htmlData' || (c.command === '\\htmlClass' &&/^(nx-[\w-]+\s*)+$/.test(c.class ?? ''));

  let {
    item,
    cursor = null,
    sel = null,
    selected = false,
    pad,
    eqn,
  }: { item: MathItem; cursor?: MCursor | null; sel?: MSelRange | null; selected?: boolean; pad?: { above?: number; below?: number }; eqn?: string } = $props();

  // a reference: its label as text in the page's own font (no formula to typeset)
  const ref = $derived(item.root.length === 1 && item.root[0].k === 'sym' && item.root[0].ref ? item.root[0].v : null);
  const html = $derived.by(() => {
    if (ref !== null) return '';
    try {
      return katex.renderToString(toLatex(item.root, true, cursor, sel), {
        displayMode: item.display,
        throwOnError: false,
        trust,
        strict: 'ignore',
        output: 'html',
      });
    } catch (e) {
      return `<span class="nx-err">${String(e)}</span>`;
    }
  });
</script>

<span
  class="math"
  class:display={item.display}
  class:editing={!!cursor}
  class:selected
  class:ref={ref !== null}
  data-nx={item.id}
  style={pad ? `padding-top: ${pad.above ?? 0}px; padding-bottom: ${pad.below ?? 0}px` : undefined}
>{#if ref !== null}<span class="nx-ref">{ref}</span>{:else}{@html html}{/if}{#if eqn}<span class="eqn">{eqn}</span>{/if}</span>

<style>
  .math {
    display: inline-block;
    padding: 0 2px;
    border-radius: 4px;
    transition: background-color 160ms ease, box-shadow 160ms ease;
  }
  .math.display {
    display: block;
    position: relative;
    text-align: center;
    margin: 0.4em 0;
  }
  /* a numbered formula's number, at the right as in a book */
  .eqn {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    font-family: var(--prose);
    font-size: 0.95em;
    color: var(--muted);
    pointer-events: none;
    user-select: none;
  }
  /* a reference: its label as a link (ctrl+click goes there) */
  .math.ref {
    padding: 0;
    cursor: pointer;
  }
  .nx-ref {
    color: var(--link, var(--accent));
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--link, var(--accent)) 40%, transparent);
    text-underline-offset: 0.18em;
  }
  .math.selected {
    background: var(--text-sel);
  }
  /* (the frame of the formula being edited is drawn by the editor: see .mathframe) */
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
  /* (the selection is drawn by the editor as a box over the selected part's full height) */
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
