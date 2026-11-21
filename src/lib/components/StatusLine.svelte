<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';

  let { ed }: { ed: Editor } = $props();

  const LABEL: Record<string, string> = {
    normal: 'NORMAL', insert: 'INSERT', math: 'MATH', pick: 'ARROW', style: 'STYLE',
    hint: 'JUMP', palette: 'CMD', label: 'LABEL',
  };
  const HINTS: Record<string, string> = {
    normal: 'i insert · f arrow · ga arrows · \\ cmd · ? help',
    insert: '$ math · \\ cmd · esc normal',
    math: '/ frac · ^ _ scripts · ;a greek · \\ cmd · space out · $ exit',
    pick: 'hjkl move · K/J out/in · H/L extend · f jump · ⏎ confirm',
    style: 'j/k bend · r reverse · t heads · d dash · b box · i label · x del',
    hint: 'type a label',
    palette: '⏎ accept · ↑↓ choose · esc cancel',
    label: '⏎ save · esc cancel',
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
  {#key ed.mode}
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
    background: var(--mode-normal);
    transition: background-color 200ms ease;
  }
  .m-insert { background: var(--mode-insert); }
  .m-math, .m-palette { background: var(--mode-math); }
  .m-pick, .m-style, .m-hint, .m-label { background: var(--mode-arrow); }
  .msg { color: var(--fg); }
  .input { color: var(--fg); }
  .blink { color: var(--accent); animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .spacer { flex: 1; }
  .pos { color: var(--fg); }
</style>
