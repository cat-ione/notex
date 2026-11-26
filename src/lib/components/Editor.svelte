<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, scale, fade } from 'svelte/transition';
  import { cubicOut, backOut } from 'svelte/easing';
  import { Editor } from '$lib/editor.svelte';
  import { marked } from '$lib/match';
  import MathView from './MathView.svelte';
  import ArrowLayer from './ArrowLayer.svelte';
  import MarkLayer from './MarkLayer.svelte';
  import LabelLayer from './LabelLayer.svelte';
  import DrawingMenu from './DrawingMenu.svelte';
  import DrawingBar from './DrawingBar.svelte';
  import FindBar from './FindBar.svelte';
  import Outline from './Outline.svelte';
  import Tooltip from './Tooltip.svelte';
  import StatusLine from './StatusLine.svelte';
  import Toolbar from './Toolbar.svelte';
  import Help from './Help.svelte';
  import Settings from './Settings.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import SketchShapes from './SketchShapes.svelte';
  import NoteInk from './NoteInk.svelte';
  import SketchBar from './SketchBar.svelte';
  import LabelEditor from './LabelEditor.svelte';
  import { isDesktop, setWindowTitle } from '$lib/files';
  import { base } from '$app/paths';
  import { BOX_NAME, isFigure, type Block, type Item } from '$lib/model';
  import { highlight, type Tk } from '$lib/highlight';
  import { cellSpans, findTables } from '$lib/tables';

  const ed = new Editor();
  let page: HTMLElement;

  /** A name in runs of matched and unmatched letters, for the palette to mark what was typed. */
  function matched(name: string, q: string): [string, boolean][] {
    const hit = new Set(marked(name, q));
    const out: [string, boolean][] = [];
    [...name].forEach((ch, i) => {
      const last = out.at(-1);
      if (last && last[1] === hit.has(i)) last[0] += ch;
      else out.push([ch, hit.has(i)]);
    });
    return out;
  }

  // The palette lists every command; the highlighted one is kept in view as the arrows move it.
  let paletteList = $state<HTMLDivElement>();
  // (as wide as it needs; near the page's right edge it moves left rather than being squeezed)
  let paletteBox = $state<HTMLDivElement>();
  let paletteShift = $state(0);
  $effect(() => {
    void ed.paletteAnchor?.x, void ed.paletteItems.length, void ed.palette?.query;
    if (!paletteBox || !page) return;
    const w = paletteBox.offsetWidth, x = ed.paletteAnchor?.x ?? 0;
    paletteShift = Math.max(0, Math.min(x, page.clientWidth - 8 - w)) - x;
  });
  $effect(() => {
    void ed.palette?.sel, void ed.palette?.query;
    paletteList?.querySelector('.opt.sel')?.scrollIntoView({ block: 'nearest' });
  });

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
      // drawing: the pointer's way across the page, and a pen hovering near it
      on('pointermove', (e) => {
        if (e.pointerType === 'pen' && !e.buttons) ed.sketch.penHover(e, true);
        ed.sketch.pointerMove(e);
      }),
      on('pointerup', (e) => ed.sketch.pointerUp(e)),
      on('pointercancel', (e) => ed.sketch.pointerCancel(e)),
      on('pointerout', (e) => e.pointerType === 'pen' && !e.relatedTarget && ed.sketch.penHover(e, false)),
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

  // The zoom: the page's sizes times it (see .page), laid out again once it's in.
  let zoomed = 1, relayout = false;
  $effect(() => {
    const z = ed.zoom;
    document.documentElement.style.setProperty('--zoom', String(z));
    if (z === zoomed) return;
    zoomed = z;
    // (once a frame, however many steps a pinch on a trackpad takes)
    if (relayout) return;
    relayout = true;
    requestAnimationFrame(() => ((relayout = false), ed.relayoutAll()));
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

  // Tables: their rows, by block index, and the cells a selection covers (whole cells, as
  // in a word processor)
  const tableRows = $derived(findTables(ed.doc.blocks));
  const cellSel = $derived(ed.cellSelection);
  const selectedCell = (b: number, c: number) =>
    !!cellSel && b >= cellSel.rows[0] && b <= cellSel.rows[1] && c >= cellSel.cols[0] && c <= cellSel.cols[1];

  // Code blocks' colours: each line's characters' kinds of token, by line. A block is read
  // whole (a string or comment can run over lines), in the language its opening fence names.
  const codeTokens = $derived.by(() => {
    const out = new Map<string, (Tk | undefined)[]>();
    if (!ed.config.highlightCode) return out;
    const blocks = ed.doc.blocks;
    for (let b = 0; b < blocks.length; b++) {
      const open = blocks[b];
      if (open.kind !== 'fence' || !open.lang) continue;
      let e = b + 1;
      while (blocks[e]?.kind === 'code') e++;
      const lines = blocks.slice(b + 1, e);
      // (a character per item; a code point may take two places in the string)
      const texts = lines.map((l) => l.items.map((i) => (i.t === 'c' ? i.ch : ' ')));
      const kinds = highlight(texts.map((t) => t.join('')).join('\n'), open.lang);
      let at = 0;
      lines.forEach((l, k) => {
        out.set(l.id, texts[k].map((ch) => ((at += ch.length), kinds[at - ch.length])));
        at++;
      });
      b = e - 1;
    }
    return out;
  });

  /**
   * A pointer down on the page, before anything else sees it: drawing may take it (a pen, a
   * finger while drawing, anything on a diagram), else it goes on to the text as usual.
   */
  function pointerDown(e: PointerEvent) {
    const t = e.target as Element;
    // while drawing, a press outside an open menu just closes it
    if (ed.menu && ed.sketch.active && e.button !== 2) {
      e.preventDefault();
      e.stopPropagation();
      ed.closeMenu();
      return;
    }
    const grip = t.closest?.('[data-dgrip]') as HTMLElement | null;
    if (grip && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      ed.sketch.resizeDown(e, grip.dataset.dgrip!);
      return;
    }
    if (t.closest?.('.dbar, .lbl-edit, .palette')) return;
    const svg = t.closest?.('svg.canvas');
    const canvas = svg ? ((svg.closest('[data-diagram]') as HTMLElement | null)?.dataset.diagram ?? null) : null;
    if (ed.sketch.pointerDown(e, canvas)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Dragging an image's corner: it grows on both sides (it's centred), one undo step. */
  function resizeImage(e: MouseEvent, b: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const img = (e.currentTarget as HTMLElement).parentElement!.querySelector('img')!;
    const x0 = e.clientX, w0 = img.getBoundingClientRect().width;
    ed.beginImageResize(b);
    // (its width kept as at no zoom)
    const move = (m: MouseEvent) => ed.setImageWidth(b, (w0 + (m.clientX - x0) * 2) / ed.zoom);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  const SIGIL = { math: 'ƒ', text: '❯', draw: '✎', style: '✎', ref: '↗' };

  /** A heading's level (0: not a heading). */
  const level = (blk: Block) => (blk.kind === 'h1' ? 1 : blk.kind === 'h2' ? 2 : blk.kind === 'h3' ? 3 : 0);
  /** A click on a box to tick: ticks it (the caret stays where it was). */
  function tick(e: MouseEvent, b: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ed.toggleCheck(b);
    ed.touch();
  }
  /** A click on a heading's fold mark: folds or unfolds its section. */
  function fold(e: MouseEvent, b: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ed.toggleFold(b);
    ed.touch();
  }

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

<!-- One item of a block: a character, or a formula (with what makes room for drawings). -->
{#snippet item(blk: Block, b: number, it: Item, o: number)}{#if it.t === 'c'}<span
      class="ch"
      class:b={it.b && !it.m}
      class:i={it.i && !it.m}
      class:c={it.c}
      class:s={it.s && !it.m}
      class:hl={it.h && !it.m}
      class:ln={it.l && !it.m}
      class:mk={it.m}
      class:cs={codeText(it) && !codeText(blk.items[o - 1])}
      class:ce={codeText(it) && !codeText(blk.items[o + 1])}
      data-tk={blk.kind === 'code' ? codeTokens.get(blk.id)?.[o] : undefined}
      title={it.l && !it.m ? 'ctrl+click to open' : undefined}
      data-nx={it.id}>{it.ch}</span>{#if ed.spacers[it.id]}{@render spacer(it.id)}{/if}{:else}<MathView item={it} cursor={editingMath(b, o) ? ed.mc : null} sel={editingMath(b, o) ? ed.mathSelRange : null} pad={it.display ? ed.spacers[it.id] : undefined} eqn={it.display && it.num ? ed.labels.get(it.id) : undefined} />{#if !it.display && ed.spacers[it.id]}{@render spacer(it.id)}{/if}{/if}{/snippet}

<!-- A cell wall: no width, nothing to see (the cell's border is the wall), but a place for the caret. -->
{#snippet cellWall(w: Item)}<span class="ch wall" data-nx={w.id}>|</span>{/snippet}

<!-- What comes before a block's text: an image, a box to tick, a box's name, a heading's fold. -->
{#snippet blockHead(blk: Block, b: number)}{#if blk.kind === 'li' && blk.check !== undefined}<span class="tick" class:on={blk.check} data-tick={b} role="checkbox" aria-checked={blk.check} tabindex="-1" onmousedown={(e) => tick(e, b)}></span>{/if}{#if level(blk) && (blk.fold || ed.sectionEnd(b) > b + 1)}<span class="foldbtn" class:folded={blk.fold} data-fold={b} role="button" tabindex="-1" data-tip={blk.fold ? 'unfold' : 'fold'} data-tip-key="ctrl+." onmousedown={(e) => fold(e, b)}></span>{/if}{#if blk.box && blk.box.k !== 'quote' && ed.boxStarts(b)}<span class="boxhead">{ed.labels.get(blk.box.id) ?? BOX_NAME[blk.box.k]}.</span>{/if}{#if blk.kind === 'img'}<div class="figure">
      <!-- (an image's id is on the picture: drawings on it are on the picture, not its caption) -->
      <img src={blk.src} alt="" draggable="false" data-nx={blk.id} style:width={blk.w ? `calc(${blk.w}px * var(--zoom, 1))` : undefined} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="grip" onmousedown={(e) => resizeImage(e, b)} data-tip="drag to resize" data-tip-key="alt+← →"></span>
    </div>{:else if blk.kind === 'diagram'}{@const on = ed.sketch.isOn(blk.id)}<div class="figure diagram" class:on data-diagram={blk.id}>
      <!-- (its own coordinates, scaled down to fit a narrower page; a drawing on it is on the diagram) -->
      <svg class="canvas" class:tool-select={on && ed.sketch.tool === 'select'} viewBox="0 0 {blk.w ?? 720} {blk.h ?? 280}" style:width="min(100%, calc({blk.w ?? 720}px * var(--zoom, 1)))" data-nx={blk.id} role="img" aria-label="diagram">
        {#if on}
          <SketchShapes shapes={blk.shapes ?? []} sel={ed.sketch.sel} draft={ed.sketch.draft} marquee={ed.sketch.marquee} lasso={ed.sketch.lasso} handles={ed.sketch.handles()} selBox={ed.sketch.selBox} editing={ed.sketch.editing} />
        {:else}
          <SketchShapes shapes={blk.shapes ?? []} />
        {/if}
      </svg>
      {#if !blk.shapes?.length && !on}<span class="dhint">{ed.input === 'mouse' ? 'an empty diagram: click it to draw' : 'an empty diagram: ctrl+shift+d to draw'}</span>{/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="dgrip" data-dgrip={blk.id} data-tip="drag to make it taller or shorter"></span>
    </div>{/if}{/snippet}

<div class="shell">
  <DrawingMenu {ed} />
  <FindBar {ed} />
  {#if ed.showOutline}
    <Outline {ed} />
  {/if}
  {#if ed.sketch.active}
    <SketchBar {ed} />
  {/if}
  <Tooltip {ed} />
  {#if ed.config.ui.toolbar}
    <Toolbar {ed} />
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroller"
    class:outlined={ed.showOutline}
    class:pen-ready={!ed.sketch.active && ed.config.sketch.penDraws && (ed.sketch.penNear || ed.sketch.penSeen)}
    onpointerdowncapture={pointerDown}
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
        {@const row = tableRows.get(b)}
        <div
          class="block {blk.kind}"
          class:tr={!!row}
          class:thead={row?.role === 'head'}
          class:tlast={row?.last}
          class:current={ed.b === b}
          class:cfirst={codeTop(b)}
          class:clast={codeBottom(b)}
          class:veiled={veiled(b)}
          class:empty={!blk.items.length}
          class:task={blk.kind === 'li' && blk.check !== undefined}
          class:done={blk.kind === 'li' && blk.check === true}
          class:boxed={!!blk.box}
          class:bfirst={ed.boxStarts(b)}
          class:blast={ed.boxEnds(b)}
          class:folded={ed.folded[b]}
          data-box={blk.box?.k}
          class:hang={reveal?.b === b && !!reveal.hang}
          data-nx={isFigure(blk.kind) ? undefined : blk.id}
          data-bid={blk.id}
          data-depth={blk.indent || undefined}
          data-n={listNums[b]}
          data-lang={blk.kind === 'fence' ? blk.lang : undefined}
          style:--indent={blk.indent || undefined}
          style:--hang={reveal?.b === b && reveal.hang ? reveal.hang : undefined}
        >
          <!-- (no whitespace between these: in the pre-wrap text it would show) -->
          {#if row}{@const cells = cellSpans(blk.items)}{#each cells as [s, e], c (c)}<span class="td" class:csel={selectedCell(b, c)} data-c={c} style:text-align={row.aligns[c] ?? undefined}>{@render cellWall(blk.items[s - 1])}{#each blk.items.slice(s, e) as it, k (it.id)}{@render item(blk, b, it, s + k)}{/each}{#if c === cells.length - 1}{@render cellWall(blk.items[e])}<span class="eol" data-eol={blk.id}>&#8203;</span>{/if}</span>{/each}{:else}{@render blockHead(blk, b)}{#each blk.items as it, o (it.id)}{@render item(blk, b, it, o)}{/each}<span class="eol" data-eol={blk.id}>&#8203;</span>{#if blk.box?.k === 'proof' && ed.boxEnds(b)}<span class="qed">∎</span>{/if}{#if blk.fold && ed.foldedCount(b)}<span class="foldinfo">⋯ {ed.foldedCount(b)} {ed.foldedCount(b) === 1 ? 'line' : 'lines'}</span>{/if}{/if}
        </div>
      {/each}

      <MarkLayer {ed} />
      <ArrowLayer {ed} />
      <LabelLayer {ed} />
      <DrawingBar {ed} />
      <NoteInk {ed} />
      {#if ed.sketch.editing}
        <!-- (one per shape: going on to the next box is a new editor) -->
        {#key ed.sketch.editing}
          <LabelEditor {ed} />
        {/key}
      {/if}

      {#if ed.caret && ed.mode !== 'sketch'}
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
        <!-- (below the caret, or above when there's more room there; its list shrinks to fit between the bars) -->
        {@const y = (ed.page?.getBoundingClientRect().top ?? 0) + at.y}
        {@const below = window.innerHeight - (ed.config.ui.statusBar ? 30 : 8) - (y + at.h + 6)}
        {@const above = y - 6 - (ed.config.ui.toolbar ? 38 : 8)}
        {@const up = below < 300 && above > below}
        {@const room = Math.max(44, Math.min(264, (up ? above : below) - 40))}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
          class="palette"
          bind:this={paletteBox}
          style="left: {at.x + paletteShift}px; top: {up ? at.y - 6 : at.y + at.h + 6}px; {up ? 'transform: translateY(-100%);' : ''}"
          transition:fly={{ y: up ? 6 : -6, duration: 140, easing: cubicOut }}
          onmousedown={(e) => (e.stopPropagation(), e.preventDefault())}
        >
          <!-- (typing filters it; opened by a click, it says what it is until something is typed) -->
          <div class="prompt"><span class="sigil">{SIGIL[ed.palette.ctx]}</span> {#if ed.input === 'mouse' && !ed.palette.query}<span class="what">{ed.palette.ctx === 'draw' ? 'draw' : ed.palette.ctx === 'ref' ? 'refer to' : 'commands'}</span>{:else}{ed.palette.ctx === 'draw' ? '' : ed.palette.ctx === 'ref' ? 'refer to ' : '\\'}{ed.palette.query}<span class="blink">▏</span>{/if}</div>
          <div class="opts" bind:this={paletteList} style:max-height="{room}px">
          {#each ed.paletteItems as item, i (item.name)}
            {#if item.rule}<div class="rule"></div>{/if}
            <div class="opt" class:sel={i === ed.palette.sel} onmouseenter={() => ed.palette && (ed.palette.sel = i)} onclick={() => ed.pickPalette(i)}>
              <span class="name">{#if item.draw && ed.palette.ctx !== 'draw'}<span class="pen">✎</span>{/if}{#each matched(item.name, ed.palette.query) as [part, hit], k (k)}<span class:hit>{part}</span>{/each}</span><span class="desc" title={item.desc}>{item.desc}</span>
            </div>
          {:else}
            <div class="opt empty">{ed.palette.ctx === 'math' ? `insert \\${ed.palette.query}` : 'no match'}</div>
          {/each}
          </div>
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
  /* the outline open on a wide window: the page beside it, not under it */
  @media (min-width: 980px) {
    .scroller.outlined {
      padding-left: 256px;
    }
  }
  .page {
    position: relative;
    max-width: calc(var(--page-width, 820px) * var(--zoom, 1));
    margin: 0 auto;
    padding: 48px 32px 40vh;
    font-family: var(--prose);
    font-size: calc(var(--font-size, 16px) * var(--zoom, 1));
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
    padding-left: calc(var(--bx, 0px) + 1.4em + var(--indent, 0) * 1.4em);
  }
  /* markers: the text's own size and line height (so they sit on its line), drawn smaller */
  .block.li::after {
    content: '▸';
    position: absolute;
    left: calc(var(--bx, 0px) + 0.2em + var(--indent, 0) * 1.4em);
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
    left: calc(var(--bx, 0px) + var(--indent, 0) * 1.4em - 0.6em);
    width: 1.8em;
    top: 0;
    text-align: right;
    font-family: var(--mono);
    color: var(--accent);
    transform: scale(0.82);
    transform-origin: right center;
  }
  /* a list item with a box to tick: the box where the bullet would be; ticked, the text done */
  .block.li.task::after {
    content: none;
  }
  .tick {
    position: absolute;
    left: calc(var(--bx, 0px) + 0.15em + var(--indent, 0) * 1.4em);
    top: calc(1.05em - 0.5em);
    width: 0.92em;
    height: 0.92em;
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    border-radius: 3px;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  .tick:hover {
    background: var(--sel-bg);
  }
  .tick.on {
    background: var(--accent);
  }
  .tick.on::after {
    content: '';
    position: absolute;
    left: 0.27em;
    top: 0.08em;
    width: 0.22em;
    height: 0.46em;
    border: solid var(--bg);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .block.done .ch:not(.mk) {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent);
  }
  /* a box: a theorem, a definition, a proof, a quote… its blocks on one tinted band with a
     line down its left, its name before its first line (and a proof's ∎ after its last) */
  .block.boxed {
    --bx: 14px;
    --box-c: var(--accent);
    padding-left: var(--bx);
    padding-right: 10px;
    background: color-mix(in srgb, var(--box-c) 6%, transparent);
    box-shadow: inset 2px 0 0 var(--box-c);
  }
  .block.boxed[data-box='definition'] {
    --box-c: var(--ink-green);
  }
  .block.boxed[data-box='example'] {
    --box-c: var(--ink-blue);
  }
  .block.boxed[data-box='remark'],
  .block.boxed[data-box='proof'],
  .block.boxed[data-box='quote'] {
    --box-c: var(--muted);
    background: none;
  }
  .block.boxed[data-box='quote'] {
    color: color-mix(in srgb, var(--fg) 78%, var(--muted));
    font-style: italic;
  }
  .block.boxed.bfirst {
    margin-top: 0.45em;
    border-top-right-radius: 4px;
  }
  .block.boxed.blast {
    margin-bottom: 0.45em;
    border-bottom-right-radius: 4px;
  }
  .boxhead {
    margin-right: 0.55em;
    font-family: var(--mono);
    font-size: 0.86em;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--box-c);
    user-select: none;
  }
  .block.boxed[data-box='proof'] .boxhead,
  .block.boxed[data-box='remark'] .boxhead {
    font-weight: 600;
    font-style: italic;
  }
  .qed {
    float: right;
    color: var(--muted);
    user-select: none;
  }
  /* a heading's fold mark, in the margin: shown on hover, always when folded */
  .foldbtn {
    position: absolute;
    left: -38px;
    top: 0;
    width: 16px;
    height: 100%;
    max-height: 2.1em;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6em;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 140ms ease;
    user-select: none;
  }
  .foldbtn::after {
    content: '▾';
  }
  .foldbtn.folded::after {
    content: '▸';
  }
  .block:hover > .foldbtn,
  .block.current > .foldbtn,
  .foldbtn.folded {
    opacity: 1;
  }
  .foldbtn:hover {
    color: var(--accent);
  }
  .foldinfo {
    margin-left: 0.7em;
    padding: 0 0.45em;
    font-family: var(--mono);
    font-size: 0.55em;
    font-weight: 400;
    vertical-align: middle;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 3px;
    user-select: none;
  }
  /* what a folded heading hides */
  .block.folded {
    display: none;
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
  .ch.s {
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--fg) 70%, transparent);
  }
  /* ==highlighted==: a marker pen's colour behind the text (see-through, so a selection shows) */
  .ch.hl {
    background: color-mix(in srgb, var(--arrow) 30%, transparent);
    padding: 0.12em 0;
  }
  /* a link's text: the accent, underlined (ctrl+click follows it) */
  .ch.ln {
    color: var(--link, var(--accent));
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--link, var(--accent)) 45%, transparent);
    text-underline-offset: 0.18em;
    cursor: pointer;
  }
  .ch.ln.s {
    text-decoration: underline line-through;
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
  .block.img,
  .block.diagram {
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
  /* a diagram: its canvas the page's width (or less), a faint frame where the caret is and
     dots to draw on while drawing in it */
  .figure.diagram {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .canvas {
    display: block;
    height: auto;
    overflow: hidden;
    border-radius: 6px;
    outline: 1px solid transparent;
    outline-offset: 2px;
    transition: outline-color 120ms ease, background-color 120ms ease;
  }
  .figure.diagram:hover .canvas,
  .block.diagram.current .canvas {
    outline-color: var(--border);
  }
  .figure.diagram.on .canvas {
    outline: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
    background-image: radial-gradient(circle, color-mix(in srgb, var(--muted) 40%, transparent) 0.8px, transparent 1.2px);
    background-size: 16px 16px;
    cursor: crosshair;
    touch-action: none;
  }
  .figure.diagram.on .canvas.tool-select {
    cursor: default;
  }
  .dhint {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
    pointer-events: none;
  }
  .dgrip {
    position: absolute;
    left: 50%;
    bottom: -6px;
    width: 36px;
    height: 7px;
    transform: translateX(-50%);
    border-radius: 4px;
    background: var(--accent);
    border: 2px solid var(--bg);
    cursor: ns-resize;
    touch-action: none;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .figure.diagram:hover .dgrip,
  .figure.diagram.on .dgrip {
    opacity: 1;
  }
  /* a pen near the screen: the page doesn't pan under it (a finger scrolls it, see Sketcher) */
  .scroller.pen-ready {
    touch-action: none;
  }
  /* the caption, when there's none yet and the caret is on it */
  .block.diagram.empty.current .eol::after,
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
    /* (one width, whatever's listed: it doesn't jump about as you type) */
    width: min(380px, calc(100vw - 24px));
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
  .opts {
    max-height: 264px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* a thin thumb, no track; brighter under the mouse */
  .opts::-webkit-scrollbar {
    width: 7px;
  }
  .opts::-webkit-scrollbar-track {
    background: transparent;
  }
  .opts::-webkit-scrollbar-thumb {
    background: var(--border);
    background-clip: padding-box;
    border: 2px solid transparent;
    border-radius: 4px;
  }
  .opts:hover::-webkit-scrollbar-thumb {
    background-color: var(--muted);
  }
  @supports (-moz-appearance: none) {
    .opts {
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
    }
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
    flex: none;
    white-space: nowrap;
    color: var(--fg);
  }
  /* what it does: on the one line, cut short (all of it on hover) */
  .opt .desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt.sel {
    background: var(--sel-bg);
  }
  .opt.sel .name {
    color: var(--accent);
  }
  /* the letters typed */
  .opt .name .hit {
    color: var(--accent);
    font-weight: 700;
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
  /* (between what fits where the caret is and the rest) */
  .palette .rule {
    height: 1px;
    margin: 3px 0;
    background: var(--border);
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
  :global(html.nx-print) .foldbtn,
  :global(html.nx-print) .foldinfo,
  :global(html.nx-print) .ch.mk:global(.show),
  :global(html.nx-print .handle),
  :global(html.nx-print .dbar),
  :global(html.nx-print .nx-caret) {
    display: none;
  }
  :global(html.nx-print .nx-active-row) {
    background: none;
  }
  /* (folded sections print: folding is how the note is looked at, not what's in it) */
  :global(html.nx-print) .block.folded {
    display: block;
  }
  :global(html.nx-print) .block.hang {
    text-indent: 0;
  }
  /* a table: its rows line up as a grid (consecutive table rows make one table); the walls
     between cells are borders, not characters to see or reach */
  .block.tr {
    display: table-row;
    content-visibility: visible;
  }
  .block.tr > .td {
    display: table-cell;
    padding: 0 0.7em;
    min-width: 3em;
    /* (each line once: a cell draws its right and bottom, the first column its left) */
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  .block.tr > .td:first-child {
    border-left: 1px solid var(--border);
  }
  .block.tr.thead > .td {
    border-top: 1px solid var(--border);
    font-weight: 600;
    color: var(--heading);
    background: color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .block.tr > .td.csel {
    background: var(--text-sel);
  }
  .ch.wall {
    display: inline-block;
    width: 0;
    overflow: hidden;
    color: transparent;
    vertical-align: top;
  }
  /* code blocks' colours, by kind of token (a theme can set --code-kw and the rest) */
  .ch[data-tk='kw'] { color: var(--code-kw, var(--ink-purple)); }
  .ch[data-tk='str'] { color: var(--code-str, var(--ink-green)); }
  .ch[data-tk='com'] { color: var(--code-com, var(--muted)); font-style: italic; }
  .ch[data-tk='num'] { color: var(--code-num, var(--arrow)); }
  .ch[data-tk='fn'] { color: var(--code-fn, var(--ink-blue)); }
  .ch[data-tk='type'] { color: var(--code-type, var(--accent)); }
  .ch[data-tk='op'] { color: var(--code-op, var(--fg)); }
  .ch[data-tk='pun'] { color: var(--code-pun, var(--muted)); }
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
