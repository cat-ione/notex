<script lang="ts">
  // Typing a shape's label (or a text): a text field over it. Enter or Esc is done (shift+enter
  // a new line); ctrl+arrow is done and adds a box beside it, joined by an arrow, to type in next.
  import { onMount, tick, untrack } from 'svelte';
  import type { Editor } from '$lib/editor.svelte';
  import { renderLabel } from '$lib/labels';
  import { labelled, lineLabelBox, lookupIn, type BoxShape, type LineShape } from '$lib/sketch/shapes';

  let { ed }: { ed: Editor } = $props();

  // (the shape being labelled when this opened: a new one is a new editor)
  const id = untrack(() => ed.sketch.editing!);
  const shape = $derived(ed.sketch.shapes().find((s) => s.id === id) as BoxShape | LineShape | undefined);
  const isText = $derived(shape?.k === 'text');
  // a graph: what to plot, at its top left (the graph showing as it's typed)
  const isPlot = $derived(shape?.k === 'plot');
  // (a line's label: a box round its middle)
  const at = $derived(!shape ? null : ed.sketch.pageBox(shape.k === 'line' ? lineLabelBox(shape, lookupIn(ed.sketch.shapes())) : shape));

  let value = $state(untrack(() => (ed.sketch.shapes().find((s) => s.id === id) as BoxShape | LineShape | undefined)?.label ?? ''));
  let area: HTMLTextAreaElement | undefined = $state();
  let mirror: HTMLDivElement | undefined = $state();

  /** How big the text is, rendered (a text shape is as big as what it says). */
  async function size() {
    await tick();
    if (!mirror) return undefined;
    const r = mirror.getBoundingClientRect();
    const m = at && shape && shape.k !== 'line' ? at.w / Math.max(1, shape.w) : 1;
    return { w: Math.max(24, r.width / (m || 1)), h: Math.max(22, r.height / (m || 1)) };
  }

  async function save() {
    if (!shape) return;
    // (a box grows to hold what it says; a line's label sits on it as it is)
    ed.sketch.setLabel(id, value, shape.k === 'line' || shape.k === 'plot' ? undefined : await size());
    ed.touch();
  }

  let closed = false;
  async function done(then?: () => void) {
    // (once: Enter, then the blur as this goes away)
    if (closed) return;
    closed = true;
    await save();
    ed.sketch.commitLabel(id);
    then?.();
    ed.touch();
  }

  function keydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      done();
    } else if (e.ctrlKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dir = e.key.slice(5) as 'Left' | 'Right' | 'Up' | 'Down';
      done(() => ed.sketch.grow(dir));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      done();
    }
  }

  onMount(() => {
    area?.focus();
    area?.select();
  });
</script>

{#if shape && at && labelled(shape)}
  <div class="lbl-edit" class:text={isText || isPlot} class:plot={isPlot} style="left: {at.x + (isPlot ? 6 : 0)}px; top: {at.y + (isPlot ? 6 : 0)}px; width: {isText || isPlot ? 'max-content' : `${at.w}px`}; height: {isText || isPlot ? 'auto' : `${at.h}px`}; --c: {shape.color ? `var(--ink-${shape.color})` : 'var(--fg)'}">
    <textarea
      bind:this={area}
      bind:value
      rows={Math.max(1, value.split('\n').length)}
      spellcheck="false"
      placeholder={isPlot ? 'y = sin x   (shift+enter: another; x: -pi..pi)' : isText ? 'text, $math$' : 'label, $math$'}
      oninput={save}
      onkeydown={keydown}
      onblur={() => done()}
      onpointerdown={(e) => e.stopPropagation()}
    ></textarea>
  </div>
  <!-- (the label as it will look, to measure a text by) -->
  <div class="mirror" bind:this={mirror} aria-hidden="true">{@html renderLabel(value || ' ')}</div>
{/if}

<style>
  .lbl-edit {
    position: absolute;
    z-index: 9;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  textarea {
    width: 100%;
    min-width: 6ch;
    max-height: 100%;
    padding: 2px 6px;
    box-sizing: border-box;
    border: 1px dashed var(--accent);
    border-radius: 4px;
    outline: none;
    resize: none;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    color: var(--c);
    font-family: var(--prose);
    font-size: 15px;
    line-height: 1.3;
    text-align: center;
    caret-color: var(--caret);
  }
  .text textarea {
    text-align: left;
    width: auto;
    min-width: 12ch;
    field-sizing: content;
    max-height: none;
  }
  .plot textarea {
    min-width: 30ch;
    font-family: var(--mono);
    font-size: 13px;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
  }
  .mirror {
    position: absolute;
    left: -9999px;
    top: 0;
    max-width: 420px;
    padding: 0 2px;
    font-family: var(--prose);
    font-size: 15px;
    line-height: 1.3;
    white-space: pre;
    visibility: hidden;
  }
</style>
