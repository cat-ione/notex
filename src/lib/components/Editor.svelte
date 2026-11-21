<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut, backOut } from 'svelte/easing';
  import { Editor } from '$lib/editor.svelte';
  import MathView from './MathView.svelte';
  import ArrowLayer from './ArrowLayer.svelte';
  import MarkLayer from './MarkLayer.svelte';
  import LabelLayer from './LabelLayer.svelte';
  import DrawingMenu from './DrawingMenu.svelte';
  import DrawingBar from './DrawingBar.svelte';
  import FindBar from './FindBar.svelte';
  import Tooltip from './Tooltip.svelte';
  import StatusLine from './StatusLine.svelte';
  import Help from './Help.svelte';
  import Settings from './Settings.svelte';
  import { isDesktop, setWindowTitle } from '$lib/files';

  const ed = new Editor();
  let page: HTMLElement;

  onMount(() => {
    ed.page = page;
    // layout experiments: window.__nx (see $lib/dev)
    if (import.meta.env.DEV || location.search.includes('lab')) import('$lib/dev').then((d) => d.install(ed));
    // (not passive: the wheel over a selected drawing changes it instead of scrolling)
    const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, f, { passive: false });
      return () => window.removeEventListener(type, f);
    };
    const offs = [
      on('keydown', (e) => ed.key(e)),
      on('copy', (e) => ed.copy(e, false)),
      on('cut', (e) => ed.copy(e, true)),
      on('paste', (e) => ed.paste(e)),
      on('mousemove', (e) => ed.mouseMove(e)),
      on('mouseup', () => ed.mouseUp()),
      on('wheel', (e) => ed.wheel(e)),
      // no browser menu (Back, Reload, Inspect…): the page and drawings have their own;
      // text fields keep theirs, for spelling and the like
      on('contextmenu', (e) => {
        if (!(e.target as Element | null)?.closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault();
      }),
      // Pick up config edits made in an external editor.
      on('focus', () => isDesktop() && ed.loadConfig()),
    ];
    ed.loadConfig();
    // Height changes come from content, which lays out after rendering anyway;
    // only a change of width (window, settings) needs a fresh layout here.
    let width = page.clientWidth;
    const ro = new ResizeObserver(() => {
      if (page.clientWidth === width) return;
      width = page.clientWidth;
      ed.relayoutAll();
    });
    ro.observe(page);
    document.fonts?.ready.then(() => ed.relayoutAll());
    // KaTeX loads some fonts (big delimiters, scripts) only when first used, which moves glyphs
    const relayout = () => (ed.fontEpoch++, ed.relayoutAll());
    document.fonts?.addEventListener('loadingdone', relayout);
    return () => {
      document.fonts?.removeEventListener('loadingdone', relayout);
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
  const SIGIL = { math: 'ƒ', text: '❯', draw: '✎', style: '✎' };

  // numbered list items: each counts on from the one before at its depth (a bullet at that
  // depth, or anything that isn't a list, starts again; going back out keeps the outer count)
  const listNums = $derived.by(() => {
    const out: (number | undefined)[] = [];
    const count: number[] = [];
    for (const blk of ed.doc.blocks) {
      if (blk.kind !== 'li' && blk.kind !== 'ol') {
        count.length = 0;
        out.push(undefined);
        continue;
      }
      const d = blk.indent ?? 0;
      count.length = d + 1;
      count[d] = blk.kind === 'ol' ? (count[d] ?? 0) + 1 : 0;
      out.push(blk.kind === 'ol' ? count[d] : undefined);
    }
    return out;
  });
</script>

<!-- Invisible line spacers that make room for drawings, and probes marking the
     line's top and bottom (see Editor.makeRoom).
     A word joiner, so they never add a line break opportunity.
     (Kept on one line: whitespace here would show up in the pre-wrap text.) -->
{#snippet spacer(id: string)}<span class="nx-sp nx-probe" data-pt={id} style="vertical-align: top">&#8288;</span><span class="nx-sp nx-probe" data-pb={id} style="vertical-align: bottom">&#8288;</span>{#if ed.spacers[id]?.below !== undefined}<span class="nx-sp below" data-sp="{id}-below" style="vertical-align: -{ed.spacers[id].below}px">&#8288;</span>{/if}{#if ed.spacers[id]?.above !== undefined}<span class="nx-sp above" data-sp="{id}-above" style="vertical-align: {ed.spacers[id].above}px">&#8288;</span>{/if}{/snippet}

<div class="shell">
  <DrawingMenu {ed} />
  <FindBar {ed} />
  <Tooltip {ed} />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroller" onmousedown={(e) => ed.mouseDown(e)} oncontextmenu={(e) => ed.openPageMenu(e)} onscroll={() => ed.scrolled()}>
    <div class="page" bind:this={page}>
      <MarkLayer {ed} under />
      {#if ed.mathFrame}
        {@const r = ed.mathFrame}
        <div class="mathframe" style="transform: translate({r.x}px, {r.y}px); width: {r.w}px; height: {r.h}px;"></div>
      {/if}
      {#each ed.selRects as r, i (i)}
        <div class="selrect" style="transform: translate({r.x}px, {r.y}px); width: {r.w}px; height: {r.h}px;"></div>
      {/each}
      {#each ed.findRects as f, i (i)}
        <div class="findhit" class:cur={f.cur} style="transform: translate({f.r.x - 1}px, {f.r.y}px); width: {f.r.w + 2}px; height: {f.r.h}px;"></div>
      {/each}
      {#each ed.doc.blocks as blk, b (blk.id)}
        <div class="block {blk.kind}" class:current={ed.b === b} data-nx={blk.id} data-depth={blk.indent || undefined} data-n={listNums[b]} style:--indent={blk.indent || undefined}>
          {#each blk.items as it, o (it.id)}
            {#if it.t === 'c'}
              <span class="ch" class:b={it.b} class:i={it.i} data-nx={it.id}>{it.ch}</span>{#if ed.spacers[it.id]}{@render spacer(it.id)}{/if}
            {:else}
              <MathView item={it} cursor={editingMath(b, o) ? ed.mc : null} sel={editingMath(b, o) ? ed.mathSelRange : null} pad={it.display ? ed.spacers[it.id] : undefined} />{#if !it.display && ed.spacers[it.id]}{@render spacer(it.id)}{/if}
            {/if}
          {/each}<span class="eol" data-eol={blk.id}>&#8203;</span>
        </div>
      {/each}

      <MarkLayer {ed} />
      <ArrowLayer {ed} />
      <LabelLayer {ed} />
      <DrawingBar {ed} />

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

      {#if ed.palette && ed.paletteAnchor}
        {@const at = ed.paletteAnchor}
        {@const up = (ed.page?.getBoundingClientRect().top ?? 0) + at.y + at.h + 300 > window.innerHeight - 30}
        <div
          class="palette"
          style="left: {at.x}px; top: {up ? at.y - 6 : at.y + at.h + 6}px; {up ? 'transform: translateY(-100%);' : ''}"
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
    /* off-screen blocks skip rendering (long notes: every character is an element);
       their last size is remembered so the page doesn't jump */
    content-visibility: auto;
    contain-intrinsic-size: auto 2.1em;
    overflow-clip-margin: 40px;
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
  .block.li,
  .block.ol {
    padding-left: calc(1.4em + var(--indent, 0) * 1.4em);
  }
  .block.li::after {
    content: '▸';
    position: absolute;
    left: calc(0.2em + var(--indent, 0) * 1.4em);
    top: 0;
    color: var(--accent);
    font-size: 0.85em;
  }
  .block.li[data-depth='1']::after,
  .block.li[data-depth='3']::after {
    content: '◦';
  }
  .block.li[data-depth='2']::after,
  .block.li[data-depth='4']::after {
    content: '▹';
  }
  /* numbered: the number (counted in Editor: listNums), right-aligned against the text */
  .block.ol::after {
    content: attr(data-n) '.';
    position: absolute;
    left: calc(var(--indent, 0) * 1.4em - 0.6em);
    width: 1.8em;
    top: 0;
    text-align: right;
    font-family: var(--mono);
    font-size: 0.85em;
    color: var(--accent);
  }
  /* the text selection, drawn behind the text (see Editor.selectionRects) */
  .selrect {
    position: absolute;
    left: 0;
    top: 0;
    z-index: -1;
    background: var(--text-sel);
    border-radius: 2px;
    pointer-events: none;
  }
  /* the formula being edited (drawn here rather than on the formula: its own box is
     only as tall as the line, not its fractions and limits) */
  .mathframe {
    position: absolute;
    left: 0;
    top: 0;
    z-index: -1;
    background: var(--math-edit-bg);
    box-shadow: 0 0 0 1px var(--math-edit-ring);
    border-radius: 4px;
    pointer-events: none;
  }
  /* no transition: makeRoom measures these right after they change */
  .nx-sp {
    display: inline;
    line-height: 0;
  }
  .eol {
    display: inline-block;
    width: 0;
  }
  /* find matches, behind the text (the current one stronger) */
  .findhit {
    position: absolute;
    left: 0;
    top: 0;
    z-index: -1;
    border-radius: 2px;
    background: color-mix(in srgb, var(--ink-purple, var(--accent)) 22%, transparent);
    pointer-events: none;
  }
  .findhit.cur {
    background: color-mix(in srgb, var(--ink-purple, var(--accent)) 45%, transparent);
    box-shadow: 0 0 0 1px var(--ink-purple, var(--accent));
  }
  .ch.b {
    font-weight: 700;
  }
  .ch.i {
    font-style: italic;
  }
  /* after a display formula it would get a line of its own: an empty line under every one */
  :global(.block .math.display + .eol) {
    position: absolute;
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
