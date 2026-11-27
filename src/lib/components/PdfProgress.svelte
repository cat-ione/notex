<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';

  // The PDF being made, shown as it's made: a sheet of paper for each of its pages, blank to
  // start with, a line running down the ones being drawn, and each one's picture dropping in
  // as it's done. Over the page while it's laid out for paper (Editor.pdfInBrowser).
  let { ed }: { ed: Editor } = $props();

  const m = $derived(ed.pdfMaking!);
  const done = $derived(m.pictures.filter(Boolean).length);
  // (fewer sheets, bigger: all of them in view)
  const size = $derived(m.count <= 3 ? 168 : m.count <= 8 ? 124 : m.count <= 18 ? 92 : m.count <= 40 ? 64 : 44);
</script>

<div class="making" role="status" aria-live="polite" transition:fade={{ duration: 120 }}>
  <div class="head">
    <span class="what">making the PDF</span>
    <span class="count">{m.count ? `${done} / ${m.count}` : '…'} {m.count === 1 ? 'sheet' : 'sheets'}</span>
  </div>
  <div class="bar"><div class="fill" style:transform="scaleX({m.count ? done / m.count : 0})"></div></div>
  <div class="sheets" style:--w="{size}px">
    {#each { length: m.count } as _, i (i)}
      <div
        class="sheet"
        class:drawing={!m.pictures[i] && m.drawing.includes(i)}
        class:done={!!m.pictures[i]}
        style:aspect-ratio={m.paper}
        style:background={m.bg}
        style:padding="{m.margin * size}px"
      >
        {#if m.pictures[i]}
          <img src={m.pictures[i]} alt="sheet {i + 1}" />
        {:else}
          <div class="lines"></div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="hint">esc cancels</div>
</div>

<style>
  .making {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px 16px;
    overflow: auto;
    background: color-mix(in srgb, var(--fg) 7%, var(--bg));
    color: var(--muted);
    font-family: var(--mono);
    font-size: 13px;
  }
  .head {
    display: flex;
    gap: 16px;
    align-items: baseline;
  }
  .what {
    color: var(--fg);
  }
  .what::after {
    content: '▌';
    margin-left: 2px;
    color: var(--accent);
    animation: blink 1s steps(1) infinite;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .bar {
    width: min(420px, 80vw);
    height: 2px;
    background: color-mix(in srgb, var(--fg) 12%, transparent);
    border-radius: 1px;
    overflow: hidden;
  }
  /* (moved by transforms, here and below: they go on while drawing a sheet keeps the page busy) */
  .fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform 200ms ease-out;
  }
  .sheets {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: calc(var(--w) * 0.12);
    max-width: min(1100px, 92vw);
  }
  /* a sheet: an outline to fill, the paper's colour once it's being drawn */
  .sheet {
    position: relative;
    width: var(--w);
    box-sizing: border-box;
    border-radius: 2px;
    outline: 1px dashed color-mix(in srgb, var(--fg) 25%, transparent);
    outline-offset: -1px;
    overflow: hidden;
    opacity: 0.45;
    transition: opacity 200ms ease, box-shadow 200ms ease;
  }
  .sheet.drawing,
  .sheet.done {
    opacity: 1;
    outline: none;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18), 0 6px 18px rgb(0 0 0 / 0.14);
  }
  /* what's being drawn: faint lines of text, and a line running down it */
  .lines {
    height: 100%;
    background: repeating-linear-gradient(to bottom, transparent 0 6%, color-mix(in srgb, var(--muted) 22%, transparent) 6% 8%);
    opacity: 0;
  }
  .drawing .lines {
    opacity: 1;
    animation: breathe 1.4s ease-in-out infinite;
  }
  .drawing::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 18%;
    transform: translateY(-100%);
    background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 35%, transparent) 85%, var(--accent));
    animation: scan 1.1s linear infinite;
  }
  /* done: its picture drops in */
  .sheet img {
    display: block;
    width: 100%;
    animation: land 320ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .done {
    animation: settle 320ms ease-out;
  }
  .hint {
    font-size: 11px;
    opacity: 0.7;
  }
  @keyframes scan {
    to {
      transform: translateY(560%);
    }
  }
  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }
  @keyframes land {
    from {
      opacity: 0;
      transform: translateY(-14%);
    }
  }
  @keyframes settle {
    from {
      transform: scale(1.05);
    }
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .making *,
    .making *::before,
    .making *::after {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
