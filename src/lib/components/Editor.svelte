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
  import Toolbar from './Toolbar.svelte';
  import Help from './Help.svelte';
  import Settings from './Settings.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import { isDesktop, setWindowTitle } from '$lib/files';
  import { base } from '$app/paths';
  import type { Block, Item } from '$lib/model';

  const ed = new Editor();
  let page: HTMLElement;

  // The caret stays solid while it moves (typing, arrows, clicks) and blinks once it rests.
  let caretResting = $state(true);
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  // (a relayout that leaves it where it was is not a move)
  const caretAt = $derived(ed.caret ? `${ed.caret.r.x} ${ed.caret.r.y} ${ed.caret.r.h} ${ed.caret.shape}` : '');
  $effect(() => {
    void caretAt;
    caretResting = false;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => (caretResting = true), 600);
    return () => clearTimeout(restTimer);
  });

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
      // keys or the mouse, whichever was used last (bare modifiers, as for alt+drag, aren't typing)
      on('keydown', (e) => {
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) ed.input = 'keys';
        ed.key(e);
      }),
      on('pointerdown', () => (ed.input = 'mouse')),
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
      // printing from the browser's menu: laid out for paper as with ctrl+p
      on('beforeprint', () => ed.beginPrint()),
      on('afterprint', () => ed.endPrint()),
    ];
    ed.loadConfig();
    ed.initLibrary();
    // offline (see src/service-worker.ts): the built site in a browser, not the desktop app
    if (!import.meta.env.DEV && !isDesktop() && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${base}/service-worker.js`).catch(() => {});
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
  // the markdown shown at the caret: markers of the spans it's at, a heading's #s, code fences
  const reveal = $derived(ed.reveal);
  // inline code's text (not its backticks): its first / last character has the rounded end
  const codeText = (it: Item | undefined) => it?.t === 'c' && !!it.c && !it.m;

  // The markers that show (Editor.reveal) get a class of their own, set here on just
  // them: no other character depends on where the caret is.
  let showing: Element[] = [];
  $effect(() => {
    const rv = reveal;
    const items = rv ? ed.doc.blocks[rv.b]?.items : undefined;
    for (const e of showing) e.classList.remove('show');
    showing = [];
    if (!rv || !items || !page) return;
    for (const o of rv.shown) {
      const id: string | undefined = items[o]?.id;
      const e: Element | null = id ? page.querySelector(`.ch[data-nx="${id}"]`) : null;
      if (e) e.classList.add('show'), showing.push(e);
    }
  });
  // a code block's box, from its opening fence (or first line) to its closing fence (or last line)
  const boxed = (b: number) => ['code', 'fence'].includes(ed.doc.blocks[b]?.kind);
  const codeTop = (b: number) => {
    const blk = ed.doc.blocks[b];
    return blk.kind === 'fence' ? blk.lang !== undefined : blk.kind === 'code' && !boxed(b - 1);
  };
  const codeBottom = (b: number) => {
    const blk = ed.doc.blocks[b];
    return blk.kind === 'fence' ? blk.lang === undefined : blk.kind === 'code' && !boxed(b + 1);
  };
  /** A fence of a code block the caret isn't in: its line shows nothing (but the language). */
  const veiled = (b: number) => ed.doc.blocks[b].kind === 'fence' && !(reveal?.code && b >= reveal.code.first && b <= reveal.code.last);

  /** Dragging an image's corner: it grows on both sides (it's centred), one undo step. */
  function resizeImage(e: MouseEvent, b: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const img = (e.currentTarget as HTMLElement).parentElement!.querySelector('img')!;
    const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
    ed.beginImageResize(b);
    const move = (m: MouseEvent) => ed.setImageWidth(b, w0 + (m.clientX - x0) * 2);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
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

<!-- What comes before a block's text: an image. -->
{#snippet blockHead(blk: Block, b: number)}{#if blk.kind === 'img'}<div class="figure">
      <!-- (an image's id is on the picture: drawings on it are on the picture, not its caption) -->
      <img src={blk.src} alt="" draggable="false" data-nx={blk.id} style:width={blk.w ? `${blk.w}px` : undefined} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="grip" onmousedown={(e) => resizeImage(e, b)} data-tip="drag to resize" data-tip-key="alt+← →"></span>
    </div>{/if}{/snippet}

<div class="shell">
  <DrawingMenu {ed} />
  <FindBar {ed} />
  <Tooltip {ed} />
  {#if ed.config.ui.toolbar}
    <Toolbar {ed} />
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroller"
    onmousedown={(e) => ed.mouseDown(e)}
    oncontextmenu={(e) => ed.openPageMenu(e)}
    onscroll={() => ed.scrolled()}
    ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
    ondrop={(e) => ed.dropFiles(e)}
  >
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
        <div
          class="block {blk.kind}"
          class:current={ed.b === b}
          class:cfirst={codeTop(b)}
          class:clast={codeBottom(b)}
          class:veiled={veiled(b)}
          class:empty={!blk.items.length}
          class:hang={reveal?.b === b && !!reveal.hang}
          data-nx={blk.kind === 'img' ? undefined : blk.id}
          data-depth={blk.indent || undefined}
          data-n={listNums[b]}
          data-lang={blk.kind === 'fence' ? blk.lang : undefined}
          style:--indent={blk.indent || undefined}
          style:--hang={reveal?.b === b && reveal.hang ? reveal.hang : undefined}
        >
          <!-- (no whitespace between these: in the pre-wrap text it would show) -->
          {@render blockHead(blk, b)}{#each blk.items as it, o (it.id)}{#if it.t === 'c'}
              <span
                class="ch"
                class:b={it.b && !it.m}
                class:i={it.i && !it.m}
                class:c={it.c}
                class:mk={it.m}
                class:cs={codeText(it) && !codeText(blk.items[o - 1])}
                class:ce={codeText(it) && !codeText(blk.items[o + 1])}
                data-nx={it.id}>{it.ch}</span>{#if ed.spacers[it.id]}{@render spacer(it.id)}{/if}
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
          class:resting={caretResting}
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
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
          class="palette"
          style="left: {at.x}px; top: {up ? at.y - 6 : at.y + at.h + 6}px; {up ? 'transform: translateY(-100%);' : ''}"
          transition:fly={{ y: up ? 6 : -6, duration: 140, easing: cubicOut }}
          onmousedown={(e) => (e.stopPropagation(), e.preventDefault())}
        >
          <!-- (typing filters it; opened by a click, it says what it is until something is typed) -->
          <div class="prompt"><span class="sigil">{SIGIL[ed.palette.ctx]}</span> {#if ed.input === 'mouse' && !ed.palette.query}<span class="what">{ed.palette.ctx === 'draw' ? 'draw' : 'commands'}</span>{:else}{ed.palette.ctx === 'draw' ? '' : '\\'}{ed.palette.query}<span class="blink">▏</span>{/if}</div>
          {#each ed.paletteItems as item, i (item.name)}
            <div class="opt" class:sel={i === ed.palette.sel} onmouseenter={() => ed.palette && (ed.palette.sel = i)} onclick={() => ed.pickPalette(i)}>
              <span class="name">{#if item.draw && ed.palette.ctx !== 'draw'}<span class="pen">✎</span>{/if}{item.name}</span><span class="desc">{item.desc}</span>
            </div>
          {:else}
            <div class="opt empty">{ed.palette.ctx === 'math' ? `insert \\${ed.palette.query}` : 'no match'}</div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if ed.config.ui.statusBar}
    <StatusLine {ed} />
  {:else if ed.message}
    <!-- (no status bar: what it would say, for a moment) -->
    <div class="toast" transition:fade={{ duration: 150 }}>{ed.message}</div>
  {/if}

  {#if ed.showNotes}
    <NotesPanel {ed} />
  {/if}

  {#if ed.showSettings}
    <Settings {ed} />
  {/if}

  {#if ed.printing}
    <div class="veil"><span>saving PDF…</span></div>
  {/if}

  {#if ed.showHelp}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="help-wrap" transition:fade={{ duration: 120 }} onmousedown={(e) => e.target === e.currentTarget && (ed.showHelp = false)}>
      <Help {ed} />
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
  /* markers: the text's own size and line height (so they sit on its line), drawn smaller */
  .block.li::after {
    content: '▸';
    position: absolute;
    left: calc(0.2em + var(--indent, 0) * 1.4em);
    top: 0;
    color: var(--accent);
    transform: scale(0.85);
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
    color: var(--accent);
    transform: scale(0.82);
    transform-origin: right center;
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
  /* inline code: a tinted run in the mono font (see-through, so selections show under it) */
  .ch.c {
    font-family: var(--mono);
    font-size: 0.88em;
    /* code shows what was typed: -> stays two characters */
    font-variant-ligatures: none;
    color: var(--code-fg, var(--fg));
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    padding: 0.12em 0;
  }
  .ch.c.cs {
    padding-left: 0.3em;
    border-radius: 3px 0 0 3px;
  }
  .ch.c.ce {
    padding-right: 0.3em;
    border-radius: 0 3px 3px 0;
  }
  .ch.c.cs.ce {
    border-radius: 3px;
  }
  /* an image, centred, its caption under it */
  .block.img {
    text-align: center;
    padding: 0.5em 0 0.3em;
    font-size: 0.9em;
    color: var(--muted);
    contain-intrinsic-size: auto 200px;
  }
  .figure {
    white-space: normal;
    position: relative;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto 0.2em;
    line-height: 0;
  }
  .figure img {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    outline: 2px solid transparent;
    outline-offset: 3px;
    transition: outline-color 120ms ease;
  }
  .block.img.current .figure img {
    outline-color: color-mix(in srgb, var(--accent) 70%, transparent);
  }
  .grip {
    position: absolute;
    right: -7px;
    bottom: -7px;
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: var(--accent);
    border: 2px solid var(--bg);
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .figure:hover .grip,
  .block.img.current .grip {
    opacity: 1;
  }
  /* the caption, when there's none yet and the caret is on it */
  .block.img.empty.current .eol::after {
    content: 'caption';
    position: absolute;
    transform: translateX(-50%);
    opacity: 0.5;
    pointer-events: none;
  }
  /* markdown's markers (** ` # …): quiet, and only where the caret is (see Editor.reveal) */
  .ch.mk {
    color: var(--muted);
    opacity: 0.8;
  }
  .ch.mk:not(:global(.show)) {
    display: none;
  }
  /* (a code span's backticks sit outside its box) */
  .ch.c.mk {
    background: none;
    padding: 0;
  }
  /* a heading's #s hang in the margin, the heading where it always is */
  .block.hang {
    text-indent: calc(var(--hang) * -1ch);
  }
  .block.hang::before {
    opacity: 0;
  }
  /* a code block: its lines in the mono font on one tinted box, fences included */
  .block.code,
  .block.fence {
    font-family: var(--mono);
    font-size: 0.88em;
    font-variant-ligatures: none;
    /* whole pixels: a fraction leaves a seam between the lines' backgrounds */
    line-height: round(1.6em, 1px);
    min-height: round(1.6em, 1px);
    contain-intrinsic-size: auto 1.6em;
    padding: 0 1em;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    tab-size: 2;
  }
  .block.fence .ch {
    color: var(--muted);
  }
  /* a fence of a block the caret isn't in: an empty line of the box (nothing moves when it shows) */
  .block.fence.veiled .ch {
    visibility: hidden;
  }
  .block.fence.veiled[data-lang]::after {
    content: attr(data-lang);
    position: absolute;
    right: 0.8em;
    top: 0.15em;
    font-size: 0.8em;
    color: var(--muted);
  }
  .block.cfirst {
    padding-top: 0.3em;
    margin-top: 0.3em;
    border-radius: 5px 5px 0 0;
  }
  .block.clast {
    padding-bottom: 0.3em;
    margin-bottom: 0.3em;
    border-radius: 0 0 5px 5px;
  }
  .block.cfirst.clast {
    border-radius: 5px;
  }
  .block.code::before,
  .block.fence::before {
    left: -18px;
    top: 0.3em;
    bottom: 0.3em;
  }
  /* after a display formula it would get a line of its own: an empty line under every one */
  :global(.block .math.display + .eol) {
    position: absolute;
  }

  .caret {
    position: absolute;
    z-index: 3; /* over notes too: one may be being typed */
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
  }
  .caret.math {
    background: var(--accent);
  }
  .caret.resting {
    animation: blink 1.1s steps(1) infinite;
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
    cursor: pointer;
    transition: background-color 80ms ease;
  }
  .prompt .what {
    color: var(--muted);
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
  /* laid out for paper (Editor.beginPrint): the page alone, nothing of the editing */
  :global(html.nx-print) .page {
    padding: 0;
    display: flow-root;
  }
  :global(html.nx-print) .block {
    content-visibility: visible;
  }
  /* everything where it ends up at once (notes glide to new places on screen), and no glow:
     a shadow on every letter turns a PDF into pictures */
  :global(html.nx-print *),
  :global(html.nx-print *::before),
  :global(html.nx-print *::after) {
    transition: none !important;
    animation: none !important;
    text-shadow: none !important;
  }
  /* margins at a page break are dropped in print, which would move the text from where it
     was measured: padding and borders instead, which stay */
  :global(html.nx-print) .block.h1 {
    margin-top: 0;
    padding-top: 0.4em;
  }
  :global(html.nx-print) .block.h2 {
    margin-top: 0;
    padding-top: 0.6em;
  }
  :global(html.nx-print) .block.cfirst {
    margin-top: 0;
    border-top: 0.3em solid transparent;
    background-clip: padding-box;
  }
  :global(html.nx-print) .block.clast {
    margin-bottom: 0;
    border-bottom: 0.3em solid transparent;
    background-clip: padding-box;
  }
  :global(html.nx-print) .block::before,
  :global(html.nx-print) :is(.caret, .selrect, .findhit, .mathframe, .pick, .hint, .palette, .grip),
  :global(html.nx-print) .ch.mk:global(.show),
  :global(html.nx-print .handle),
  :global(html.nx-print .dbar),
  :global(html.nx-print .nx-caret) {
    display: none;
  }
  :global(html.nx-print .nx-active-row) {
    background: none;
  }
  :global(html.nx-print) .block.hang {
    text-indent: 0;
  }
  .toast {
    position: fixed;
    right: 14px;
    bottom: 12px;
    z-index: 20;
    max-width: min(60ch, 80vw);
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel);
    color: var(--fg);
    font-family: var(--mono);
    font-size: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
  .veil {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--muted);
    font-family: var(--mono);
  }
  @media print {
    :global(html),
    :global(body) {
      height: auto;
      overflow: visible;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .shell {
      display: block;
      height: auto;
    }
    .shell > :global(:not(.scroller)) {
      display: none !important;
    }
    .scroller {
      overflow: visible;
    }
    .block {
      orphans: 1;
      widows: 1;
    }
  }
</style>
