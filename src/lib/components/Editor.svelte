<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut, backOut } from 'svelte/easing';
  import { Editor } from '$lib/editor.svelte';
  import MathView from './MathView.svelte';
  import ArrowLayer from './ArrowLayer.svelte';
  import MarkLayer from './MarkLayer.svelte';
  import LabelLayer from './LabelLayer.svelte';
  import StatusLine from './StatusLine.svelte';
  import Help from './Help.svelte';
  import Settings from './Settings.svelte';
  import { isDesktop, setWindowTitle } from '$lib/files';

  const ed = new Editor();
  let page: HTMLElement;

  onMount(() => {
    ed.page = page;
    const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, f);
      return () => window.removeEventListener(type, f);
    };
    const offs = [
      on('keydown', (e) => ed.key(e)),
      on('copy', (e) => ed.copy(e, false)),
      on('cut', (e) => ed.copy(e, true)),
      on('paste', (e) => ed.paste(e)),
      on('mousemove', (e) => ed.mouseMove(e)),
      on('mouseup', () => ed.mouseUp()),
      // Pick up config edits made in an external editor.
      on('focus', () => isDesktop() && ed.loadConfig()),
    ];
    ed.loadConfig();
    const ro = new ResizeObserver(() => ed.layout());
    ro.observe(page);
    document.fonts?.ready.then(() => ed.layout());
    return () => {
      offs.forEach((off) => off());
      ro.disconnect();
    };
  });

  // Re-measure overlays after every state change has hit the DOM.
  $effect(() => {
    ed.version;
    ed.afterRender();
  });

  // Debounced autosave.
  let saveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    ed.version;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      ed.pruneDrawings();
      ed.persist();
    }, 600);
  });

  $effect(() => {
    setWindowTitle(`${ed.dirty ? '● ' : ''}${ed.file.name} — notex`);
  });


  const editingMath = (b: number, o: number) => ed.inFormula && ed.b === b && ed.o === o;
  const SIGIL = { math: 'ƒ', text: '❯', draw: '✎' };
</script>

