<script lang="ts">
  // The notes kept in the browser (ctrl+o in the web version): open, rename, delete, and
  // files from disk, and the welcome note. Type to filter (by name, and by what the notes
  // say: the line it's in shows, and opening the note finds it there); ↑ ↓ and Enter open;
  // F2 renames; del twice deletes. With the mouse: click to open, ✎ renames, ✕ then
  // "delete" deletes.
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '$lib/editor.svelte';
  import { listNotes, searchNotes, shownName, type NoteMeta } from '$lib/library';
  import { canUseFiles } from '$lib/files';

  let { ed }: { ed: Editor } = $props();

  let notes = $state<NoteMeta[]>([]);
  let query = $state('');
  let sel = $state(0);
  /** The note being renamed, and its new name. */
  let renaming = $state<string | null>(null);
  let newName = $state('');
  /** The note waiting for its delete to be confirmed: a second del (keys), or a click on "delete" (mouse). */
  let deleting = $state<{ id: string; by: 'keys' | 'mouse' } | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();

  type Row = { kind: 'note'; note: NoteMeta } | { kind: 'new' } | { kind: 'file' } | { kind: 'welcome' };
  /** The notes whose text has what's typed, with the line it's in. */
  let hits = $state(new Map<string, string>());
  const byName = (n: NoteMeta) => `${shownName(n)} ${n.title} ${n.file ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
  // (found by name first, then by what they say)
  const shown = $derived(
    !query.trim() ? notes : [...notes.filter(byName), ...notes.filter((n) => !byName(n) && hits.has(n.id))],
  );
  let searching = 0;
  $effect(() => {
    const q = query;
    const n = ++searching;
    if (q.trim().length < 2) return void (hits = new Map());
    const t = setTimeout(async () => {
      const found = await searchNotes(q);
      if (n === searching) hits = found;
    }, 120);
    return () => clearTimeout(t);
  });
  /** The line a note was found by, marked where what's typed is in it. */
  function snippet(line: string): [string, boolean][] {
    const q = query.trim().toLowerCase(), at = line.toLowerCase().indexOf(q);
    return at < 0 ? [[line, false]] : [[line.slice(0, at), false], [line.slice(at, at + q.length), true], [line.slice(at + q.length), false]];
  }
  const rows = $derived<Row[]>([...shown.map((note) => ({ kind: 'note' as const, note })), { kind: 'new' }, { kind: 'file' }, { kind: 'welcome' }]);

  async function refresh() {
    notes = await listNotes();
    // the open note may not be saved yet (an empty new one): list it anyway
    if (ed.file.id && !notes.some((n) => n.id === ed.file.id)) notes.unshift({ id: ed.file.id, name: ed.file.name, title: '', updated: Date.now() });
    sel = Math.max(0, Math.min(sel, rows.length - 1));
  }

  const close = () => (ed.showNotes = false);

  async function act(r: Row) {
    // (found by what it says: there, found)
    if (r.kind === 'note') {
      const found = !byName(r.note) && hits.has(r.note.id) ? query.trim() : '';
      await ed.openKept(r.note.id);
      if (found) ed.findText(found);
    }
    else if (r.kind === 'new') (close(), await ed.newNote());
    else if (r.kind === 'welcome') await ed.openWelcome();
    else await ed.openFromDisk();
  }

  async function startRename(n: NoteMeta) {
    renaming = n.id;
    newName = n.name === 'untitled' ? n.title || '' : n.name;
    deleting = null;
    await tick();
    nameInput?.select();
  }

  async function finishRename() {
    if (renaming) await ed.renameKept(renaming, newName);
    renaming = null;
    await refresh();
    input?.focus();
  }

  async function remove(n: NoteMeta, by: 'keys' | 'mouse') {
    if (deleting?.id !== n.id) return void (deleting = { id: n.id, by });
    deleting = null;
    await ed.deleteKept(n.id);
    await refresh();
    input?.focus();
  }

  function onKey(e: KeyboardEvent) {
    const r = rows[sel];
    if (renaming) {
      if (e.key === 'Enter') finishRename();
      else if (e.key === 'Escape') (renaming = null), input?.focus();
      else return;
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'Escape': deleting ? (deleting = null) : close(); break;
      case 'ArrowDown': sel = (sel + 1) % rows.length; deleting = null; break;
      case 'ArrowUp': sel = (sel - 1 + rows.length) % rows.length; deleting = null; break;
      case 'Enter': if (r) act(r); break;
      case 'F2': if (r?.kind === 'note') startRename(r.note); break;
      case 'Delete': {
        // (in the filter, del first deletes what's after its caret)
        const t = e.target as HTMLInputElement;
        const atEnd = t !== input || (t.selectionStart === t.value.length && t.selectionEnd === t.value.length);
        if (r?.kind === 'note' && atEnd) remove(r.note, 'keys');
        else return;
        break;
      }
      default:
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') (close(), ed.newNote());
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') close();
        else return;
    }
    e.preventDefault();
  }

  const ago = (t: number) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    const d = Math.floor(s / 86400);
    return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString();
  };

  onMount(() => {
    // the latest other note first: ctrl+o, enter goes back and forth between two notes
    refresh().then(() => (sel = Math.max(0, notes.findIndex((n) => n.id !== ed.file.id))));
    input?.focus();
  });
  // filtering starts from the top
  $effect(() => {
    void query;
    sel = 0;
    deleting = null;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onmousedown={(e) => e.target === e.currentTarget && close()}>
  <div class="panel" transition:fly={{ y: 8, duration: 180, easing: cubicOut }} onkeydown={onKey}>
    <div class="title">notes <span>· kept in this browser</span></div>
    <div class="search"><span class="sigil">/</span><input bind:this={input} bind:value={query} placeholder="filter" spellcheck="false" aria-label="filter notes" /></div>
    <div class="list">
      {#each rows as r, i (r.kind === 'note' ? r.note.id : r.kind)}
        <div
          class="row"
          class:sel={i === sel}
          class:action={r.kind !== 'note'}
          onmousemove={() => (sel = i)}
          onmouseleave={() => deleting?.by === 'mouse' && r.kind === 'note' && deleting.id === r.note.id && (deleting = null)}
          onclick={() => renaming !== (r.kind === 'note' ? r.note.id : '') && act(r)}
        >
          {#if r.kind === 'note'}
            {@const n = r.note}
            {#if renaming === n.id}
              <input class="rename" bind:this={nameInput} bind:value={newName} onblur={finishRename} onclick={(e) => e.stopPropagation()} aria-label="new name" />
            {:else}
              <span class="name" class:current={n.id === ed.file.id}>{shownName(n) || 'untitled'}</span>
              {#if deleting?.id === n.id && deleting.by === 'keys'}
                <span class="warn">del again to delete</span>
              {:else}
                {#if n.file}<span class="file" title="also saved to this file">↔ {n.file}</span>{/if}
                <span class="when">{n.id === ed.file.id ? 'open' : ago(n.updated)}</span>
              {/if}
              <button class="icon" title="rename (F2)" aria-label="rename" onclick={(e) => (e.stopPropagation(), startRename(n))}>✎</button>
              {#if deleting?.id === n.id && deleting.by === 'mouse'}
                <button class="confirm" aria-label="delete this note" onclick={(e) => (e.stopPropagation(), remove(n, 'mouse'))}>delete</button>
              {:else}
                <button class="icon danger" title="delete (del twice)" aria-label="delete" onclick={(e) => (e.stopPropagation(), remove(n, 'mouse'))}>✕</button>
              {/if}
              {#if query.trim() && hits.has(n.id) && !byName(n)}
                <span class="snippet">{#each snippet(hits.get(n.id)!) as [part, hit], k (k)}<span class:hit>{part}</span>{/each}</span>
              {/if}
            {/if}
          {:else if r.kind === 'new'}
            <span class="name">+ new note</span>{#if ed.input === 'keys'}<kbd>ctrl+n</kbd>{/if}
          {:else if r.kind === 'file'}
            <span class="name">open a file…</span><span class="when">{canUseFiles() ? 'saves back to it' : '.ntx'}</span>
          {:else}
            <span class="name">the welcome note</span><span class="when">everything notex does</span>
          {/if}
        </div>
      {/each}
    </div>
    {#if ed.input === 'keys'}<div class="foot">⏎ open · F2 rename · del twice to delete · esc close</div>{/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: start center;
    padding-top: 12vh;
    background: var(--scrim);
    font-family: var(--mono);
    font-size: 12.5px;
    font-variant-ligatures: none;
  }
  .panel {
    width: min(560px, 92vw);
    max-height: 72vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 0 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }
  .title {
    color: var(--accent);
    font-weight: 700;
    font-size: 14px;
    padding: 0 18px 10px;
  }
  .title span { color: var(--muted); font-weight: 400; font-size: 11.5px; }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 18px 8px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .sigil { color: var(--accent); }
  input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--fg);
    font: inherit;
  }
  .list { overflow-y: auto; }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    padding: 6px 18px;
    cursor: pointer;
    color: var(--fg);
    border-left: 2px solid transparent;
  }
  .row.sel {
    background: var(--sel-bg);
    border-left-color: var(--accent);
  }
  .row.sel .name { color: var(--accent); }
  .row.action .name { color: var(--muted); }
  .row.action.sel .name { color: var(--accent); }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.current::after { content: ' ●'; color: var(--accent); font-size: 0.8em; }
  .file, .when, kbd { color: var(--muted); font-size: 11px; white-space: nowrap; font-family: inherit; }
  .file { max-width: 30%; overflow: hidden; text-overflow: ellipsis; }
  .warn { color: var(--danger); font-size: 11px; }
  /* the line a note was found by */
  .snippet {
    flex-basis: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-family: var(--prose);
    font-size: 12px;
  }
  .snippet .hit {
    color: var(--fg);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-radius: 2px;
  }
  .confirm {
    background: var(--danger);
    border: none;
    border-radius: 3px;
    padding: 1px 7px;
    color: var(--bg);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .rename {
    border-bottom: 1px solid var(--accent);
    padding: 1px 0;
  }
  .icon {
    background: none;
    border: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    padding: 0 2px;
    opacity: 0;
  }
  .row:hover .icon, .row.sel .icon { opacity: 1; }
  .icon:hover { color: var(--accent); }
  .icon.danger:hover { color: var(--danger); }
  .foot {
    color: var(--muted);
    font-size: 11px;
    padding: 8px 18px 2px;
    border-top: 1px solid var(--border);
    margin-top: 6px;
  }
</style>
