<script lang="ts">
  import { fly } from 'svelte/transition';
  import { keyLabel, type Editor } from '$lib/editor.svelte';

  let { ed }: { ed: Editor } = $props();

  const LABEL: Record<string, string> = {
    text: 'TEXT', math: 'MATH', pick: 'DRAW', style: 'DRAW', hint: 'JUMP', palette: 'CMD', label: 'LABEL',
  };
  const HINTS: Record<string, string> = {
    text: '$ math · \\ commands · F1 help',
    math: '/ fraction · ^ _ scripts · \\ commands · tab next box · $ or esc back to text',
    pick: '←→↑↓ move · shift+↑↓ bigger / smaller · shift+←→ extend · tab jump labels · enter choose · esc cancel',
    hint: 'type a label to jump · esc cancel',
    palette: 'enter accept · ↑↓ choose · esc cancel',
    label: 'type on the page (click, drag to select) · $…$ math · ←→ ctrl+←→ home end move · shift selects · enter save · esc cancel',
  };
  // a drawing's keys, from the same table as its menu
  const styleHint = $derived(
    ed.mode === 'style' && ed.styling
      ? [...ed.drawingActions(ed.styling).filter((a) => !a.keyOnly && a.name !== 'menu').map((a) => `${keyLabel(a.keys[0])} ${a.name}`), 'enter done', 'right-click or shift+f10 for more'].join(' · ')
      : '',
  );
  // Counts don't need to follow every keystroke: refresh them when typing pauses.
  let counts = $state({ words: 0, maths: 0, drawings: 0 });
  let countTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    ed.version;
    clearTimeout(countTimer);
    countTimer = setTimeout(() => (counts = ed.counts()), counts.words || counts.maths ? 300 : 0);
    return () => clearTimeout(countTimer);
  });
</script>

<footer class="status">
  {#key LABEL[ed.mode]}
    <span class="mode m-{ed.mode}" in:fly={{ y: 6, duration: 160 }}>{LABEL[ed.mode]}</span>
  {/key}
  {#if ed.message}
    <span class="msg" in:fly={{ x: -8, duration: 160 }}>{ed.message}</span>
  {:else}
    <span class="keys">{ed.mode === 'style' ? styleHint : HINTS[ed.mode]}</span>
  {/if}
  <span class="spacer"></span>
  <span class="file" title={ed.file.path ?? 'not saved to a file yet'}>
    {ed.file.name}{#if ed.dirty}<span class="dot" class:warn={!ed.file.path} in:fly={{ y: -4, duration: 150 }}>●</span>{/if}
  </span>
  <span class="stat">{counts.words}w · {counts.maths}∑ · {counts.drawings}↗</span>
  <span class="pos">{ed.b + 1}:{ed.o + 1}</span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 26px;
    padding-right: 12px;
    font-family: var(--mono);
    font-size: 12px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .mode {
    align-self: stretch;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--bg);
    background: var(--mode-text);
    transition: background-color 200ms ease;
  }
  .m-math, .m-palette { background: var(--mode-math); }
  .m-pick, .m-style, .m-hint, .m-label { background: var(--mode-arrow); }
  .keys { overflow: hidden; text-overflow: ellipsis; }
  .msg { color: var(--fg); }
  .spacer { flex: 1; }
  .pos { color: var(--fg); }
  .file { color: var(--fg); }
  .dot { margin-left: 6px; font-size: 9px; color: var(--muted); vertical-align: 1px; }
  .dot.warn { color: var(--arrow); }
</style>