<div class="shell">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroller" onmousedown={(e) => ed.mouseDown(e)}>
    <div class="page" bind:this={page}>
      <MarkLayer {ed} under />
      {#each ed.doc.blocks as blk, b (blk.id)}
        <div class="block {blk.kind}" class:current={ed.b === b} data-nx={blk.id}>
          {#each blk.items as it, o (it.id)}
            {#if it.t === 'c'}
              <span class="ch" class:sel={ed.isSelected(b, o)} data-nx={it.id}>{it.ch}</span>
            {:else}
              <MathView item={it} cursor={editingMath(b, o) ? ed.mc : null} sel={editingMath(b, o) ? ed.mathSelRange : null} selected={ed.isSelected(b, o)} />
            {/if}
          {/each}<span class="eol" data-eol={blk.id}>&#8203;</span>
        </div>
      {/each}

      <MarkLayer {ed} />
      <ArrowLayer {ed} />
      <LabelLayer {ed} />

      {#if ed.caret}
        <div
          class="caret {ed.caret.shape}"
          style="transform: translate({ed.caret.r.x}px, {ed.caret.r.y}px); width: {ed.caret.r.w}px; height: {ed.caret.r.h}px;"
        ></div>
      {/if}

      {#if ed.pickRects.from}
        {@const r = ed.pickRects.from}
        <div class="pick from" style="transform: translate({r.x - 3}px, {r.y - 3}px); width: {r.w + 6}px; height: {r.h + 6}px;"></div>
      {/if}
      {#if ed.pickRects.cur}
        {@const r = ed.pickRects.cur}
        <div class="pick cur" style="transform: translate({r.x - 3}px, {r.y - 3}px); width: {r.w + 6}px; height: {r.h + 6}px;"></div>
      {/if}

      {#if ed.hints}
        {#each ed.hints.list as h (h.label)}
          {#if h.label.startsWith(ed.hints.typed)}
            <div class="hint" style="left: {h.rect.x - 4}px; top: {h.rect.y - 12}px;" transition:scale={{ duration: 140, start: 0.4, easing: backOut }}>
              <span class="typed">{ed.hints.typed}</span>{h.label.slice(ed.hints.typed.length)}
            </div>
          {/if}
        {/each}
      {/if}

      {#if ed.palette && ed.caret}
        {@const up = (ed.page?.getBoundingClientRect().top ?? 0) + ed.caret.r.y + ed.caret.r.h + 300 > window.innerHeight - 30}
        <div
          class="palette"
          style="left: {ed.caret.r.x}px; top: {up ? ed.caret.r.y - 6 : ed.caret.r.y + ed.caret.r.h + 6}px; {up ? 'transform: translateY(-100%);' : ''}"
          transition:fly={{ y: up ? 6 : -6, duration: 140, easing: cubicOut }}
        >
          <div class="prompt"><span class="sigil">{SIGIL[ed.palette.ctx]}</span> {ed.palette.ctx === 'draw' ? '' : '\\'}{ed.palette.query}<span class="blink">▏</span></div>
          {#each ed.paletteItems as item, i (item.name)}
            <div class="opt" class:sel={i === ed.palette.sel}>
              <span class="name">{#if item.draw && ed.palette.ctx !== 'draw'}<span class="pen">✎</span>{/if}{item.name}</span><span class="desc">{item.desc}</span>
            </div>
          {:else}
            <div class="opt empty">{ed.palette.ctx === 'math' ? `insert \\${ed.palette.query}` : 'no match'}</div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <StatusLine {ed} />

  {#if ed.showSettings}
    <Settings {ed} />
  {/if}

  {#if ed.showHelp}
    <div class="help-wrap" transition:fade={{ duration: 120 }}>
      <Help />
    </div>
  {/if}
</div>

<style>
  .shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
  }
  .scroller {
    flex: 1;
    cursor: text;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .page {
    position: relative;
    max-width: var(--page-width, 820px);
    margin: 0 auto;
    padding: 48px 32px 40vh;
    font-family: var(--prose);
    font-size: var(--font-size, 16px);
    line-height: 2.1;
    /* own stacking context so highlights (z-index -1) sit behind the text, not behind the page */
    isolation: isolate;
  }
  .block {
    white-space: pre-wrap;
    word-wrap: break-word;
    min-height: 2.1em;
    position: relative;
    padding-left: 0;
    transition: background-color 200ms ease;
  }
  .block::before {
    content: '';
    position: absolute;
    left: -18px;
    top: 0.55em;
    bottom: 0.55em;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0;
    transform: scaleY(0.3);
    transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  .block.current::before {
    opacity: 0.55;
    transform: scaleY(1);
  }
  .block.h1 {
    font-family: var(--mono);
    font-size: 1.7em;
    font-weight: 700;
    line-height: 1.6;
    margin-top: 0.4em;
    color: var(--heading);
  }
  .block.h1::after {
    content: '';
    display: block;
    height: 1px;
    background: linear-gradient(90deg, var(--border), transparent);
  }
  .block.h2 {
    font-family: var(--mono);
    font-size: 1.25em;
    font-weight: 600;
    margin-top: 0.6em;
    color: var(--heading);
  }
  .block.h3 {
    font-family: var(--mono);
    font-size: 1.05em;
    font-weight: 600;
    color: var(--heading);
  }
  .block.h1::before, .block.h2::before, .block.h3::before { top: 0.4em; bottom: 0.4em; }
  .block.li {
    padding-left: 1.4em;
  }
  .block.li::after {
    content: '▸';
    position: absolute;
    left: 0.2em;
    top: 0;
    color: var(--accent);
    font-size: 0.85em;
  }
  .ch.sel {
    background: var(--text-sel);
  }
  .eol {
    display: inline-block;
    width: 0;
  }

  .caret {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    transition:
      transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 90ms ease,
      height 90ms ease,
      background-color 150ms ease;
    border-radius: 1px;
    z-index: 3;
  }
  .caret.bar {
    background: var(--caret);
    animation: blink 1.1s steps(1) infinite 0.5s;
  }
  .caret.math {
    background: var(--accent);
    animation: blink 1.1s steps(1) infinite 0.5s;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .pick {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 5px;
    pointer-events: none;
    transition:
      transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.15),
      width 140ms cubic-bezier(0.2, 0.9, 0.3, 1.15),
      height 140ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
  }
  .pick.cur {
    border: 1.5px solid var(--accent);
    background: var(--pick-bg);
    box-shadow: 0 0 0 4px var(--pick-glow);
  }
  .pick.from {
    border: 1.5px dashed var(--muted);
  }

  .hint {
    position: absolute;
    z-index: 5;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 3px;
    background: var(--hint-bg);
    color: var(--hint-fg);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint .typed {
    opacity: 0.45;
  }

  .palette {
    position: absolute;
    z-index: 6;
    min-width: 260px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .prompt {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--fg);
  }
  .sigil {
    color: var(--accent);
    margin-right: 4px;
  }
  .blink {
    color: var(--accent);
    animation: blink 1s steps(1) infinite;
  }
  .opt {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 2px 10px;
    color: var(--muted);
    transition: background-color 80ms ease;
  }
  .opt .name {
    color: var(--fg);
  }
  .opt.sel {
    background: var(--sel-bg);
  }
  .opt.sel .name {
    color: var(--accent);
  }
  .opt.sel .name::before {
    content: '› ';
  }
  .opt .pen {
    color: var(--arrow);
    margin-right: 4px;
  }
  .opt.empty {
    font-style: italic;
  }
  .help-wrap {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--scrim);
    z-index: 20;
  }
</style>
