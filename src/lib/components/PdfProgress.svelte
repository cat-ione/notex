<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Editor } from '$lib/editor.svelte';

  // The PDF being made, shown as it's made: a sheet of paper for each of its pages, blank to
  // start with, a line running down the ones being drawn, and each one's picture dropping in
  // as it's done. A panel like the others (settings, help), over the page while it's laid out
  // for paper (Editor.pdfInBrowser).
  let { ed }: { ed: Editor } = $props();

  const m = $derived(ed.paper.pdfMaking!);
  const done = $derived(m.pictures.filter(Boolean).length);
  // (fewer sheets, bigger: all of them in view)
  const size = $derived(m.count <= 3 ? 112 : m.count <= 8 ? 80 : m.count <= 18 ? 60 : m.count <= 40 ? 42 : 30);
</script>

<!-- (in the screen's theme; the page under it, which has the PDF's for now, hidden) -->
<div class="making" role="status" aria-live="polite" style={m.theme} transition:fade={{ duration: 120 }}>
  <div class="panel">
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
    <div class="hint"><kbd>esc</kbd> stops it</div>
  </div>
</div>

<style>
  /* (the screen's page dimmed, as under settings: the page itself is hidden) */
  .making {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: linear-gradient(var(--scrim), var(--scrim)), var(--bg);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    width: min(460px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    padding: 16px 18px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    animation: pop 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: baseline;
  }
  .what {
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
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
    padding: 4px 0;
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
    font-size: 11.5px;
    text-align: right;
  }
  kbd {
    font: inherit;
    color: var(--fg);
  }
  @keyframes pop {
    from {
      transform: scale(0.96) translateY(6px);
      opacity: 0;
    }
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
