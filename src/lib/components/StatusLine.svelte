<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';

  let { ed }: { ed: Editor } = $props();

  const LABEL: Record<string, string> = {
    text: 'TEXT', math: 'MATH', pick: 'ARROW', style: 'ARROW', hint: 'JUMP', palette: 'CMD', label: 'LABEL',
  };
  const HINTS: Record<string, string> = {
    text: '$ math · \\ commands · F1 help',
    math: '/ fraction · ^ _ scripts · \\ commands · tab next box · $ or esc back to text',
    pick: '←→↑↓ move · shift+↑↓ bigger / smaller · shift+←→ extend · tab jump labels · enter choose · esc cancel',
    style: '↑↓ bend · t heads · d dashed · b boxes · l label · r reverse · del remove · enter done',
    hint: 'type a label to jump · esc cancel',
    palette: 'enter accept · ↑↓ choose · esc cancel',
    label: 'enter save · esc cancel',
  };
  const counts = $derived.by(() => {
    ed.version;
    let words = 0, maths = 0;
    for (const b of ed.doc.blocks) {
      let inWord = false;
      for (const it of b.items) {
        if (it.t === 'm') { maths++; inWord = false; }
        else if (/\s/.test(it.ch)) inWord = false;
        else if (!inWord) { words++; inWord = true; }
      }
    }
    return { words, maths, arrows: ed.doc.arrows.length };
  });
</script>

<footer class="status">
  {#key LABEL[ed.mode]}
    <span class="mode m-{ed.mode}" in:fly={{ y: 6, duration: 160 }}>{LABEL[ed.mode]}</span>
  {/key}
  {#if ed.mode === 'label' && ed.label}
    <span class="input">label: {ed.label.text}<span class="blink">▏</span></span>
  {:else if ed.message}
    <span class="msg" in:fly={{ x: -8, duration: 160 }}>{ed.message}</span>
  {:else}
    <span class="keys">{HINTS[ed.mode]}</span>
  {/if}
  <span class="spacer"></span>
  <span class="file" title={ed.file.path ?? 'not saved to a file yet'}>
    {ed.file.name}{#if ed.dirty}<span class="dot" class:warn={!ed.file.path} in:fly={{ y: -4, duration: 150 }}>●</span>{/if}
  </span>
  <span class="stat">{counts.words}w · {counts.maths}∑ · {counts.arrows}↗</span>
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
  .input { color: var(--fg); }
  .blink { color: var(--accent); animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .spacer { flex: 1; }
  .pos { color: var(--fg); }
  .file { color: var(--fg); }
  .dot { margin-left: 6px; font-size: 9px; color: var(--muted); vertical-align: 1px; }
  .dot.warn { color: var(--arrow); }
</style>
