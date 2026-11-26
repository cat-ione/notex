<script lang="ts">
  // The toolbar: the things otherwise behind keys, each showing its keys when hovered. It
  // fades while you type and comes back when the mouse moves; it can be hidden (▴, the
  // settings, or \toolbar).
  import { onMount } from 'svelte';
  import type { Editor } from '$lib/editor.svelte';
  import { isDesktop } from '$lib/files';
  import { shownName } from '$lib/library';

  let { ed }: { ed: Editor } = $props();

  /** Faded while typing (until the mouse moves). */
  let quiet = $state(false);

  type Button = { id: string; glyph: string; label?: string; tip: string; keys?: string; run: (at: DOMRect) => unknown };
  const left: Button[] = [
    { id: 'new', glyph: '+', label: 'new', tip: 'new note', keys: 'ctrl+n', run: () => ed.newNote() },
    { id: 'save', glyph: '↓', label: 'save', tip: isDesktop() ? 'save' : 'save to a file', keys: 'ctrl+s', run: () => ed.saveNote() },
  ];
  const insert: Button[] = [
    { id: 'math', glyph: '$', label: 'math', tip: 'a formula ($$ for a centred one)', keys: '$', run: () => ed.mode === 'text' && ed.insertMath(false) },
    { id: 'draw', glyph: '✎', label: 'draw', tip: 'draw: arrows, boxes, circles… (alt+drag draws an arrow)', keys: 'ctrl+d', run: (at) => ed.openDrawMenu(at) },
    // (in a table: that table's rows, columns and alignment)
    { id: 'table', glyph: '▦', label: 'table', tip: 'a table (tab: next cell, enter: new row)', run: (at) => ed.openTableMenu(at) || ed.insertTable() },
    { id: 'image', glyph: '▣', label: 'image', tip: 'an image (or paste / drop one)', run: () => ed.chooseImages() },
  ];
  const right: Button[] = [
    { id: 'find', glyph: '/', label: 'find', tip: 'find', keys: 'ctrl+f', run: () => ed.openFind() },
    { id: 'pdf', glyph: '⎙', label: 'pdf', tip: 'save as PDF', keys: 'ctrl+p prints', run: () => ed.exportPdf() },
    { id: 'settings', glyph: '⚙', tip: 'settings', keys: 'ctrl+,', run: () => (ed.showSettings = true) },
    { id: 'help', glyph: '?', tip: 'keyboard shortcuts', keys: 'F1', run: () => (ed.showHelp = !ed.showHelp) },
    { id: 'hide', glyph: '▴', tip: 'hide the toolbar (settings or \\toolbar bring it back)', run: () => ed.toggleBar('toolbar') },
  ];

  // A button acts without taking the caret away from the page. It closes whatever menu or
  // panel is open first; its own (open) one it just closes.
  const press = (e: MouseEvent, b: Button) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    const open = ed.openByToolbar;
    ed.closeMenus();
    if (open === b.id) return;
    b.run((e.currentTarget as HTMLElement).getBoundingClientRect());
  };

  onMount(() => {
    const typed = (e: KeyboardEvent) => {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) quiet = true;
    };
    const moved = () => (quiet = false);
    window.addEventListener('keydown', typed, true);
    window.addEventListener('mousemove', moved, true);
    return () => {
      window.removeEventListener('keydown', typed, true);
      window.removeEventListener('mousemove', moved, true);
    };
  });
</script>

{#snippet button(b: Button)}
  {@const here = b.id === 'table' && ed.inTable}
  <button class="b b-{b.id}" class:glyph={!b.label} class:here onmousedown={(e) => press(e, b)} onclick={(e) => e.preventDefault()} data-tip={here ? 'this table: rows, columns, alignment' : b.tip} data-tip-key={here ? 'right-click a cell' : b.keys} aria-label={here ? 'this table' : b.tip}>
    <span class="g">{b.glyph}</span>{#if b.label}<span class="l">{b.label}</span>{/if}{#if here}<span class="caret">▾</span>{/if}
  </button>
{/snippet}

<header class="toolbar" class:quiet={quiet && ed.config.ui.fadeToolbar}>
  <button class="b note b-notes" onmousedown={(e) => press(e, { id: 'notes', glyph: '≡', tip: '', run: () => ed.openNote() })} onclick={(e) => e.preventDefault()} data-tip={`${isDesktop() ? 'open a note' : 'your notes'} · ${ed.savedWhere === 'not saved' ? 'this one is not saved yet' : `saved ${ed.savedWhere}`}`} data-tip-key="ctrl+o" aria-label="notes">
    <span class="g">≡</span><span class="name">{shownName({ name: ed.file.name, title: '' })}</span><span class="dot" class:off={!ed.dirty}>●</span>
  </button>
  {#each left as b (b.id)}{@render button(b)}{/each}
  <span class="sep"></span>
  {#each insert as b (b.id)}{@render button(b)}{/each}
  <span class="spacer"></span>
  {#each right as b (b.id)}{@render button(b)}{/each}
</header>

<style>
  .toolbar {
    /* over the panels' backdrops: a button works while one is open (and closes it) */
    position: relative;
    z-index: 35;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    padding: 0 8px;
    font-family: var(--mono);
    font-size: 12px;
    font-variant-ligatures: none;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    transition: opacity 400ms ease;
  }
  .toolbar.quiet {
    opacity: 0;
    transition-duration: 900ms;
  }
  .b {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .b:hover {
    background: var(--sel-bg);
    color: var(--fg);
  }
  .b:hover .g { color: var(--accent); }
  .g { color: var(--muted); }
  .b.glyph { padding: 0 7px; }
  /* a button that acts on where the caret is (the table button, in a table) */
  .b.here { color: var(--fg); }
  .b.here .g { color: var(--accent); }
  .caret { font-size: 9px; margin-left: -2px; }
  .note { color: var(--fg); max-width: 28ch; }
  .note .name { overflow: hidden; text-overflow: ellipsis; }
  /* (its place is kept when saved: the buttons after it don't move) */
  .dot { font-size: 8px; color: var(--muted); }
  .dot.off { visibility: hidden; }
  .sep {
    width: 1px;
    height: 14px;
    margin: 0 6px;
    background: var(--border);
  }
  .spacer { flex: 1; }
  /* narrow windows: the glyphs only */
  @media (max-width: 720px) {
    .l { display: none; }
    .note { max-width: 16ch; }
  }
</style>
