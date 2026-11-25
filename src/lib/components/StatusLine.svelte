<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { keyLabel, type Editor } from '$lib/editor.svelte';

  let { ed }: { ed: Editor } = $props();

  const LABEL: Record<string, string> = {
    text: 'TEXT', math: 'MATH', pick: 'DRAW', style: 'DRAW', hint: 'JUMP', palette: 'CMD', label: 'LABEL',
  };
  const HINTS: Record<string, string> = {
    text: '$ math · \\ commands · F1 help',
    math: '/ fraction · ^ _ scripts · \\ commands · tab next box · $ or esc exit math',
    pick: '←→↑↓ move · shift+↑↓ parent / child · shift+←→ extend · tab jump labels · enter choose · esc cancel',
    hint: 'type a label to jump · esc cancel',
    palette: 'enter accept · ↑↓ choose · esc cancel',
    label: 'enter save · esc cancel',
  };
  // typing a note: NOTE (in its math: MATH, as on the page)
  const name = $derived(ed.note && ed.mode === 'text' ? 'NOTE' : LABEL[ed.mode]);
  // a drawing's keys, from the same table as its menu
  const styleHint = $derived(
    ed.mode === 'style' && ed.styling
      ? [
          ...(ed.stylingMark ? [] : ['↑↓←→ bend']),
          // (what the menu shows; the step-by-step keys are in the menu's tooltips and F1)
          ...ed.drawingActions(ed.styling).filter((a) => a.menu !== false && !a.keyOnly).map((a) => `${keyLabel(a.keys[0])} ${a.name}`),
          'enter done',
          'shift+f10 more',
        ].join(' · ')
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
  {#key name}
    <span class="mode m-{ed.note ? 'label' : ed.mode}" in:fly={{ y: 6, duration: 160 }}>{name}</span>
  {/key}
  {#if ed.message}
    <span class="msg" in:fly={{ x: -8, duration: 160 }}>{ed.message}</span>
  {:else if ed.tipText}
    <span class="tip" in:fade={{ duration: 300 }}><span class="tag">tip</span>{ed.tipText}</span>
  {:else}
    <span class="keys">{ed.mode === 'style' ? styleHint : ed.note && ed.mode === 'text' ? HINTS.label : HINTS[ed.mode]}</span>
  {/if}
  <span class="spacer"></span>
  <!-- (the toolbar shows the note's name) -->
  {#if !ed.config.ui.toolbar}
    <span class="file" data-tip={ed.savedWhere} data-tip-key="ctrl+s">
      {ed.file.name}{#if ed.dirty}<span class="dot" class:warn={!ed.file.path} in:fly={{ y: -4, duration: 150 }}>●</span>{/if}
    </span>
  {/if}
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
  .tip { color: var(--muted); }
  .tip .tag { margin-right: 8px; padding: 0 5px; border: 1px solid var(--border); border-radius: 3px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .spacer { flex: 1; }
  .pos { color: var(--fg); }
  .file { color: var(--fg); }
  .dot { margin-left: 6px; font-size: 9px; color: var(--muted); vertical-align: 1px; }
  .dot.warn { color: var(--arrow); }
</style>
